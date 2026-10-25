"""Copy locally-landed raw tables from data/raw.duckdb into MotherDuck's raw schema.

dbt's sources read from here (not from the local file directly) so the raw layer is
durable in MotherDuck rather than tied to a file that may not persist (e.g. on a CI
runner). Full refresh each run (CREATE OR REPLACE TABLE), since the local DuckDB file
on a dev machine already holds the complete accumulated history. A scheduled job
running against an ephemeral CI runner would need to append instead — tracked as a
Phase 3 follow-up, not needed for local dbt development.
"""

from __future__ import annotations

import os
import pathlib

import duckdb

DB_PATH = pathlib.Path("data/raw.duckdb")
MOTHERDUCK_DATABASE = "apparel_import_monitor"

RAW_TABLES = ["raw_gscpi", "raw_fx", "raw_trade", "raw_cpi", "raw_cimt"]


def run() -> dict[str, int]:
    """Replace each raw table in MotherDuck with the local file's current contents.

    Returns row count per table landed in MotherDuck.
    """
    token = os.environ["MOTHERDUCK_TOKEN"]
    con = duckdb.connect(f"md:{MOTHERDUCK_DATABASE}?motherduck_token={token}")
    try:
        con.execute(f"ATTACH '{DB_PATH}' AS local_raw (READ_ONLY)")
        con.execute("CREATE SCHEMA IF NOT EXISTS raw")
        counts: dict[str, int] = {}
        for table in RAW_TABLES:
            con.execute(
                f"CREATE OR REPLACE TABLE raw.{table} AS SELECT * FROM local_raw.main.{table}"
            )
            counts[table] = con.execute(f"SELECT count(*) FROM raw.{table}").fetchone()[0]
        return counts
    finally:
        con.execute("DETACH local_raw")
        con.close()


if __name__ == "__main__":
    print(run())
