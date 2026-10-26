# Canadian Apparel Import Pressure Monitor

**Try it live: https://mallika-madhok.github.io/supplychain-healthcheck/**

**Why should you care?** Shipping delays, exchange rates and relying on too few supplier countries can raise a small importer's costs, and you usually find out from the invoice. This app shows you where each one stands today, puts the exchange rate in dollars for your own purchases, and suggests what to do, so you can order earlier, budget a cushion or add a supplier before it costs you.

## So, what is this?

For small businesses importing clothing and shoes into Canada, the costs that matter most are the ones they do not control. Larger players have analysts tracking the forces behind them. A smaller importer usually finds out when a shipment is late or an invoice comes in higher than expected.

This app gives you an early read on three of them, using free public data, based on your own purchases:

1. **Shipping pressure:** how delayed and expensive it is to move goods around the world, compared with normal.
2. **Currency:** how much the price of a US dollar, in Canadian dollars, has been swinging. Most clothing is invoiced in US dollars, so when the Canadian dollar weakens your bill goes up even if your supplier's price has not changed.
3. **Supplier concentration:** how much of your stock depends on a handful of countries. The more it does, the harder one disruption hits you, whether that is a tariff change, a port strike or a factory shutdown.

## What you get

You get three plain answers instead of a dashboard to interpret:

- **Shipping:** where it stands against every month since 1998, whether it is getting tighter or easing, and whether to order earlier.
- **Currency, in dollars:** what the exchange rate has done to your US dollar purchases compared with a year ago, and what a typical swing costs you per month.
- **Suppliers:** how exposed your country mix is, with a specific suggestion (for example, move 10 points from your biggest supplier to another major source) that you can try out with one click.

Each one is marked Normal, Worse than usual or Much worse than usual and ends with a short "worth considering" note. A line chart shows how today compares with past squeezes like 2021 to 2022.

## How do I use it?

1. Pick what you mostly buy, like T-shirts, jeans or leather shoes.
2. Enter your monthly purchases and the share paid in US dollars.
3. Say roughly where your goods come from, by country.

Move anything and the answers update straight away. Not sure where to start? There are starting points for "what Canada as a whole imports", "one country does most of it" and "spread across many".

## How the answers are calculated

Each signal is compared with its own history, and the result is a **z-score**: how far today's value sits from its average, counted in standard deviations. A standard deviation is simply the size of a typical swing for that signal, which makes it a fair ruler for very different things like freight indexes and exchange rates.

- **Around 0:** right at the average.
- **Up to 1:** within a normal swing.
- **1 to 2:** unusual. It happens, but not often.
- **2 to 3:** rare.
- **3 or more:** something is really off.

Below 1 is shown as **Normal**, 1 to 2 as **Worse than usual**, and above 2 as **Much worse than usual**.

| Signal | What is measured | Where the data comes from |
|---|---|---|
| Shipping | The Global Supply Chain Pressure Index, compared with its history since 1998. Also shown: how today ranks against every month since, and the change over the last three months | New York Fed |
| Currency | How far the USD/CAD rate moved over the last 30 trading days (about six weeks) and how jumpy it has been over the last 90, both compared with history since 2017. The dollar figures are simple arithmetic: your monthly purchases times your USD share, times the change in the rate | Bank of Canada |
| Suppliers | How concentrated your country mix is, measured by squaring each country's share and adding them up (one country at 100% gives 1, an even spread gives close to 0). Compared with how concentrated Canadian imports are across clothing and shoe product lines over the last 12 months | Statistics Canada import records, by product and country |

The line chart on the Overview tab averages the three z-scores equally, with currency multiplied by your USD share, so it moves when you change your profile.

The tool does not predict your costs, and it says nothing about any particular supplier.
It shows when conditions are getting tougher and what you could do about it.

## Seeing how it works

Every section of the app has a "See the data and SQL behind this" box underneath. Open it and you can see
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
- The dollar figures assume your purchase volume stays the same and that you pay spot rates. If you hedge, or your supplier changes its prices when the rate moves, your real numbers will differ.
- History shows what is unusual. It is not a forecast, and this is not financial advice.
- Country means where customs says the goods were made, which is not always where they were
  sewn.
- The cut-offs for Worse than usual and Much worse than usual are my first-pass choice and have not been tested
  against real price changes yet.
