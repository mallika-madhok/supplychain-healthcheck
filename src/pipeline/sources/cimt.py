"""Extraction for StatCan's CIMT bulk HS6-level import data, rolled up to HS4 headings.

The HS2-chapter file only distinguishes knit apparel / woven apparel / footwear. The HS6
file (~190 MB per year) is what lets a user pick a real product line (t-shirts, sweaters,
jeans and trousers, leather footwear...). It is aggregated to 4-digit HS headings during
extraction: finer than a user needs, and keeps the landed table small.
"""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime

import httpx
import pandas as pd

CIMT_ZIP_URL_TEMPLATE = (
    "https://www150.statcan.gc.ca/n1/pub/71-607-x/2021004/zip/CIMT-CICM_Imp_{year}.zip"
)

# HS4 heading -> (chapter, label). Curated: the headings an apparel importer buys.
APPAREL_HS4_HEADINGS: dict[str, tuple[str, str]] = {
    # Chapter 61: knitted or crocheted apparel
    "6101": ("61", "Men's overcoats & anoraks (knit)"),
    "6102": ("61", "Women's overcoats & anoraks (knit)"),
    "6103": ("61", "Men's suits, jackets & trousers (knit)"),
    "6104": ("61", "Women's suits, dresses, skirts & trousers (knit)"),
    "6105": ("61", "Men's shirts (knit)"),
    "6106": ("61", "Women's blouses & shirts (knit)"),
    "6107": ("61", "Men's underwear & sleepwear (knit)"),
    "6108": ("61", "Women's underwear & sleepwear (knit)"),
    "6109": ("61", "T-shirts, singlets & tank tops (knit)"),
    "6110": ("61", "Sweaters, pullovers & hoodies (knit)"),
    "6111": ("61", "Babies' garments (knit)"),
    "6112": ("61", "Tracksuits, ski suits & swimwear (knit)"),
    "6113": ("61", "Garments of coated or laminated knit fabric"),
    "6114": ("61", "Other knit garments"),
    "6115": ("61", "Hosiery, tights & socks (knit)"),
    "6116": ("61", "Gloves & mittens (knit)"),
    "6117": ("61", "Other knit accessories & parts"),
    # Chapter 62: woven apparel
    "6201": ("62", "Men's overcoats, jackets & anoraks (woven)"),
    "6202": ("62", "Women's overcoats, jackets & anoraks (woven)"),
    "6203": ("62", "Men's suits, jackets, trousers & jeans (woven)"),
    "6204": ("62", "Women's suits, dresses, skirts & trousers (woven)"),
    "6205": ("62", "Men's shirts (woven)"),
    "6206": ("62", "Women's blouses & shirts (woven)"),
    "6207": ("62", "Men's underwear & sleepwear (woven)"),
    "6208": ("62", "Women's underwear & sleepwear (woven)"),
    "6209": ("62", "Babies' garments (woven)"),
    "6210": ("62", "Garments of felt, coated or laminated fabric"),
    "6211": ("62", "Tracksuits, ski suits, swimwear & other (woven)"),
    "6212": ("62", "Bras, girdles & corsets"),
    "6213": ("62", "Handkerchiefs"),
    "6214": ("62", "Shawls, scarves & veils"),
    "6215": ("62", "Ties & cravats"),
    "6216": ("62", "Gloves & mittens (woven)"),
    "6217": ("62", "Other made-up accessories & parts (woven)"),
    # Chapter 64: footwear
    "6401": ("64", "Waterproof footwear"),
    "6402": ("64", "Other rubber or plastic footwear"),
    "6403": ("64", "Leather footwear"),
    "6404": ("64", "Textile footwear"),
    "6405": ("64", "Other footwear"),
    # Accessories outside chapters 61/62/64
    "4202": ("42", "Handbags, wallets & luggage"),
    "6505": ("65", "Knit & fabric hats"),
    "6506": ("65", "Other headgear"),
}

_CHUNK_ROWS = 1_000_000


def fetch_cimt_hs4_imports(year: int, client: httpx.Client | None = None) -> list[dict]:
    """Fetch one calendar year's HS6 import data, aggregated to apparel HS4 headings.

    Returns one dict per (month, HS4 heading, country): month (date), hs4 (str),
    hs4_label (str), hs2_chapter (str), country (str, ISO2 code), import_value_cad (float),
    retrieved_at (UTC datetime), source_url (str).
    """
    owns_client = client is None
    client = client or httpx.Client(timeout=300.0, follow_redirects=True)
    url = CIMT_ZIP_URL_TEMPLATE.format(year=year)
    try:
        response = client.get(url)
        response.raise_for_status()
        retrieved_at = datetime.now(UTC)

        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            prefix = f"CIMT-CICM_Imp_{year}/ODPFN015_"
            member = next(
                name for name in archive.namelist()
                if name.startswith(prefix) and name.endswith(".csv")
            )
            kept: list[pd.DataFrame] = []
            with archive.open(member) as csv_file:
                reader = pd.read_csv(
                    csv_file, dtype=str, usecols=[0, 1, 2, 5],
                    names=["year_month", "hs6", "country", "value"], header=0,
                    chunksize=_CHUNK_ROWS,
                )
                for chunk in reader:
                    chunk["hs4"] = chunk["hs6"].str[:4]
                    chunk = chunk[chunk["hs4"].isin(APPAREL_HS4_HEADINGS)]
                    chunk["value"] = chunk["value"].astype(float)
                    kept.append(chunk)

        if not kept:
            return []
        df = pd.concat(kept)
        grouped = df.groupby(["year_month", "hs4", "country"], as_index=False)["value"].sum()

        rows: list[dict] = []
        for record in grouped.itertuples(index=False):
            chapter, label = APPAREL_HS4_HEADINGS[record.hs4]
            rows.append(
                {
                    "month": datetime.strptime(record.year_month, "%Y%m").date(),
                    "hs4": record.hs4,
                    "hs4_label": label,
                    "hs2_chapter": chapter,
                    "country": record.country,
                    "import_value_cad": float(record.value),
                    "retrieved_at": retrieved_at,
                    "source_url": url,
                }
            )
        return rows
    finally:
        if owns_client:
            client.close()
