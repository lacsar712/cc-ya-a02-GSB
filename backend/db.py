import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)

# 功率档 key 固定两档，上下限为闭区间；顺序即页面展示顺序。
GEAR_ORDER = ("breeze", "high")

DEFAULT_GEARS = [
    # key, 展示名, 下限, 上限
    ("breeze", "微风档", -1.5, 1.5),
    ("high", "大功率档", -2.0, 2.0),
]


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


SCHEMA = """
CREATE TABLE IF NOT EXISTS power_gears (
    gear_key text PRIMARY KEY,
    label text NOT NULL,
    lower_deg double precision NOT NULL,
    upper_deg double precision NOT NULL,
    updated_by text,
    updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS gear_changes (
    id serial PRIMARY KEY,
    gear_key text NOT NULL,
    old_lower_deg double precision,
    old_upper_deg double precision,
    new_lower_deg double precision NOT NULL,
    new_upper_deg double precision NOT NULL,
    changed_by text NOT NULL,
    changed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS yaw_logs (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    verdict text,
    reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    processed_at timestamptz,
    gear_key text,
    snap_lower_deg double precision,
    snap_upper_deg double precision,
    claimed_at timestamptz
);

-- 旧库迁移：补齐档位快照相关列
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS gear_key text;
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS snap_lower_deg double precision;
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS snap_upper_deg double precision;
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- 旧库迁移：无档位的历史单按微风档初值补快照
UPDATE yaw_logs
   SET gear_key = 'breeze',
       snap_lower_deg = -1.5,
       snap_upper_deg = 1.5,
       claimed_at = COALESCE(claimed_at, processed_at, created_at)
 WHERE gear_key IS NULL;
"""


def seed_gears(conn):
    """写入两档默认闭区间（已存在则不动，改档由接口负责并留流水）。"""
    now_sql = "now()"
    for gear_key, label, lower, upper in DEFAULT_GEARS:
        conn.execute(
            f"""INSERT INTO power_gears
                (gear_key, label, lower_deg, upper_deg, updated_by, updated_at)
                VALUES (%s, %s, %s, %s, 'system', {now_sql})
                ON CONFLICT (gear_key) DO NOTHING""",
            (gear_key, label, lower, upper),
        )
