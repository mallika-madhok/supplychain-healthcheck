# Phase 1: Foundation & Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Stand up the project scaffold and Python extraction layer so that running one
command pulls real data from all confirmed sources (NY Fed GSCPI, Bank of Canada Valet FX,
StatCan apparel trade, StatCan clothing CPI) and lands it in a local DuckDB file with
revision-safe metadata, fully tested with no live network calls in the test suite.

**Architecture:** One small Python module per source under `src/pipeline/sources/`, each
exposing a pure `fetch_*()` function that returns `list[dict]` (no I/O side effects beyond
the network call). A single `land_rows()` function appends those rows into DuckDB tables,
creating them on first use and never deleting/overwriting. A CLI orchestrator in
`extract.py` calls all four weekly fetchers and lands them; the HS2-level CIMT bulk source
is a separate, standalone fetcher not wired into the weekly run (per the design spec, it
runs on its own slower cadence, wired up in a later phase).

**Tech Stack:** Python 3.12, `uv` for environment/dependency management, `httpx` for HTTP,
`pandas` + `xlrd` for the GSCPI Excel file, the `stats_can` package for StatCan WDS calls,
`duckdb` for local storage, `pytest` + `ruff`.

## Global Constraints

- No live network calls in the test suite — every source module is tested against a mocked
  HTTP transport or a monkeypatched `stats_can` call, using real captured response shapes.
