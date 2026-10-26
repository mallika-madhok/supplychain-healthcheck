from datetime import UTC, date, datetime

import httpx

from pipeline import extract_cimt


def test_run_lands_rows_for_each_requested_year(monkeypatch, tmp_path):
    monkeypatch.setattr(extract_cimt, "DB_PATH", tmp_path / "raw.duckdb")
    now = datetime.now(UTC)

    def fake_fetch(year, client=None):
        return [
            {
                "month": date(year, 1, 1),
                "hs4": "6109",
                "hs2_chapter": "61",
                "hs4_label": "T-shirts",
                "country": "BD",
                "import_value_cad": 1000.0,
                "retrieved_at": now,
                "source_url": "x",
            }
        ]

    monkeypatch.setattr(extract_cimt, "fetch_cimt_hs4_imports", fake_fetch)

    counts = extract_cimt.run(years=[2024, 2025])

    assert counts == {2024: 1, 2025: 1}
    assert (tmp_path / "raw.duckdb").exists()


def test_run_skips_years_that_fail_to_fetch(monkeypatch, tmp_path):
    monkeypatch.setattr(extract_cimt, "DB_PATH", tmp_path / "raw.duckdb")

    def fake_fetch(year, client=None):
        if year == 2022:
            raise httpx.HTTPStatusError("not found", request=None, response=None)
        return []

    monkeypatch.setattr(extract_cimt, "fetch_cimt_hs4_imports", fake_fetch)

    counts = extract_cimt.run(years=[2022, 2023])

    assert counts == {2022: None, 2023: 0}
