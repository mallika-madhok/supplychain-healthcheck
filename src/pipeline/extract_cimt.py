"""CLI entry point: pull CIMT HS2-level apparel imports for a set of years.

Runs on its own slower cadence, separate from extract.py's weekly sources, since the
Open Government Portal only publishes new CIMT batches a few times a year.
"""

from __future__ import annotations

import pathlib

import duckdb
import httpx

from pipeline.land import land_rows
from pipeline.sources.cimt import fetch_cimt_hs2_imports

DB_PATH = pathlib.Path("data/raw.duckdb")

DEFAULT_YEARS = [2023, 2024, 2025, 2026]


def run(years: list[int] | None = None) -> dict[int, int | None]:
    """Pull CIMT HS2-level imports for each year and land them.

    Returns rows landed per year, or None for a year whose fetch failed after a retry
    (e.g. no batch published yet, or a dropped connection) so one bad year doesn't stop
    the others. One retry, since the CIMT zip download has been observed to drop the
    connection once and succeed on an immediate retry.
    """
    years = years if years is not None else DEFAULT_YEARS
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB_PATH))
    try:
        counts: dict[int, int | None] = {}
        for year in years:
            rows = None
            for _attempt in range(2):
                try:
                    rows = fetch_cimt_hs2_imports(year)
                    break
                except httpx.HTTPError:
                    continue
            if rows is None:
                counts[year] = None
                continue
            counts[year] = land_rows(con, "raw_cimt", rows)
        return counts
    finally:
        con.close()


if __name__ == "__main__":
    print(run())
