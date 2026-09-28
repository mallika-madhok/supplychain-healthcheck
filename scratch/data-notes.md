# What the data actually is, and how it becomes the final Parquet files

Informal notes for your own understanding — not a spec, not committed to the repo.

## 0. The problem, in plain language

A small Canadian apparel importer — say, someone who buys knitwear from Vietnam and
Bangladesh, pays in US dollars, and ships it by ocean freight to sell in Canada — is
exposed to three things they usually have no easy way to monitor:

1. **Is it getting harder or more expensive to ship things right now, globally?** Ocean
   freight capacity, port congestion, and manufacturing delays move together in cycles.
   When they're bad, your goods take longer and cost more to arrive, even if nothing about
   *your* supplier changed.
2. **Is the US dollar getting more expensive relative to the Canadian dollar?** Most
   apparel is invoiced in USD. If CAD weakens against USD, the same order costs you more
   Canadian dollars than it did last month — even if your supplier's price in USD never
   moved.
3. **How many eggs are in how few baskets?** If 80% of your knitwear spend comes from one
   country, a single country-level disruption (a tariff change, a factory shutdown, a port
   strike) can hit most of your supply at once. If your spend is spread across five
   countries, the same disruption only touches a slice of it. This is "concentration risk,"
   and it applies to countries the same way it applies to a stock portfolio being
   concentrated in one company.

A large retailer has a team (or a paid data feed) watching all three. A small importer
usually just finds out the hard way — a shipment is late, or a Canadian-dollar invoice is
suddenly bigger than expected. This project pulls public government and central bank data
that already tracks all three pressures, and turns it into one plain-language monthly
reading, tailored to *your* specific mix of categories, countries, and currency, without
you having to track five different agencies yourself.

A couple of terms that show up below, defined once:

- **HS code / HS-level data**: "Harmonized System" code — the standardized numeric code
  every country's customs agency uses to classify traded goods (e.g. a specific HS code
  means "women's cotton knitwear," a different one means "leather footwear"). It's the
  thing that lets trade data be broken down finely, by exact product type, instead of just
  a broad label like "clothing."
- **NAICS code**: a coarser North American classification used for whole *industries*
  (e.g. "clothing manufacturing" as one industry) rather than individual products. Less
  precise than HS codes, but it's what the always-available, programmatically-fetchable
  StatCan data offers, so it's the fallback when HS-level detail isn't reachable on a
  weekly schedule (see section 1 below for why).
- **HHI (Herfindahl-Hirschman Index)**: a single number that measures how concentrated a
  mix is, on a scale that's low when spend is spread evenly across many countries and high
  when it's dominated by one or two. It's the standard tool economists and antitrust
  regulators use to measure market concentration — here it's repurposed to measure
  *sourcing* concentration instead of market share.
- **z-score**: how unusual a number is *for that specific series*, expressed as "how many
  standard deviations away from that series' own historical average." This is what lets
  three completely different measurements (a freight index, a currency's % change, an HHI
  value) get compared and combined on the same scale — each is judged against its own
  history, not against each other's raw units.

## 1. The raw inputs (one row = one observation, one source each)

| Source | Grain (one row = ...) | Frequency | Key columns |
|---|---|---|---|
| NY Fed GSCPI | one month, one GSCPI value | monthly | `month`, `gscpi_value` |
| BoC Valet (`FXUSDCAD`) | one calendar day, one exchange rate | daily | `date`, `usd_cad_rate` |
| StatCan 12-10-0176-01 | one month + one NAICS industry + one country, one trade dollar value | monthly | `month`, `naics_code`, `country`, `import_value_cad` |
| StatCan 18-10-0004-01/-06 | one month + one CPI product group, one index value | monthly | `month`, `product_group`, `cpi_index` |
| CIMT bulk CSV (HS-level) | one month + one HS code + one country, one trade dollar value | irregular (multi-year batches) | `month`, `hs_code`, `country`, `import_value_cad` |

