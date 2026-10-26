"""Export dbt mart tables from MotherDuck to local Parquet files for the static frontend.

These committed Parquet files are the only thing the GitHub Pages frontend ever reads
(via DuckDB-Wasm) — it has no MotherDuck connection and no token.
"""

from __future__ import annotations

import os
import pathlib
import shutil

import duckdb

MOTHERDUCK_DATABASE = "apparel_import_monitor"
EXPORT_DIR = pathlib.Path("data")
SITE_DATA_DIR = pathlib.Path("docs/data")  # served same-origin by GitHub Pages

MARTS = [
    "mart_freight_pressure",
    "mart_currency_exposure",
    "mart_origin_concentration",
    "mart_country_shares",
]


def run() -> list[str]:
    """Copy each mart table to data/<mart>.parquet. Returns the paths written."""
    token = os.environ["MOTHERDUCK_TOKEN"]
    con = duckdb.connect(f"md:{MOTHERDUCK_DATABASE}?motherduck_token={token}")
    try:
        EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        exported: list[str] = []
        for mart in MARTS:
            out_path = EXPORT_DIR / f"{mart}.parquet"
            con.execute(f"COPY marts.{mart} TO '{out_path}' (FORMAT PARQUET)")
            exported.append(str(out_path))
        SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
        for path in exported[:]:
            copy = SITE_DATA_DIR / pathlib.Path(path).name
            shutil.copyfile(path, copy)
            exported.append(str(copy))
        return exported
    finally:
        con.close()


if __name__ == "__main__":
    print(run())
