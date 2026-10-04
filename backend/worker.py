"""后台 worker：用 SKIP LOCKED 认领 pending 记录并写入判定结论。

认领瞬间把该功率档当时的上下限写入单据快照（band_lower_snap /
band_upper_snap），判定吃快照；之后改档不影响已认领单据。
"""

import os
import time
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

from db import SCHEMA, connect
from rules import DEFAULT_LOWER_DEG, DEFAULT_UPPER_DEG, judge

POLL_SEC = float(os.environ.get("WORKER_POLL_SEC", "0.5"))
IDLE_SEC = float(os.environ.get("WORKER_IDLE_SEC", "1.0"))


def ensure_schema(conn):
    conn.execute(SCHEMA)
    conn.commit()


def claim_and_process(conn) -> bool:
    with conn.transaction():
        row = conn.execute(
            """SELECT id, turbine_code, yaw_err_deg, band_code, band_name
               FROM yaw_logs
               WHERE status = 'pending'
               ORDER BY id
               FOR UPDATE SKIP LOCKED
               LIMIT 1"""
        ).fetchone()
        if row is None:
            return False
        band = None
        if row["band_code"]:
            band = conn.execute(
                """SELECT name, lower_deg, upper_deg
                   FROM power_bands WHERE code = %s""",
                (row["band_code"],),
            ).fetchone()
        if band is not None:
            lower, upper = band["lower_deg"], band["upper_deg"]
            band_name = band["name"]
        else:
            # 档位已被移除等异常情形：退回默认 ±1.5° 带，避免卡死队列。
            lower, upper = DEFAULT_LOWER_DEG, DEFAULT_UPPER_DEG
            band_name = row["band_name"]
        verdict, reason = judge(float(row["yaw_err_deg"]), lower, upper)
        now = datetime.now(timezone.utc)
        conn.execute(
            """UPDATE yaw_logs
               SET status = 'done', verdict = %s, reason = %s,
                   band_name = %s, band_lower_snap = %s, band_upper_snap = %s,
                   processed_at = %s
               WHERE id = %s""",
            (verdict, reason, band_name, lower, upper, now, row["id"]),
        )
    return True


def main():
    print("yaw-align worker started", flush=True)
    with connect() as conn:
        ensure_schema(conn)
    while True:
        try:
            with connect() as conn:
                if claim_and_process(conn):
                    conn.commit()
                    time.sleep(POLL_SEC)
                else:
                    time.sleep(IDLE_SEC)
        except psycopg.Error as exc:
            print(f"worker db error: {exc}", flush=True)
            time.sleep(IDLE_SEC)


if __name__ == "__main__":
    main()
