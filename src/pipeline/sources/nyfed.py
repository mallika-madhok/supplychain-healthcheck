"""Extraction for the NY Fed Global Supply Chain Pressure Index (GSCPI)."""

from __future__ import annotations

import io
from datetime import UTC, date, datetime

import httpx
import pandas as pd

GSCPI_URL = (
    "https://www.newyorkfed.org/medialibrary/research/interactives/gscpi/"
    "downloads/gscpi_data.xlsx"
)


def fetch_gscpi(client: httpx.Client | None = None) -> list[dict]:
    """Fetch the full GSCPI monthly history.

    Returns one dict per month: month (date), gscpi_value (float),
    retrieved_at (UTC datetime), source_url (str).
    """
    owns_client = client is None
    client = client or httpx.Client(timeout=30.0)
    try:
        response = client.get(GSCPI_URL)
        response.raise_for_status()
        retrieved_at = datetime.now(UTC)

        df = pd.read_excel(io.BytesIO(response.content), sheet_name="GSCPI Monthly Data")
        df = df.dropna(subset=["Date", "GSCPI"])

        rows: list[dict] = []
        for _, record in df.iterrows():
            month: date = datetime.strptime(record["Date"], "%d-%b-%Y").date()
            rows.append(
                {
                    "month": month,
                    "gscpi_value": float(record["GSCPI"]),
                    "retrieved_at": retrieved_at,
                    "source_url": GSCPI_URL,
                }
            )
        return rows
    finally:
        if owns_client:
            client.close()
