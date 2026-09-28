from datetime import date

from pipeline.sources import statcan


def test_fetch_apparel_trade_maps_coordinates_to_labels(monkeypatch):
    def fake_get_data(pairs, periods):
        assert periods == 2
        results = []
        for product_id, coordinate in pairs:
            assert product_id == statcan.TRADE_PRODUCT_ID
            results.append(
                {
                    "responseStatusCode": 0,
                    "productId": product_id,
                    "coordinate": coordinate,
                    "vectorId": 0,
                    "vectorDataPoint": [
                        {
                            "refPer": "2026-07-01",
                            "value": 1000.0,
                            "releaseTime": "2026-09-03T08:30",
                        }
                    ],
                }
            )
        return results

    monkeypatch.setattr(
        statcan.scwds, "get_data_from_cube_pid_coord_and_latest_n_periods", fake_get_data
    )

    rows = statcan.fetch_apparel_trade(periods=2)

    assert len(rows) == len(statcan.COUNTRIES) * len(statcan.CATEGORY_NAICS)
    bangladesh_knitwear = next(
        r
        for r in rows
        if r["country"] == "Bangladesh" and r["naics_category"] == "Apparel knitting mills"
    )
    assert bangladesh_knitwear["import_value_cad"] == 1000.0
    assert bangladesh_knitwear["month"] == date(2026, 7, 1)
    assert bangladesh_knitwear["release_time"] == "2026-09-03T08:30"


def test_fetch_apparel_trade_skips_null_values(monkeypatch):
    def fake_get_data(pairs, periods):
        product_id, coordinate = pairs[0]
        return [
            {
                "responseStatusCode": 0,
                "productId": product_id,
                "coordinate": coordinate,
                "vectorId": 0,
                "vectorDataPoint": [
                    {"refPer": "2026-07-01", "value": None, "releaseTime": "2026-09-03T08:30"}
                ],
            }
        ] + [
            {
                "responseStatusCode": 0,
                "productId": pid,
                "coordinate": coord,
                "vectorId": 0,
                "vectorDataPoint": [],
            }
            for pid, coord in pairs[1:]
        ]

    monkeypatch.setattr(
        statcan.scwds, "get_data_from_cube_pid_coord_and_latest_n_periods", fake_get_data
    )

    rows = statcan.fetch_apparel_trade(periods=1)
    assert rows == []


def test_fetch_clothing_cpi_returns_one_row_per_period(monkeypatch):
    def fake_get_data(pairs, periods):
        assert pairs == [(statcan.CPI_PRODUCT_ID, statcan.CPI_COORDINATE)]
        assert periods == 2
        return [
            {
                "responseStatusCode": 0,
                "productId": statcan.CPI_PRODUCT_ID,
                "coordinate": statcan.CPI_COORDINATE,
                "vectorId": 0,
                "vectorDataPoint": [
                    {"refPer": "2026-07-01", "value": 95.5, "releaseTime": "2026-08-17T08:30"},
                    {"refPer": "2026-08-01", "value": 94.7, "releaseTime": "2026-09-14T08:30"},
                ],
            }
        ]

    monkeypatch.setattr(
        statcan.scwds, "get_data_from_cube_pid_coord_and_latest_n_periods", fake_get_data
    )

    rows = statcan.fetch_clothing_cpi(periods=2)

    assert rows[0]["month"] == date(2026, 7, 1)
    assert rows[0]["cpi_index"] == 95.5
    assert rows[0]["product_group"] == "Clothing and footwear"
    assert rows[1]["month"] == date(2026, 8, 1)
    assert rows[1]["cpi_index"] == 94.7
