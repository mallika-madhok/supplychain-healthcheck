from datetime import date

import duckdb

from pipeline import land


def test_land_rows_creates_table_and_returns_count(tmp_path):
    con = duckdb.connect(str(tmp_path / "raw.duckdb"))
    inserted = land.land_rows(
        con,
        "raw_test",
        [
            {"month": date(2026, 1, 1), "value": 1.0},
            {"month": date(2026, 2, 1), "value": 2.0},
        ],
    )
    assert inserted == 2
    assert con.execute("SELECT count(*) FROM raw_test").fetchone()[0] == 2


def test_land_rows_appends_without_deleting_existing_rows(tmp_path):
    con = duckdb.connect(str(tmp_path / "raw.duckdb"))
    land.land_rows(con, "raw_test", [{"month": date(2026, 1, 1), "value": 1.0}])
    second_count = land.land_rows(con, "raw_test", [{"month": date(2026, 2, 1), "value": 2.0}])

    assert second_count == 1
    assert con.execute("SELECT count(*) FROM raw_test").fetchone()[0] == 2


def test_land_rows_handles_empty_input(tmp_path):
    con = duckdb.connect(str(tmp_path / "raw.duckdb"))
    inserted = land.land_rows(con, "raw_empty", [])
    assert inserted == 0
    tables = con.execute("SELECT table_name FROM information_schema.tables").fetchall()
    assert ("raw_empty",) not in tables
