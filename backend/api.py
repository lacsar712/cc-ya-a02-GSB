import asyncio
import math
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import GEAR_ORDER, SCHEMA, connect, seed_gears
from rules import judge

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

app = Quart(__name__)


def _run_db(fn, *args, **kwargs):
    return fn(*args, **kwargs)


async def run_db(fn, *args, **kwargs):
    return await asyncio.to_thread(_run_db, fn, *args, **kwargs)


def seed_if_empty(conn):
    conn.execute(SCHEMA)
    seed_gears(conn)
    count = conn.execute("SELECT COUNT(*) AS n FROM yaw_logs").fetchone()["n"]
    if count > 0:
        return
    now = datetime.now(timezone.utc)
    gears = {
        row["gear_key"]: row
        for row in conn.execute(
            "SELECT gear_key, label, lower_deg, upper_deg FROM power_gears"
        ).fetchall()
    }
    # 机组, 误差, 功率档, 期望结论
    samples = [
        ("W01", 0.4, "breeze", "合格"),
        ("W07", 3.2, "high", "偏航超差"),
    ]
    for code, err, gear_key, expected_verdict in samples:
        gear = gears[gear_key]
        verdict, reason = judge(
            err,
            float(gear["lower_deg"]),
            float(gear["upper_deg"]),
            gear["label"],
        )
        assert verdict == expected_verdict
        conn.execute(
            """INSERT INTO yaw_logs
               (turbine_code, yaw_err_deg, status, verdict, reason,
                created_by, created_at, processed_at,
                gear_key, snap_lower_deg, snap_upper_deg, claimed_at)
               VALUES (%s, %s, 'done', %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                code,
                err,
                verdict,
                reason,
                "technician",
                now,
                now,
                gear_key,
                gear["lower_deg"],
                gear["upper_deg"],
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


def require_writer(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        if user["role"] != "writer":
            return jsonify({"detail": "仅现场技师可操作"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


def _as_finite_float(value, field_name: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name}必须是数字")
    if not math.isfinite(result):
        raise ValueError(f"{field_name}必须是有限数字")
    return result


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


@app.get("/api/logs")
@require_login
async def list_logs(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT l.id, l.turbine_code, l.yaw_err_deg, l.status,
                          l.verdict, l.reason, l.created_by, l.created_at,
                          l.processed_at, l.gear_key, g.label AS gear_label,
                          l.snap_lower_deg, l.snap_upper_deg, l.claimed_at
                   FROM yaw_logs l
                   LEFT JOIN power_gears g ON g.gear_key = l.gear_key
                   ORDER BY l.id DESC"""
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
    try:
        yaw_err_deg = _as_finite_float(body.get("yaw_err_deg"), "偏航误差")
    except ValueError as exc:
        return jsonify({"detail": str(exc)}), 400

    # 新单必须点选功率档：漏选整单退回，不允许进入待认领队列。
    gear_key = (body.get("gear_key") or "").strip()
    if not gear_key:
        return (
            jsonify(
                {"detail": "新单必须点选功率档，漏选功率档整单退回，请选择后重新提交"}
            ),
            400,
        )

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            # 档位合法性以数据库档位表为准（前后端同源），前端不可自创档位。
            gear = conn.execute(
                """SELECT gear_key, label, lower_deg, upper_deg
                   FROM power_gears WHERE gear_key = %s FOR SHARE""",
                (gear_key,),
            ).fetchone()
            if gear is None:
                return None
            row = conn.execute(
                """INSERT INTO yaw_logs
                   (turbine_code, yaw_err_deg, status, verdict, reason,
                    created_by, created_at, gear_key)
                   VALUES (%s, %s, 'pending', NULL, NULL, %s, %s, %s)
                   RETURNING id, turbine_code, yaw_err_deg, status, verdict, reason,
                             created_by, created_at, processed_at,
                             gear_key, snap_lower_deg, snap_upper_deg, claimed_at""",
                (turbine_code, yaw_err_deg, user["username"], now, gear_key),
            ).fetchone()
            conn.commit()
            return row

    row = await run_db(insert)
    if row is None:
        return jsonify({"detail": "所选功率档不存在，请刷新后重选"}), 400
    return jsonify(row), 201


@app.get("/api/gears")
@require_login
async def list_gears(user):
    """档位表：观察员可浏览；页面下拉与档位带均以此为唯一数据源。"""

    def query():
        with connect() as conn:
            rows = conn.execute(
                """SELECT gear_key, label, lower_deg, upper_deg,
                          updated_by, updated_at
                   FROM power_gears"""
            ).fetchall()
        by_key = {row["gear_key"]: row for row in rows}
        return [by_key[key] for key in GEAR_ORDER if key in by_key]

    rows = await run_db(query)
    return jsonify(rows)


@app.put("/api/gears/<gear_key>")
@require_writer
async def update_gear(user, gear_key):
    """技师改档：更新档位表现行闭区间，并向改档流水追加一条。"""
    body = await request.get_json(force=True, silent=True) or {}
    try:
        lower_deg = _as_finite_float(body.get("lower_deg"), "下限")
        upper_deg = _as_finite_float(body.get("upper_deg"), "上限")
    except ValueError as exc:
        return jsonify({"detail": str(exc)}), 400
    if lower_deg > upper_deg:
        return jsonify({"detail": "下限不能大于上限"}), 400

    def update():
        with connect() as conn:
            old = conn.execute(
                "SELECT * FROM power_gears WHERE gear_key = %s FOR UPDATE",
                (gear_key,),
            ).fetchone()
            if old is None:
                return None
            now = datetime.now(timezone.utc)
            conn.execute(
                """UPDATE power_gears
                   SET lower_deg = %s, upper_deg = %s,
                       updated_by = %s, updated_at = %s
                   WHERE gear_key = %s""",
                (lower_deg, upper_deg, user["username"], now, gear_key),
            )
            conn.execute(
                """INSERT INTO gear_changes
                   (gear_key, old_lower_deg, old_upper_deg,
                    new_lower_deg, new_upper_deg, changed_by, changed_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (
                    gear_key,
                    old["lower_deg"],
                    old["upper_deg"],
                    lower_deg,
                    upper_deg,
                    user["username"],
                    now,
                ),
            )
            gear = conn.execute(
                """SELECT gear_key, label, lower_deg, upper_deg,
                          updated_by, updated_at
                   FROM power_gears WHERE gear_key = %s""",
                (gear_key,),
            ).fetchone()
            conn.commit()
            return gear

    row = await run_db(update)
    if row is None:
        return jsonify({"detail": "档位不存在"}), 404
    return jsonify(row)


@app.get("/api/gear-changes")
@require_login
async def list_gear_changes(user):
    """改档流水：观察员可浏览，无权修改。"""

    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT c.id, c.gear_key, g.label AS gear_label,
                          c.old_lower_deg, c.old_upper_deg,
                          c.new_lower_deg, c.new_upper_deg,
                          c.changed_by, c.changed_at
                   FROM gear_changes c
                   LEFT JOIN power_gears g ON g.gear_key = c.gear_key
                   ORDER BY c.id DESC"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)
