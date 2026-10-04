import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import SCHEMA, connect
from rules import DEFAULT_LOWER_DEG, DEFAULT_UPPER_DEG, judge

SECRET = os.environ.get("JWT_SECRET", "yaw-align-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

USERS = {
    "technician": {
        "role": "writer",
        "password_hash": pwd.hash("tech123456"),
    },
    "observer": {
        "role": "reader",
        "password_hash": pwd.hash("obs123456"),
    },
}

# 档位表唯一种子来源：入库后，接口与页面点选都从这里读，前后端同源。
SEED_BANDS = [
    ("breeze", "微风档", DEFAULT_LOWER_DEG, DEFAULT_UPPER_DEG),
    ("high_power", "大功率档", DEFAULT_LOWER_DEG, DEFAULT_UPPER_DEG),
]

app = Quart(__name__)


def _run_db(fn, *args, **kwargs):
    return fn(*args, **kwargs)


async def run_db(fn, *args, **kwargs):
    return await asyncio.to_thread(_run_db, fn, *args, **kwargs)


def seed_bands(conn, now):
    count = conn.execute("SELECT COUNT(*) AS n FROM power_bands").fetchone()["n"]
    if count > 0:
        return
    for code, name, lower, upper in SEED_BANDS:
        conn.execute(
            """INSERT INTO power_bands (code, name, lower_deg, upper_deg, updated_by, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (code, name, lower, upper, "system", now),
        )
        conn.execute(
            """INSERT INTO power_band_changes
               (band_code, band_name, old_lower_deg, old_upper_deg,
                new_lower_deg, new_upper_deg, changed_by, changed_at)
               VALUES (%s, %s, NULL, NULL, %s, %s, %s, %s)""",
            (code, name, lower, upper, "system", now),
        )


def seed_if_empty(conn):
    conn.execute(SCHEMA)
    now = datetime.now(timezone.utc)
    seed_bands(conn, now)
    count = conn.execute("SELECT COUNT(*) AS n FROM yaw_logs").fetchone()["n"]
    if count > 0:
        return
    band = conn.execute(
        "SELECT code, name, lower_deg, upper_deg FROM power_bands WHERE code = 'breeze'"
    ).fetchone()
    samples = [
        ("W01", 0.4, "合格"),
        ("W07", 3.2, "偏航超差"),
    ]
    for code, err, expected_verdict in samples:
        verdict, reason = judge(err, band["lower_deg"], band["upper_deg"])
        assert verdict == expected_verdict
        conn.execute(
            """INSERT INTO yaw_logs
               (turbine_code, yaw_err_deg, band_code, band_name,
                band_lower_snap, band_upper_snap,
                status, verdict, reason, created_by, created_at, processed_at)
               VALUES (%s, %s, %s, %s, %s, %s, 'done', %s, %s, %s, %s, %s)""",
            (
                code,
                err,
                band["code"],
                band["name"],
                band["lower_deg"],
                band["upper_deg"],
                verdict,
                reason,
                "technician",
                now,
                now,
            ),
        )


@app.before_serving
async def startup():
    def init():
        with connect() as conn:
            seed_if_empty(conn)
            conn.commit()

    await run_db(init)


def parse_bearer():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


async def current_user():
    token = parse_bearer()
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except JWTError:
        return None
    sub = payload.get("sub")
    if sub not in USERS:
        return None
    return {"username": sub, "role": payload.get("role")}


def require_login(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        return await handler(user, *args, **kwargs)

    return wrapper


def require_writer(handler=None, *, forbid_msg="仅现场技师可提交偏航记录"):
    def decorate(fn):
        @wraps(fn)
        async def wrapper(*args, **kwargs):
            user = await current_user()
            if user is None:
                return jsonify({"detail": "未登录"}), 401
            if user["role"] != "writer":
                return jsonify({"detail": forbid_msg}), 403
            return await fn(user, *args, **kwargs)

        return wrapper

    return decorate(handler) if handler is not None else decorate


@app.get("/api/health")
async def health():
    return jsonify({"status": "ok", "service": "yaw-align-log"})


@app.post("/api/auth/login")
async def login():
    body = await request.get_json(force=True, silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    user = USERS.get(username)
    if not user or not pwd.verify(password, user["password_hash"]):
        return jsonify({"detail": "用户名或密码错误"}), 401
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode(
        {"sub": username, "role": user["role"], "exp": exp},
        SECRET,
        algorithm="HS256",
    )
    return jsonify(
        {
            "access_token": token,
            "username": username,
            "role": user["role"],
        }
    )


@app.get("/api/bands")
@require_login
async def list_bands(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT code, name, lower_deg, upper_deg, updated_by, updated_at
                   FROM power_bands ORDER BY code"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.route("/api/bands/<code>", methods=["PUT", "POST"])
@require_writer(forbid_msg="仅现场技师可改档")
async def update_band(user, code):
    body = await request.get_json(force=True, silent=True) or {}
    has_lower = "lower_deg" in body and body.get("lower_deg") is not None
    has_upper = "upper_deg" in body and body.get("upper_deg") is not None
    if not has_lower and not has_upper:
        return jsonify({"detail": "至少要给出下限或上限"}), 400
    try:
        new_lower = float(body["lower_deg"]) if has_lower else None
        new_upper = float(body["upper_deg"]) if has_upper else None
    except (TypeError, ValueError):
        return jsonify({"detail": "上下限必须是数字"}), 400

    now = datetime.now(timezone.utc)

    def update():
        with connect() as conn:
            band = conn.execute(
                "SELECT code, name, lower_deg, upper_deg FROM power_bands WHERE code = %s",
                (code,),
            ).fetchone()
            if band is None:
                return None, ("未知功率档", 400)
            lower = band["lower_deg"] if new_lower is None else new_lower
            upper = band["upper_deg"] if new_upper is None else new_upper
            if lower > upper:
                return None, ("闭区间下限不能大于上限", 400)
            conn.execute(
                """UPDATE power_bands
                   SET lower_deg = %s, upper_deg = %s, updated_by = %s, updated_at = %s
                   WHERE code = %s""",
                (lower, upper, user["username"], now, code),
            )
            conn.execute(
                """INSERT INTO power_band_changes
                   (band_code, band_name, old_lower_deg, old_upper_deg,
                    new_lower_deg, new_upper_deg, changed_by, changed_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    band["code"],
                    band["name"],
                    band["lower_deg"],
                    band["upper_deg"],
                    lower,
                    upper,
                    user["username"],
                    now,
                ),
            )
            conn.commit()
            row = conn.execute(
                """SELECT code, name, lower_deg, upper_deg, updated_by, updated_at
                   FROM power_bands WHERE code = %s""",
                (code,),
            ).fetchone()
            return row, None

    row, err = await run_db(update)
    if err:
        msg, status = err
        return jsonify({"detail": msg}), status
    return jsonify(row)


@app.get("/api/band-changes")
@require_login
async def list_band_changes(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, band_code, band_name, old_lower_deg, old_upper_deg,
                          new_lower_deg, new_upper_deg, changed_by, changed_at
                   FROM power_band_changes ORDER BY id DESC LIMIT 100"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.get("/api/logs")
@require_login
async def list_logs(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, turbine_code, yaw_err_deg,
                          band_code, band_name, band_lower_snap, band_upper_snap,
                          status, verdict, reason,
                          created_by, created_at, processed_at
                   FROM yaw_logs ORDER BY id DESC"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/logs")
@require_writer
async def create_log(user):
    body = await request.get_json(force=True, silent=True) or {}
    turbine_code = (body.get("turbine_code") or "").strip()
    if not turbine_code:
        return jsonify({"detail": "机组编号不能为空"}), 400
    band_code = (body.get("band_code") or "").strip()
    if not band_code:
        return jsonify({"detail": "新单必须点选功率档，漏选整单退回"}), 400
    try:
        yaw_err_deg = float(body.get("yaw_err_deg"))
    except (TypeError, ValueError):
        return jsonify({"detail": "偏航误差必须是数字"}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            band = conn.execute(
                "SELECT code, name FROM power_bands WHERE code = %s",
                (band_code,),
            ).fetchone()
            if band is None:
                return None
            row = conn.execute(
                """INSERT INTO yaw_logs
                   (turbine_code, yaw_err_deg, band_code, band_name,
                    status, verdict, reason, created_by, created_at)
                   VALUES (%s, %s, %s, %s, 'pending', NULL, NULL, %s, %s)
                   RETURNING id, turbine_code, yaw_err_deg,
                             band_code, band_name, band_lower_snap, band_upper_snap,
                             status, verdict, reason,
                             created_by, created_at, processed_at""",
                (turbine_code, yaw_err_deg, band["code"], band["name"],
                 user["username"], now),
            ).fetchone()
            conn.commit()
            return row

    row = await run_db(insert)
    if row is None:
        return jsonify({"detail": "未知功率档，整单退回"}), 400
    return jsonify(row), 201
