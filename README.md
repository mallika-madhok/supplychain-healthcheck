# Canadian Apparel Import Pressure Monitor

**Live app: https://mallika-madhok.github.io/supplychain-healthcheck/**

A free, open-source tool that turns public trade, currency and supply-chain data into a
single monthly "pressure" reading for a small Canadian apparel importer. You describe your
product category, country mix and USD exposure, and the page scores how unusual current
conditions are for *your* profile, with the SQL behind every number shown next to it.

The data pipeline is the main artifact; the frontend is a thin, static view of its output.

## How it works

```
GitHub Actions (weekly cron)
  Python extraction  ->  local DuckDB (raw)  ->  MotherDuck (raw schema)
       -> dbt (staging -> marts, runs on MotherDuck)
       -> export marts to Parquet -> committed to data/ and docs/data/
GitHub Pages (static: HTML/CSS/JS + DuckDB-Wasm + Plotly)
  loads the Parquet files and runs SQL in the visitor's browser
```

- **No backend, no accounts, no tokens in the browser.** The site only reads the committed
  Parquet files. MotherDuck is used by the pipeline alone.
- **Zero spend.** GitHub Actions, GitHub Pages and the MotherDuck free tier (no card on file).

## Data sources

| Series | Source | Coverage |
|---|---|---|
| Freight & delay pressure | NY Fed Global Supply Chain Pressure Index | Monthly, 1998 on |
| Currency (USD/CAD) | Bank of Canada Valet API | Daily, 2017-03-01 on |
| Origin concentration and country mix | StatCan CIMT bulk imports (HS6 rolled up to 42 HS4 headings) | Monthly, 2023 on |
| Apparel trade and clothing CPI | StatCan WDS (landed, not yet used in marts) | Monthly |

## Scoring

Three z-scores, equal-weighted into a composite. Bands: below 0 Low, 0 to 1 Elevated, above 1
High (provisional, not yet backtested).

1. **Freight**: GSCPI vs. its own history.
2. **Currency**: USD/CAD 30-trading-day change and 90-day volatility, averaged, then scaled by
   the visitor's USD-invoiced share.
3. **Origin concentration**: HHI of the visitor's country mix vs. the spread of HHI across
   Canadian apparel product lines over the last 12 months.

See the Methodology tab in the app for limitations.

## Repository layout

| Path | Contents |
|---|---|
| `src/pipeline/` | Extraction (`sources/`), revision-safe landing, MotherDuck loader, Parquet export |
| `dbt/` | Staging and mart models, tests, MotherDuck profile |
| `data/` | Exported mart Parquet files (also copied to `docs/data/` for the site) |
| `docs/` | The static site served by GitHub Pages |
| `.github/workflows/refresh.yml` | Weekly refresh: extract, load, `dbt build`, export, commit |
| `tests/` | pytest suite for the extraction code |
| `docs/superpowers/` | Design spec and phase plans |

## Run it locally

```bash
uv sync
uv run pytest && uv run ruff check .

# Pipeline (needs MOTHERDUCK_TOKEN in .env)
set -a && source .env && set +a
uv run python -m pipeline.extract
uv run python -m pipeline.extract_cimt      # downloads ~80 MB per year
uv run python -m pipeline.load_motherduck
uv run dbt build --project-dir dbt --profiles-dir dbt/profiles
uv run python -m pipeline.export_marts

# Site
cd docs && python3 -m http.server 8000      # open http://localhost:8000
```

## Deployment

- **Pages**: Settings, Pages, deploy from branch `master`, folder `/docs`.
- **Refresh job**: add the `MOTHERDUCK_TOKEN` repository secret, then run the *Refresh data*
  workflow from the Actions tab (it also runs every Monday).

## Limitations

- The score describes how unusual conditions are relative to history. It is not a forecast
  and says nothing about any specific supplier.
- Your profile is a hypothetical spend mix, not actual purchases.
- Origin is customs country of origin, which can differ from where goods were sewn.
- Currency windows are counted in trading days, not calendar days.
