"""后台 worker：用 SKIP LOCKED 认领 pending 记录并写入判定结论。

认领瞬间在同一事务内读取该功率档的现行闭区间，原样写入单据快照列
（snap_lower_deg / snap_upper_deg / claimed_at），判定只吃快照值。
此后技师再改档，只影响档位表与后续新认领的单据，不改变已认领单据。
"""

import os
import time
from datetime import datetime, timezone

import psycopg

from db import SCHEMA, connect, seed_gears
from rules import judge

POLL_SEC = float(os.environ.get("WORKER_POLL_SEC", "0.5"))
IDLE_SEC = float(os.environ.get("WORKER_IDLE_SEC", "1.0"))


def ensure_schema(conn):
    conn.execute(SCHEMA)
    seed_gears(conn)
    conn.commit()


def claim_and_process(conn) -> bool:
    with conn.transaction():
        row = conn.execute(
            """SELECT id, turbine_code, yaw_err_deg, gear_key
               FROM yaw_logs
               WHERE status = 'pending'
               ORDER BY id
               FOR UPDATE SKIP LOCKED
               LIMIT 1"""
        ).fetchone()
        if row is None:
            return False

        # 锁定档位行，把认领当时的现行闭区间冻结进单据快照。
        gear = conn.execute(
            """SELECT label, lower_deg, upper_deg
               FROM power_gears
               WHERE gear_key = %s
               FOR UPDATE""",
            (row["gear_key"],),
        ).fetchone()
        if gear is None:
            raise RuntimeError(
                f"log {row['id']} 引用了不存在的功率档 {row['gear_key']!r}"
            )

        lower = float(gear["lower_deg"])
        upper = float(gear["upper_deg"])
        now = datetime.now(timezone.utc)
        verdict, reason = judge(
            float(row["yaw_err_deg"]), lower, upper, gear["label"]
        )
        conn.execute(
            """UPDATE yaw_logs
               SET status = 'done',
                   verdict = %s,
                   reason = %s,
                   processed_at = %s,
                   snap_lower_deg = %s,
                   snap_upper_deg = %s,
                   claimed_at = %s
               WHERE id = %s""",
            (verdict, reason, now, lower, upper, now, row["id"]),
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
