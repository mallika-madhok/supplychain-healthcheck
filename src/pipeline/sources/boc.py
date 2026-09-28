"""Extraction for the Bank of Canada Valet API (USD/CAD daily rate)."""

from __future__ import annotations

from datetime import datetime, timezone

import httpx

BOC_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json"
BOC_RELIABLE_START_DATE = "2017-03-01"


def fetch_fx_usd_cad(client: httpx.Client | None = None) -> list[dict]:
    """Fetch USD/CAD daily observations from 2017-03-01 onward.

    Returns one dict per trading day with a published rate: date (date),
    usd_cad_rate (float), retrieved_at (UTC datetime), source_url (str).
    """
    owns_client = client is None
    client = client or httpx.Client(timeout=30.0)
    try:
        response = client.get(BOC_URL, params={"start_date": BOC_RELIABLE_START_DATE})
        response.raise_for_status()
        retrieved_at = datetime.now(timezone.utc)
        payload = response.json()

        rows: list[dict] = []
        for observation in payload["observations"]:
            value = observation.get("FXUSDCAD", {}).get("v")
            if value is None:
                continue
            rows.append(
                {
                    "date": datetime.strptime(observation["d"], "%Y-%m-%d").date(),
                    "usd_cad_rate": float(value),
                    "retrieved_at": retrieved_at,
                    "source_url": BOC_URL,
                }
            )
        return rows
    finally:
        if owns_client:
            client.close()
