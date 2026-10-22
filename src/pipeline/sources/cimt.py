"""Extraction for StatCan's CIMT bulk HS2-chapter-level import data."""

from __future__ import annotations

import fnmatch
import io
import zipfile
from datetime import UTC, datetime

import httpx
import pandas as pd

CIMT_ZIP_URL_TEMPLATE = (
    "https://www150.statcan.gc.ca/n1/pub/71-607-x/2021004/zip/CIMT-CICM_Imp_{year}.zip"
)

APPAREL_HS2_CHAPTERS: dict[str, str] = {
    "61": "Apparel and clothing accessories, knitted or crocheted",
    "62": "Apparel and clothing accessories, not knitted or crocheted",
    "64": "Footwear, gaiters and the like",
}

_COLUMNS = ["year_month", "hs2", "country", "province", "state", "value"]


def fetch_cimt_hs2_imports(year: int, client: httpx.Client | None = None) -> list[dict]:
    """Fetch one calendar year's HS2-chapter-level import data, filtered to apparel chapters.

    Returns one dict per (month, HS2 chapter, country) row: month (date), hs2_chapter
    (str), hs2_label (str), country (str, ISO2 code), import_value_cad (float),
    retrieved_at (UTC datetime), source_url (str).
    """
    owns_client = client is None
    client = client or httpx.Client(timeout=120.0, follow_redirects=True)
    url = CIMT_ZIP_URL_TEMPLATE.format(year=year)
    try:
        response = client.get(url)
        response.raise_for_status()
        retrieved_at = datetime.now(UTC)

        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            pattern = f"CIMT-CICM_Imp_{year}/ODPFN022_*.csv"
            member = next(name for name in archive.namelist() if fnmatch.fnmatch(name, pattern))
            with archive.open(member) as csv_file:
                df = pd.read_csv(csv_file, dtype=str)

        df.columns = _COLUMNS
        df = df[df["hs2"].isin(APPAREL_HS2_CHAPTERS)]

        rows: list[dict] = []
        for _, record in df.iterrows():
            rows.append(
                {
                    "month": datetime.strptime(record["year_month"], "%Y%m").date(),
                    "hs2_chapter": record["hs2"],
                    "hs2_label": APPAREL_HS2_CHAPTERS[record["hs2"]],
                    "country": record["country"],
                    "import_value_cad": float(record["value"]),
                    "retrieved_at": retrieved_at,
                    "source_url": url,
                }
            )
        return rows
    finally:
        if owns_client:
            client.close()
