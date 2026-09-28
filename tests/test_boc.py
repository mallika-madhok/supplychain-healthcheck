from datetime import date

import httpx

from pipeline.sources import boc


def test_fetch_fx_usd_cad_parses_observations():
    payload = {
        "observations": [
            {"d": "2026-09-24", "FXUSDCAD": {"v": "1.4102"}},
            {"d": "2026-09-25", "FXUSDCAD": {"v": "1.4145"}},
        ]
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/valet/observations/FXUSDCAD/json"
        assert request.url.params["start_date"] == boc.BOC_RELIABLE_START_DATE
        return httpx.Response(200, json=payload)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    rows = boc.fetch_fx_usd_cad(client=client)

    assert rows[0]["date"] == date(2026, 9, 24)
    assert rows[0]["usd_cad_rate"] == 1.4102
    assert rows[0]["source_url"] == boc.BOC_URL
    assert rows[1]["date"] == date(2026, 9, 25)
    assert rows[1]["usd_cad_rate"] == 1.4145
    assert rows[0]["retrieved_at"] == rows[1]["retrieved_at"]


def test_fetch_fx_usd_cad_skips_missing_values():
    payload = {
        "observations": [
            {"d": "2026-09-24", "FXUSDCAD": {}},
            {"d": "2026-09-25", "FXUSDCAD": {"v": "1.4145"}},
        ]
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    rows = boc.fetch_fx_usd_cad(client=client)

    assert len(rows) == 1
    assert rows[0]["date"] == date(2026, 9, 25)