- Every landed row carries `retrieved_at` (UTC timestamp of the pull); trade/CPI rows also
  carry the source's own `release_time`. Raw tables are append-only — `land_rows` never
  deletes or overwrites existing rows (per the design spec's revision-handling requirement).
- Source URLs and StatCan coordinates used below were verified live during planning
  (2026-09-28) — see inline comments citing the verification.
- `uv run pytest` and `uv run ruff check .` must both pass before any commit.

---

## File structure for this phase

```
pyproject.toml
src/pipeline/__init__.py
src/pipeline/sources/__init__.py
src/pipeline/sources/nyfed.py       # NY Fed GSCPI
src/pipeline/sources/boc.py         # Bank of Canada Valet FX
src/pipeline/sources/statcan.py     # StatCan WDS: apparel trade + clothing CPI
src/pipeline/sources/cimt.py        # StatCan CIMT bulk HS2-level imports (standalone)
src/pipeline/land.py                # generic DuckDB append helper
src/pipeline/extract.py             # CLI orchestrator for the 4 weekly sources
tests/test_nyfed.py
tests/test_boc.py
tests/test_statcan.py
tests/test_cimt.py
tests/test_land.py
tests/test_extract.py
```

---

### Task 1: Project scaffold and tooling

**Files:**
- Create: `pyproject.toml`
- Create: `src/pipeline/__init__.py`
- Create: `src/pipeline/sources/__init__.py`
- Create: `tests/test_smoke.py`

**Interfaces:**
- Produces: a working `uv` environment; `uv run pytest` and `uv run ruff check .` as the
  standard commands every later task uses.

- [x] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "pipeline"
version = "0.1.0"
description = "Canadian Apparel Import Pressure Monitor data pipeline"
requires-python = ">=3.12"
dependencies = [
    "httpx>=0.27",
    "pandas>=2.2",
    "xlrd>=2.0",
    "stats-can>=3.3.0",
    "duckdb>=1.0",
]

[dependency-groups]
dev = [
    "pytest>=8.0",
    "ruff>=0.6",
    "openpyxl>=3.1",
]

[tool.ruff]
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "UP"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/pipeline"]
```

- [x] **Step 2: Create the package skeleton**

```bash
mkdir -p src/pipeline/sources tests
touch src/pipeline/__init__.py src/pipeline/sources/__init__.py
```

- [x] **Step 3: Write a smoke test**

```python
# tests/test_smoke.py
def test_smoke():
    assert True
```

- [x] **Step 4: Sync the environment and run the smoke test**

Run: `uv sync && uv run pytest -v`
Expected: `tests/test_smoke.py::test_smoke PASSED`, 1 passed.

- [x] **Step 5: Verify ruff runs clean**

Run: `uv run ruff check .`
Expected: `All checks passed!`

- [x] **Step 6: Commit**

```bash
git add pyproject.toml src/pipeline tests/test_smoke.py .python-version 2>/dev/null; git add uv.lock
git commit -m "chore: scaffold Python project with uv, pytest, ruff"
```

---

### Task 2: NY Fed GSCPI extraction

**Verified facts (2026-09-28):** `GET https://www.newyorkfed.org/medialibrary/research/interactives/gscpi/downloads/gscpi_data.xlsx`
returns a legacy `.xls`-format file (despite the `.xlsx` extension) with two sheets,
`"GSCPI Overview"` and `"GSCPI Monthly Data"`. The monthly sheet has a header row
(`Date`, `GSCPI`) followed by a few decorative letterhead rows with blank `Date`/`GSCPI`
cells, then real data rows starting at January 1998. Confirmed by downloading and
inspecting the file directly: `Date` values are **plain strings** like `"31-Jan-1998"`
(format `%d-%b-%Y`), not native datetimes, and `GSCPI` is a float. `pandas.read_excel`
auto-selects the `xlrd` engine for this legacy format with no extra argument needed.

**Files:**
- Create: `src/pipeline/sources/nyfed.py`
- Test: `tests/test_nyfed.py`

**Interfaces:**
- Produces: `fetch_gscpi(client: httpx.Client | None = None) -> list[dict]`, each dict:
  `{"month": date, "gscpi_value": float, "retrieved_at": datetime, "source_url": str}`
- Produces: `GSCPI_URL: str` (module-level constant, used by later tasks/tests)

- [x] **Step 1: Write the failing test**

```python
# tests/test_nyfed.py
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
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_nyfed.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline.sources.nyfed'`

- [x] **Step 3: Write the implementation**

```python
# src/pipeline/sources/nyfed.py
"""Extraction for the NY Fed Global Supply Chain Pressure Index (GSCPI)."""

from __future__ import annotations

import io
from datetime import date, datetime, timezone

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
        retrieved_at = datetime.now(timezone.utc)

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
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_nyfed.py -v`
Expected: 2 passed.

- [x] **Step 5: Commit**

```bash
git add src/pipeline/sources/nyfed.py tests/test_nyfed.py
git commit -m "feat: add NY Fed GSCPI extraction"
```

---

### Task 3: Bank of Canada Valet FX extraction

**Verified facts (2026-09-28):** `GET https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json`
returns `{"terms": ..., "seriesDetail": ..., "observations": [{"d": "2026-09-25",
"FXUSDCAD": {"v": "1.4145"}}, ...]}` — confirmed live. No auth required. Per the design
spec, only pull from `2017-03-01` onward (the BoC methodology-change floor) using the
`start_date` query parameter documented for this endpoint.

**Files:**
- Create: `src/pipeline/sources/boc.py`
- Test: `tests/test_boc.py`

**Interfaces:**
- Produces: `fetch_fx_usd_cad(client: httpx.Client | None = None) -> list[dict]`, each dict:
  `{"date": date, "usd_cad_rate": float, "retrieved_at": datetime, "source_url": str}`
- Produces: `BOC_URL: str`, `BOC_RELIABLE_START_DATE = "2017-03-01"`

- [x] **Step 1: Write the failing test**

```python
# tests/test_boc.py
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
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_boc.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline.sources.boc'`

- [x] **Step 3: Write the implementation**

```python
# src/pipeline/sources/boc.py
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
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_boc.py -v`
Expected: 2 passed.

- [x] **Step 5: Commit**

```bash
git add src/pipeline/sources/boc.py tests/test_boc.py
git commit -m "feat: add Bank of Canada Valet FX extraction"
```

---

### Task 4: StatCan apparel trade + clothing CPI extraction

**Verified facts (2026-09-28), confirmed by live calls to the WDS API:**

- `POST https://www150.statcan.gc.ca/t1/wds/rest/getDataFromCubePidCoordAndLatestNPeriods`
  works with body `[{"productId": <int>, "coordinate": "<10-part dot string>", "latestN": <int>}]`
  and returns `[{"status": "SUCCESS", "object": {"productId": ..., "coordinate": ...,
  "vectorId": ..., "vectorDataPoint": [{"refPer": "2026-06-01", "value": 24887918.0,
  "releaseTime": "2026-09-03T08:30", ...}, ...]}}]`. The `stats_can` package wraps this
  exact endpoint as `stats_can.scwds.get_data_from_cube_pid_coord_and_latest_n_periods(pairs,
  periods)`, taking `pairs: list[tuple[productId, coordinate]]` and returning
  `list[VectorData]` (a `TypedDict` with the same keys as the raw API object — no `"status"`
  wrapper, the library unwraps it).
- **Trade table 12-10-0176-01** (`productId=12100176`): dimensions are Geography (Canada=1,
  only member), Trade (Imports=1, Exports=2), Trading Partners, NAICS. Confirmed apparel
  NAICS members exist: `305`="Apparel knitting mills", `308`="Cut and sew clothing
  manufacturing", `313`="Clothing accessories and other clothing manufacturing",
  `320`="Footwear manufacturing". Confirmed country members: `1`="Total of all countries",
  `19`="Bangladesh", `40`="Cambodia", `47`="China", `102`="India", `103`="Indonesia",
  `225`="Viet Nam". A live test call with coordinate `"1.1.19.305.0.0.0.0.0.0"` (Canada,
  Imports, Bangladesh, Apparel knitting mills) returned real June/July 2026 values.
- **CPI table 18-10-0004-01** (`productId=18100004`): dimensions are Geography (Canada=2)
  and Products and product groups. Confirmed member `139`="Clothing and footwear". A live
  test call with coordinate `"2.139.0.0.0.0.0.0.0.0"` returned real July/Aug 2026 index
  values (95.5, 94.7).

**Files:**
- Create: `src/pipeline/sources/statcan.py`
- Test: `tests/test_statcan.py`

**Interfaces:**
- Produces: `fetch_apparel_trade(periods: int = 6) -> list[dict]`, each dict:
  `{"month": date, "country": str, "naics_category": str, "import_value_cad": float,
  "retrieved_at": datetime, "release_time": str}`
- Produces: `fetch_clothing_cpi(periods: int = 6) -> list[dict]`, each dict:
  `{"month": date, "product_group": str, "cpi_index": float, "retrieved_at": datetime,
  "release_time": str}`
- Produces: `COUNTRIES: dict[str, tuple[int, str]]`, `CATEGORY_NAICS: dict[str, tuple[int,
  str]]`, `TRADE_PRODUCT_ID = 12100176`, `CPI_PRODUCT_ID = 18100004`,
  `CPI_COORDINATE = "2.139.0.0.0.0.0.0.0.0"` (module-level constants, used by later phases
  to build dbt sources).

- [x] **Step 1: Write the failing tests**

```python
# tests/test_statcan.py
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
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_statcan.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline.sources.statcan'`

- [x] **Step 3: Write the implementation**

```python
# src/pipeline/sources/statcan.py
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
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_statcan.py -v`
Expected: 3 passed.

- [x] **Step 5: Commit**

```bash
git add src/pipeline/sources/statcan.py tests/test_statcan.py
git commit -m "feat: add StatCan apparel trade and clothing CPI extraction"
```

---

### Task 5: DuckDB landing layer

**Files:**
- Create: `src/pipeline/land.py`
- Test: `tests/test_land.py`

**Interfaces:**
- Consumes: nothing from earlier tasks (generic over any `list[dict]`).
- Produces: `land_rows(con: duckdb.DuckDBPyConnection, table_name: str, rows: list[dict]) ->
  int`, used by Task 6's orchestrator and by every later phase that lands new raw data.

- [x] **Step 1: Write the failing test**

```python
# tests/test_land.py
from datetime import date

import duckdb

from pipeline import land


def test_land_rows_creates_table_and_returns_count(tmp_path):
    con = duckdb.connect(str(tmp_path / "raw.duckdb"))
    inserted = land.land_rows(
        con,
        "raw_test",
        [
            {"month": date(2026, 1, 1), "value": 1.0},
            {"month": date(2026, 2, 1), "value": 2.0},
        ],
    )
    assert inserted == 2
    assert con.execute("SELECT count(*) FROM raw_test").fetchone()[0] == 2


def test_land_rows_appends_without_deleting_existing_rows(tmp_path):
    con = duckdb.connect(str(tmp_path / "raw.duckdb"))
    land.land_rows(con, "raw_test", [{"month": date(2026, 1, 1), "value": 1.0}])
    second_count = land.land_rows(con, "raw_test", [{"month": date(2026, 2, 1), "value": 2.0}])

    assert second_count == 1
    assert con.execute("SELECT count(*) FROM raw_test").fetchone()[0] == 2


def test_land_rows_handles_empty_input(tmp_path):
    con = duckdb.connect(str(tmp_path / "raw.duckdb"))
    inserted = land.land_rows(con, "raw_empty", [])
    assert inserted == 0
    tables = con.execute("SELECT table_name FROM information_schema.tables").fetchall()
    assert ("raw_empty",) not in tables
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_land.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline.land'`

- [x] **Step 3: Write the implementation**

```python
# src/pipeline/land.py
"""Generic, revision-safe append of extracted rows into DuckDB."""

from __future__ import annotations

import duckdb
import pandas as pd


def land_rows(con: duckdb.DuckDBPyConnection, table_name: str, rows: list[dict]) -> int:
    """Append rows to table_name, creating it on first use.

    Never deletes or overwrites existing rows — each call is a pure append, which is
    what makes it safe for sources (like StatCan trade data) that revise recent history:
    a later pull's revised value lands as a new row alongside the original.
    """
    if not rows:
        return 0
    df = pd.DataFrame(rows)
    con.register("_land_incoming", df)
    try:
        con.execute(f"CREATE TABLE IF NOT EXISTS {table_name} AS SELECT * FROM _land_incoming LIMIT 0")
        con.execute(f"INSERT INTO {table_name} SELECT * FROM _land_incoming")
    finally:
        con.unregister("_land_incoming")
    return len(df)
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_land.py -v`
Expected: 3 passed.

- [x] **Step 5: Commit**

```bash
git add src/pipeline/land.py tests/test_land.py
git commit -m "feat: add revision-safe DuckDB landing helper"
```

---

### Task 6: CLI extraction orchestrator

**Files:**
- Create: `src/pipeline/extract.py`
- Test: `tests/test_extract.py`

**Interfaces:**
- Consumes: `fetch_gscpi` (Task 2), `fetch_fx_usd_cad` (Task 3), `fetch_apparel_trade` and
  `fetch_clothing_cpi` (Task 4), `land_rows` (Task 5).
- Produces: `run() -> dict[str, int]` (table name -> rows landed), `DB_PATH: pathlib.Path`.
  This is the entry point Phase 3's GitHub Actions workflow calls.

- [x] **Step 1: Write the failing test**

```python
# tests/test_extract.py
from datetime import date, datetime, timezone

from pipeline import extract


def test_run_lands_all_four_weekly_sources(monkeypatch, tmp_path):
    monkeypatch.setattr(extract, "DB_PATH", tmp_path / "raw.duckdb")
    now = datetime.now(timezone.utc)

    monkeypatch.setattr(
        extract,
        "fetch_gscpi",
        lambda: [{"month": date(2026, 1, 1), "gscpi_value": 1.0, "retrieved_at": now, "source_url": "x"}],
    )
    monkeypatch.setattr(
        extract,
        "fetch_fx_usd_cad",
        lambda: [{"date": date(2026, 1, 1), "usd_cad_rate": 1.4, "retrieved_at": now, "source_url": "x"}],
    )
    monkeypatch.setattr(extract, "fetch_apparel_trade", lambda: [])
    monkeypatch.setattr(extract, "fetch_clothing_cpi", lambda: [])

    counts = extract.run()

    assert counts == {"raw_gscpi": 1, "raw_fx": 1, "raw_trade": 0, "raw_cpi": 0}
    assert (tmp_path / "raw.duckdb").exists()
```

- [x] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_extract.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline.extract'`

- [x] **Step 3: Write the implementation**

```python
# src/pipeline/extract.py
"""CLI entry point: pull all four weekly sources and land them into DuckDB."""

from __future__ import annotations

import pathlib

import duckdb

from pipeline.land import land_rows
from pipeline.sources.boc import fetch_fx_usd_cad
from pipeline.sources.nyfed import fetch_gscpi
from pipeline.sources.statcan import fetch_apparel_trade, fetch_clothing_cpi

DB_PATH = pathlib.Path("data/raw.duckdb")


def run() -> dict[str, int]:
    """Pull all four weekly sources and land them. Returns rows landed per table."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB_PATH))
    try:
        return {
            "raw_gscpi": land_rows(con, "raw_gscpi", fetch_gscpi()),
            "raw_fx": land_rows(con, "raw_fx", fetch_fx_usd_cad()),
            "raw_trade": land_rows(con, "raw_trade", fetch_apparel_trade()),
            "raw_cpi": land_rows(con, "raw_cpi", fetch_clothing_cpi()),
        }
    finally:
        con.close()


if __name__ == "__main__":
    print(run())
```

- [x] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/test_extract.py -v`
Expected: 1 passed.

- [x] **Step 5: Run the full test suite and lint**

Run: `uv run pytest -v && uv run ruff check .`
Expected: all tests passed, `All checks passed!`

- [x] **Step 6: Commit**

```bash
git add src/pipeline/extract.py tests/test_extract.py
git commit -m "feat: add CLI orchestrator wiring the four weekly sources together"
```

- [x] **Step 7: Add `data/` (DuckDB output) to `.gitignore` and verify a live run**

```bash
printf '\n# local pipeline output\ndata/*.duckdb\ndata/*.duckdb.wal\n' >> .gitignore
git add .gitignore
git commit -m "chore: ignore local DuckDB pipeline output"
```

Run: `uv run python -m pipeline.extract`
Expected: prints a dict like `{'raw_gscpi': 348, 'raw_fx': ..., 'raw_trade': ..., 'raw_cpi': ...}`
with real nonzero counts — confirms all four live sources actually work end to end, not
just against mocks. This is a manual verification step, not part of CI (CI only runs the
mocked test suite per the Global Constraints).

---

### Task 7: CIMT HS2-level bulk import extraction (standalone)

**Verified facts (2026-09-28):** The Open Government Portal's current CIMT dataset
(`package_show?id=2909a648-5753-4924-878a-b069392d9cde`, "CIMT 2023-2026") publishes one
zip per calendar year at a stable URL pattern:
`https://www150.statcan.gc.ca/n1/pub/71-607-x/2021004/zip/CIMT-CICM_Imp_{year}.zip`. Each
zip contains, among other files, an HS2-chapter-level CSV named
`CIMT-CICM_Imp_{year}/ODPFN022_{YYYYMM}N.csv` (the date suffix advances as the year's data
updates, so it must be found by pattern, not hardcoded) with columns
`YearMonth/AnnéeMois,HS2,Country/Pays,Province,State/État,Value/Valeur` — confirmed by
downloading the live 2026 file directly. This file is ~10MB (unlike the HS10-level file in
the same zip, which is ~170MB) and gives genuinely useful apparel granularity via standard
HS chapters: **61** = "Apparel and clothing accessories, knitted or crocheted", **62** =
"Apparel and clothing accessories, not knitted or crocheted", **64** = "Footwear, gaiters
and the like".

This is deliberately **not** wired into Task 6's `extract.run()` — per the design spec,
this source runs on its own slower cadence (the portal updates it a few times a year, not
weekly), scheduled separately in Phase 3.

**Files:**
- Create: `src/pipeline/sources/cimt.py`
- Test: `tests/test_cimt.py`

**Interfaces:**
- Produces: `fetch_cimt_hs2_imports(year: int, client: httpx.Client | None = None) ->
  list[dict]`, each dict: `{"month": date, "hs2_chapter": str, "hs2_label": str, "country":
  str, "import_value_cad": float, "retrieved_at": datetime, "source_url": str}`
- Produces: `CIMT_ZIP_URL_TEMPLATE: str`, `APPAREL_HS2_CHAPTERS: dict[str, str]`

- [x] **Step 1: Write the failing test**

```python
# tests/test_cimt.py
import io
import zipfile
from datetime import date

import httpx

from pipeline.sources import cimt


def _build_zip(csv_content: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("CIMT-CICM_Imp_2026/ODPFN022_202601N.csv", csv_content)
    return buffer.getvalue()


def test_fetch_cimt_hs2_imports_filters_to_apparel_chapters():
    csv_content = (
        "YearMonth/AnnéeMois,HS2,Country/Pays,Province,State/État,Value/Valeur\n"
        '"202601","61","BD","ON",,50000\n'
        '"202601","62","VN","BC",,75000\n'
        '"202601","01","AU","BC",,42472\n'
    )
    zip_bytes = _build_zip(csv_content)

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == cimt.CIMT_ZIP_URL_TEMPLATE.format(year=2026)
        return httpx.Response(200, content=zip_bytes)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    rows = cimt.fetch_cimt_hs2_imports(2026, client=client)

    assert len(rows) == 2
    knit = next(r for r in rows if r["hs2_chapter"] == "61")
    assert knit["month"] == date(2026, 1, 1)
    assert knit["country"] == "BD"
    assert knit["import_value_cad"] == 50000.0
    assert knit["hs2_label"] == "Apparel and clothing accessories, knitted or crocheted"

    woven = next(r for r in rows if r["hs2_chapter"] == "62")
    assert woven["country"] == "VN"
    assert woven["import_value_cad"] == 75000.0
```

- [x] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_cimt.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline.sources.cimt'`

- [x] **Step 3: Write the implementation**

```python
# src/pipeline/sources/cimt.py
"""Extraction for StatCan's CIMT bulk HS2-chapter-level import data."""

from __future__ import annotations

import fnmatch
import io
import zipfile
from datetime import datetime, timezone

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
        retrieved_at = datetime.now(timezone.utc)

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
```

- [x] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/test_cimt.py -v`
Expected: 1 passed.

- [x] **Step 5: Run the full test suite and lint one more time**

Run: `uv run pytest -v && uv run ruff check .`
Expected: all tests passed (12 total across all Task 1-7 tests), `All checks passed!`

- [x] **Step 6: Commit**

```bash
git add src/pipeline/sources/cimt.py tests/test_cimt.py
git commit -m "feat: add standalone CIMT HS2-level apparel import extraction"
```

---

## Phase 1 definition of done

- `uv run python -m pipeline.extract` pulls real data from NY Fed, BoC, and both StatCan
  tables and lands it in `data/raw.duckdb` with `retrieved_at` metadata on every row.
- `uv run pytest` passes with zero live network calls.
- `uv run ruff check .` passes clean.
- The CIMT HS2 extractor works standalone (`fetch_cimt_hs2_imports(2026)`) but is not yet
  scheduled — that's Phase 3.
- Every StatCan coordinate and NAICS/HS mapping used is backed by a live-verified value
  from this planning session, not a guess — closing the open item from the design spec
  about the StatCan WDS 503 encountered during research.
