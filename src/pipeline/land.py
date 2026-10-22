"""Generic, revision-safe append of extracted rows into DuckDB."""

from __future__ import annotations

import duckdb
import pandas as pd


def land_rows(con: duckdb.DuckDBPyConnection, table_name: str, rows: list[dict]) -> int:
    """Append rows to table_name, creating it on first use.

    Never deletes or overwrites existing rows — each call is a pure append, which is
    what makes it safe for sources (like StatCan trade data) that revise recent history:
    a later pull's revised value lands as a new row alongside the original.
    """
    if not rows:
        return 0
    df = pd.DataFrame(rows)
    con.register("_land_incoming", df)
    try:
        con.execute(
            f"CREATE TABLE IF NOT EXISTS {table_name} AS SELECT * FROM _land_incoming LIMIT 0"
        )
        con.execute(f"INSERT INTO {table_name} SELECT * FROM _land_incoming")
    finally:
        con.unregister("_land_incoming")
    return len(df)
