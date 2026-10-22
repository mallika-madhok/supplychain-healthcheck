from datetime import date

import httpx
import pandas as pd

from pipeline.sources import nyfed


def test_fetch_gscpi_parses_monthly_sheet(monkeypatch):
    sample_df = pd.DataFrame(
        {
            "Date": ["31-Jan-1998", "28-Feb-1998"],
            "GSCPI": [-1.160052, -0.439168],
        }
    )

    def fake_read_excel(buffer, sheet_name):
        assert sheet_name == "GSCPI Monthly Data"
        return sample_df

    monkeypatch.setattr(nyfed.pd, "read_excel", fake_read_excel)

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == nyfed.GSCPI_URL
        return httpx.Response(200, content=b"dummy-xls-bytes")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    rows = nyfed.fetch_gscpi(client=client)

    assert len(rows) == 2
    assert rows[0]["month"] == date(1998, 1, 31)
    assert rows[0]["gscpi_value"] == -1.160052
    assert rows[0]["source_url"] == nyfed.GSCPI_URL
    assert rows[1]["month"] == date(1998, 2, 28)
    assert rows[0]["retrieved_at"] == rows[1]["retrieved_at"]


def test_fetch_gscpi_drops_blank_letterhead_rows(monkeypatch):
    sample_df = pd.DataFrame(
        {
            "Date": [None, "31-Jan-1998"],
            "GSCPI": [None, -1.160052],
        }
    )
    monkeypatch.setattr(nyfed.pd, "read_excel", lambda buffer, sheet_name: sample_df)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"dummy-xls-bytes")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    rows = nyfed.fetch_gscpi(client=client)

    assert len(rows) == 1
    assert rows[0]["month"] == date(1998, 1, 31)
