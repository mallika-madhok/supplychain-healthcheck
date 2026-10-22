"""CLI entry point: pull all four weekly sources and land them into DuckDB."""

from __future__ import annotations

import pathlib

import duckdb

from pipeline.land import land_rows
from pipeline.sources.boc import fetch_fx_usd_cad
from pipeline.sources.nyfed import fetch_gscpi
from pipeline.sources.statcan import fetch_apparel_trade, fetch_clothing_cpi

DB_PATH = pathlib.Path("data/raw.duckdb")


def run() -> dict[str, int]:
    """Pull all four weekly sources and land them. Returns rows landed per table."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB_PATH))
    try:
        return {
            "raw_gscpi": land_rows(con, "raw_gscpi", fetch_gscpi()),
            "raw_fx": land_rows(con, "raw_fx", fetch_fx_usd_cad()),
            "raw_trade": land_rows(con, "raw_trade", fetch_apparel_trade()),
            "raw_cpi": land_rows(con, "raw_cpi", fetch_clothing_cpi()),
        }
    finally:
        con.close()


if __name__ == "__main__":
    print(run())
