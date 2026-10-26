# Canadian Apparel Import Pressure Monitor

**Try it live: https://mallika-madhok.github.io/supplychain-healthcheck/**

## What this is

For small businesses importing clothing and shoes into Canada, the costs that matter most are the ones they do not control: dependence on a concentrated supplier mix (most of your stock from a handful of countries), shipping delays, and tariffs. Larger players have analysts tracking these signals. A smaller importer usually finds out when a shipment is late or an invoice comes in higher than expected.

This tool gives them an early signal. It turns free public data into a single monthly score
for their own mix of products, countries and currency, so they can see when conditions are
getting harder and decide whether to order earlier, spread suppliers or hedge currency
before the cost shows up.

## How to use it

1. Pick what you buy, like T-shirts, jeans or leather shoes.
2. Say how much of your buying is paid in US dollars.
3. Say roughly where your goods come from, by country.

You get one headline score, **Low**, **Elevated** or **High**, plus a breakdown of what is
pushing it up or down. Move any slider and everything updates straight away.

## What goes into the score

| Question | Where the answer comes from |
|---|---|
| Is global shipping under strain right now? | New York Fed supply chain index |
| Is the Canadian dollar moving a lot against the US dollar? | Bank of Canada exchange rates |
| Do you rely too heavily on one country? | Statistics Canada import records, by product and country |

Each one is compared with its own history, so "High" means "unusually high compared with
what is normal". The three results are averaged into the headline score.

The score does not predict your costs, and it says nothing about any particular supplier.
It is a way to see when conditions are getting tougher.

## Seeing how it works

Every chart in the app has a small "SQL & raw result" box underneath. Open it and you can see
the data table behind the chart and the exact query used to calculate it, so nothing is a
black box.

## How it stays up to date

Once a week, an automatic job downloads the latest data, cleans it up, recalculates
everything and updates the website. There is no server and nobody has to log in, and it all
runs on free services.

## For the technically curious

The pipeline runs like this:

1. **Python** downloads the raw data.
2. **dbt**, running on **MotherDuck** (a free cloud database), cleans and reshapes it.
3. The results are saved as small **Parquet** files in this repo.
4. The website, hosted on **GitHub Pages**, reads those files and does the calculations in
   your browser using **DuckDB-Wasm**. Your inputs never leave your device.
5. **GitHub Actions** runs steps 1 to 3 every Monday.

| Folder | What is in it |
|---|---|
| `src/pipeline/` | Python code that downloads and loads the data |
| `dbt/` | The cleaning and calculation steps, with data quality tests |
| `data/` | The finished data files |
| `docs/` | The website |
| `.github/workflows/` | The weekly update job |
| `tests/` | Tests for the Python code |

To run it yourself:

```bash
uv sync
uv run pytest

# Run the pipeline (needs a MotherDuck token saved as MOTHERDUCK_TOKEN in .env)
set -a && source .env && set +a
uv run python -m pipeline.extract
uv run python -m pipeline.extract_cimt
uv run python -m pipeline.load_motherduck
uv run dbt build --project-dir dbt --profiles-dir dbt/profiles
uv run python -m pipeline.export_marts

# View the website
cd docs && python3 -m http.server 8000
```

## Limits to keep in mind

- Your inputs are a rough picture of your buying, not your actual orders.
- Country means where customs says the goods were made, which is not always where they were
  sewn.
- The High / Elevated / Low cut-offs are my first-pass choice and have not been tested
  against real price changes yet.