Each of these lands as its own **raw/staging table** — nothing is joined yet. This is the
"land it exactly as received" step (stage 2 in the pipeline journey diagram): every row
also carries a `retrieved_at` timestamp and the source's own `release_date`, because
StatCan revises recent months after the fact and we don't want a later revision silently
overwriting what an earlier pull saw.

## 2. Staging: cleaning, without joining yet

Each raw table gets its own staging model that does *only* mechanical cleanup:

- rename cryptic source column names to something readable (`REF_DATE` -> `month`, etc.)
- cast types (StatCan gives you strings for things that are really dates/numbers)
- for revised sources, pick the *latest known* value per `(month, dimension)` combo — so
  if StatCan revised March's trade number in the May release, staging uses the May value,
  but the raw history of "what did we know and when" is still sitting underneath it
- filter the industry table down to apparel-relevant NAICS codes (315/316), and the CPI
  table down to the clothing/footwear product group

No cross-source logic here. A staging model for currency doesn't know origin-mix data
exists. This separation is what makes each piece independently testable.

## 3. The join: where the four sources actually meet

The **mart layer** is where sources combine, and the join key is almost always `month`
(currency gets resampled from daily to monthly first — see below). Roughly:

- **`origin_mix` mart**: the user's profile (categories + country/spend shares, entered in
  the browser, *not* stored server-side) is combined with the StatCan industry-trade
  staging table to compute two Herfindahl-Hirschman Index (HHI) series side by side for
  the same month: the user's own concentration, and the actual Canadian import mix's
  concentration for their category. Two different "populations," same formula, same month
  — that's the benchmark comparison from the brief.
- **`currency_exposure` mart**: daily FX staging data is aggregated up to monthly (rolling
  30-day % change for the level signal, rolling 90-day stdev for the volatility signal),
  then it's just one time series — no join needed yet, but it's later joined to the
  composite score on `month`.
- **`freight_pressure` mart**: GSCPI is already monthly, so this is mostly a pass-through
  with a z-score column added.
- **`composite_score` mart**: this is the one real join — it takes the three marts above,
  joins them all on `month`, z-scores each component against its own historical series in
  that same table, and averages the three z-scores into the headline score. This is the
  table the "results overview" page reads from.
- **`cpi_backtest` mart**: composite score joined to the clothing CPI staging table,
  offset by the backtest horizon (e.g. score at month *t* joined to CPI change from *t* to
  *t*+3), used only for the backtest write-up, not the live app.

## 4. Aggregation: turning rows into the numbers on screen

Two different kinds of aggregation happen, and it's worth keeping them mentally separate:

1. **Aggregation that happens in the pipeline (dbt, in MotherDuck)** — collapsing daily FX
   into monthly rolling stats, collapsing many country/industry trade rows into one HHI
   number per month, z-scoring against history. This runs once a week and produces the
   marts described above.
2. **Aggregation that happens live in the browser (DuckDB-Wasm)** — when a user moves the
   what-if slider, their hypothetical origin mix never touches the pipeline. It's a fresh
   HHI calculation run as a SQL query against the same committed Parquet files, entirely
   client-side, using the exact same formula the pipeline used to build the benchmark. Same
   math, two different places it runs, for two different reasons (one is "what happened,"
   the other is "what if").

## 5. What actually ends up in `data/*.parquet`

Each mart table above is exported as its own Parquet file after `dbt build` finishes:

- `composite_score.parquet` — the headline score + its three component z-scores, by month
- `currency_exposure.parquet`, `freight_pressure.parquet`, `origin_mix.parquet` — full
  history for each driver detail page
- `cpi_backtest.parquet` — supports the methodology/backtest write-up

These are small, columnar, and self-contained — no live database connection needed to read
them, which is the whole point: DuckDB-Wasm just needs `fetch()` and a URL.
