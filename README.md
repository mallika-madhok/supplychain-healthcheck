# Canadian Apparel Import Pressure Monitor

**Try it live: https://mallika-madhok.github.io/supplychain-healthcheck/**

## So, what is this?

For small businesses importing clothing and shoes into Canada, the costs that matter most are the ones they do not control. Larger players have analysts tracking the forces behind them. A smaller importer usually finds out when a shipment is late or an invoice comes in higher than expected.

This app gives you an early read on three signals, using free public data, based on your own mix of products, countries and currency:

1. **Shipping pressure:** how delayed and expensive it is to move goods around the world, compared with normal.
2. **Currency:** how much the price of a US dollar, in Canadian dollars, has been swinging. Most clothing is invoiced in US dollars, so when the Canadian dollar weakens your bill goes up even if your supplier's price has not changed.
3. **Supplier concentration:** how much of your stock depends on a handful of countries. The more it does, the harder one disruption hits you, whether that is a tariff change, a port strike or a factory shutdown.

You get one headline score, **Low**, **Elevated** or **High**, plus a breakdown of which signal is driving it.

## How do I use it?

1. Pick what you buy, like T-shirts, jeans or leather shoes.
2. Say how much of your buying is paid in US dollars.
3. Say roughly where your goods come from, by country.

Move any slider and everything updates straight away.

## How the score is calculated

Each signal is compared with its own history, and the result is a **z-score**: how far today's value sits from its average, counted in standard deviations. A standard deviation is simply the size of a typical swing for that signal, which makes it a fair ruler for very different things like freight indexes and exchange rates.

- **Around 0:** right at the average.
- **Up to 1:** within a normal swing.
- **2:** unusual. It happens, but not often.
- **3 or more:** something is really off.

Because every signal ends up on this one scale, the three can be averaged into a single score.

| Signal | What is measured | Where the data comes from |
|---|---|---|
| Shipping pressure | The Global Supply Chain Pressure Index, compared with its history since 1998 | New York Fed |
| Currency | How far the USD/CAD exchange rate moved over the last 30 trading days, and how unstable it has been over the last 90. Both are compared with history since 2017 and averaged, then scaled by your USD share, so a business that pays mostly in other currencies feels less of it | Bank of Canada |
| Supplier concentration | How concentrated your country mix is, measured by squaring each country's share and adding them up (one country at 100% gives 1, an even spread gives close to 0). Compared with how concentrated Canadian imports are across clothing and shoe product lines over the last 12 months | Statistics Canada import records, by product and country |

The three results are averaged. Below 0 is **Low**, 0 to 1 is **Elevated**, and above 1 is **High**.

The score does not predict your costs, and it says nothing about any particular supplier.
It shows when conditions are getting tougher.

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
