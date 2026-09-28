from datetime import UTC, date, datetime

from pipeline import extract


def test_run_lands_all_four_weekly_sources(monkeypatch, tmp_path):
    monkeypatch.setattr(extract, "DB_PATH", tmp_path / "raw.duckdb")
    now = datetime.now(UTC)

    monkeypatch.setattr(
        extract,
        "fetch_gscpi",
        lambda: [
            {"month": date(2026, 1, 1), "gscpi_value": 1.0, "retrieved_at": now, "source_url": "x"}
        ],
    )
    monkeypatch.setattr(
        extract,
        "fetch_fx_usd_cad",
        lambda: [
            {"date": date(2026, 1, 1), "usd_cad_rate": 1.4, "retrieved_at": now, "source_url": "x"}
        ],
    )
    monkeypatch.setattr(extract, "fetch_apparel_trade", lambda: [])
    monkeypatch.setattr(extract, "fetch_clothing_cpi", lambda: [])

    counts = extract.run()

    assert counts == {"raw_gscpi": 1, "raw_fx": 1, "raw_trade": 0, "raw_cpi": 0}
    assert (tmp_path / "raw.duckdb").exists()
