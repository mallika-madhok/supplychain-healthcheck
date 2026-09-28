"""Extraction for StatCan apparel trade (12-10-0176-01) and clothing CPI (18-10-0004-01)."""

from __future__ import annotations

from datetime import datetime, timezone

from stats_can import scwds

TRADE_PRODUCT_ID = 12100176
CPI_PRODUCT_ID = 18100004
CPI_COORDINATE = "2.139.0.0.0.0.0.0.0.0"  # Canada, Clothing and footwear

# (memberId, label) — verified live against getCubeMetadata for 12100176, 2026-09-28
COUNTRIES: dict[str, tuple[int, str]] = {
    "total": (1, "Total of all countries"),
    "bangladesh": (19, "Bangladesh"),
    "cambodia": (40, "Cambodia"),
    "china": (47, "China"),
    "india": (102, "India"),
    "indonesia": (103, "Indonesia"),
    "vietnam": (225, "Viet Nam"),
}

# (memberId, label) — verified live against getCubeMetadata for 12100176, 2026-09-28
CATEGORY_NAICS: dict[str, tuple[int, str]] = {
    "knitwear": (305, "Apparel knitting mills"),
    "cut_and_sew": (308, "Cut and sew clothing manufacturing"),
    "accessories": (313, "Clothing accessories and other clothing manufacturing"),
    "footwear": (320, "Footwear manufacturing"),
}


def fetch_apparel_trade(periods: int = 6) -> list[dict]:
    """Fetch the latest N months of Canadian apparel imports by country and category.

    Returns one dict per (month, country, category) with a non-null value: month (date),
    country (str), naics_category (str), import_value_cad (float),
    retrieved_at (UTC datetime), release_time (str).
    """
    coord_lookup: dict[str, tuple[str, str]] = {}
    pairs: list[tuple[int, str]] = []
    for _, (country_id, country_label) in COUNTRIES.items():
        for _, (naics_id, naics_label) in CATEGORY_NAICS.items():
            coordinate = f"1.1.{country_id}.{naics_id}.0.0.0.0.0.0"
            coord_lookup[coordinate] = (country_label, naics_label)
            pairs.append((TRADE_PRODUCT_ID, coordinate))

    results = scwds.get_data_from_cube_pid_coord_and_latest_n_periods(pairs, periods)
    retrieved_at = datetime.now(timezone.utc)

    rows: list[dict] = []
    for result in results:
        country_label, naics_label = coord_lookup[result["coordinate"]]
        for point in result["vectorDataPoint"]:
            if point["value"] is None:
                continue
            rows.append(
                {
                    "month": datetime.strptime(point["refPer"], "%Y-%m-%d").date(),
                    "country": country_label,
                    "naics_category": naics_label,
                    "import_value_cad": float(point["value"]),
                    "retrieved_at": retrieved_at,
                    "release_time": point["releaseTime"],
                }
            )
    return rows


def fetch_clothing_cpi(periods: int = 6) -> list[dict]:
    """Fetch the latest N months of Canadian clothing and footwear CPI.

    Returns one dict per month with a non-null value: month (date),
    product_group (str), cpi_index (float), retrieved_at (UTC datetime),
    release_time (str).
    """
    pairs = [(CPI_PRODUCT_ID, CPI_COORDINATE)]
    results = scwds.get_data_from_cube_pid_coord_and_latest_n_periods(pairs, periods)
    retrieved_at = datetime.now(timezone.utc)

    rows: list[dict] = []
    for result in results:
        for point in result["vectorDataPoint"]:
            if point["value"] is None:
                continue
            rows.append(
                {
                    "month": datetime.strptime(point["refPer"], "%Y-%m-%d").date(),
                    "product_group": "Clothing and footwear",
                    "cpi_index": float(point["value"]),
                    "retrieved_at": retrieved_at,
                    "release_time": point["releaseTime"],
                }
            )
    return rows
