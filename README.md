# Canadian Apparel Import Pressure Monitor

**Try it live: https://mallika-madhok.github.io/supplychain-healthcheck/**

## Why should you care?

Three things you don't control decide what your next order really costs and when it arrives: global shipping, the exchange rate, and how much you rely on one supplier country. Most small importers only find out after the fact, when the shipment is already late or the invoice is already higher, and by then it is too late to do anything about it.

This app checks all three for your business and tells you what to do while you still have time to act:

| When the app shows | What you can do |
|---|---|
| Shipping is worse than usual | Order earlier and add a few weeks to the delivery dates you plan around, especially for seasonal launches |
| The exchange rate is moving against you | Budget the extra cost (shown in dollars for your purchases), lock in a rate with your bank before a big US dollar invoice, or check your retail prices still cover it |
| Too much of your buying comes from one country | Start getting quotes from a second country before a tariff change or port strike forces you to |

If all three are normal, that is useful too: keep ordering and budgeting as usual.

## What it looks at

1. **Shipping pressure:** how delayed and expensive it is to move goods around the world, compared with normal.
2. **Currency:** how much the price of a US dollar, in Canadian dollars, has been swinging. Most clothing is invoiced in US dollars, so when the Canadian dollar weakens your bill goes up even if your supplier's price has not changed.
3. **Supplier concentration:** how much of your stock depends on a handful of countries. The more it does, the harder one disruption hits you.

Each one gets a status (Normal, Worse than usual or Much worse than usual), a scale showing where today sits, and a "What you can do" note with a specific next step.

## How do I use it?

1. Pick what you mostly buy, like T-shirts, jeans or leather shoes.
2. Enter your monthly purchases and the share paid in US dollars.
3. Say roughly where your goods come from, by country.

Only the countries you add get a slider. Move anything and the answers update straight away. Not sure where to start? There are starting points for "what Canada as a whole imports", "one country does most of it" and "spread across many".

## How the answers are calculated

Each signal is compared with its own history, and the result is a **z-score**: how far today's value sits from its average, counted in standard deviations. A standard deviation is simply the size of a typical swing for that signal, which makes it a fair ruler for very different things like freight indexes and exchange rates.

⭐ **Around 0:** right at the average.

⭐ **Up to 1:** within a normal swing.

⭐ **1 to 2:** unusual. It happens, but not often.

⭐ **2 to 3:** rare.

⭐ **3 or more:** something is really off.

Below 1 is shown as **Normal**, 1 to 2 as **Worse than usual**, and above 2 as **Much worse than usual**.

| Signal | What is measured | Where the data comes from |
|---|---|---|
| Shipping | The Global Supply Chain Pressure Index, compared with its history since 1998. Also shown: how today ranks against every month since, and the change over the last three months | New York Fed |
| Currency | How far the USD/CAD rate moved over the last 30 trading days (about six weeks) and how jumpy it has been over the last 90, both compared with history since 2017. The dollar figures are simple arithmetic: your monthly purchases times your USD share, times the change in the rate | Bank of Canada |
| Suppliers | How concentrated your country mix is, measured by squaring each country's share and adding them up (one country at 100% gives 1, an even spread gives close to 0). Compared with how concentrated Canadian imports are across clothing and shoe product lines over the last 12 months | Statistics Canada import records, by product and country |

The tool does not predict your costs, and it says nothing about any particular supplier.
It shows when conditions are getting tougher and what you can do about it.

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

⭐ Your inputs are a rough picture of your buying, not your actual orders.

⭐ The dollar figures assume your purchase volume stays the same and that you pay spot rates. If you hedge, or your supplier changes its prices when the rate moves, your real numbers will differ.

⭐ History shows what is unusual. It is not a forecast, and this is not financial advice.

⭐ Country means where customs says the goods were made, which is not always where they were
  sewn.
⭐ The cut-offs for Worse than usual and Much worse than usual are my first-pass choice and have not been tested
  against real price changes yet.
