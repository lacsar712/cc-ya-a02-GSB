import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


SCHEMA = """
CREATE TABLE IF NOT EXISTS power_bands (
    code text PRIMARY KEY,
    name text NOT NULL,
    lower_deg double precision NOT NULL,
    upper_deg double precision NOT NULL,
    updated_by text,
    updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS power_band_changes (
    id serial PRIMARY KEY,
    band_code text NOT NULL,
    band_name text NOT NULL,
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
    band_code text,
    band_name text,
    band_lower_snap double precision,
    band_upper_snap double precision,
    status text NOT NULL DEFAULT 'pending',
    verdict text,
    reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    processed_at timestamptz
);

-- 老库升级：补齐功率档与认领快照列（新库已由上方 CREATE 带上，幂等）。
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS band_code text;
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS band_name text;
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS band_lower_snap double precision;
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS band_upper_snap double precision;
"""
