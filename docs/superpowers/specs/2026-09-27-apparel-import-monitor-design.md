# Design Spec: Canadian Apparel Import Pressure Monitor

Status: approved by author (Mallika), 2026-09-27
Source brief: `PROJECT_BRIEF.md`

## 1. Purpose

This spec records the architecture, data source, transformation, scoring, and frontend
decisions made in the planning session with Claude Code, following the constraints and
open questions in `PROJECT_BRIEF.md`. It is the input to the implementation plan
(`writing-plans` skill), not implementation detail itself.

## 2. Guiding decisions from this session

- Everything must be self-hostable, open source/free tooling.
- The finished app must be interactable and live on the author's GitHub Pages site
  (not merely linked to from it), so the frontend must be static-hostable.
- The data pipeline / analytics engineering layer is the primary artifact to showcase in
  interviews (target roles: analytics/BI consulting, e.g. Aritzia). The frontend is a
  vehicle for that, not the showcase — it should be simple to understand but capable of
  the queries users actually want.
- This is the author's first data engineering project. Every stage of the pipeline should
  be legible as a learning experience, not just a working black box.
- Traffic is expected to be low (small business owners, not high volume) — cost and
  operational simplicity matter more than scalability.
- Composite scoring only for v1. No ARIMA/forecasting models — explicitly deferred to
  post-v1, consistent with the brief's non-goal of "ML for its own sake."

## 3. Architecture overview

```
GitHub Actions (cron, weekly)
  Extract (Python) -> dbt-duckdb (staging -> marts) -> export Parquet to data/ in repo
       |
       v  git commit (data/*.parquet)
GitHub Pages (static)
  plain HTML/CSS/JS + DuckDB-Wasm + Plotly.js
  loads Parquet files, runs SQL in-browser for what-if recompute
```

No server runs at request time. GitHub Actions does all compute on a schedule; the
browser does the rest via DuckDB-Wasm.

### 3.1 Language and environment

Python, managed with `uv` (single lockfile, fast, simpler than pip + requirements.txt for
a repo strangers will `git clone` and run in one command, per the brief's reproducibility
constraint).

### 3.2 Extraction

- **StatCan WDS**: via the `stats_can` package (actively maintained — confirmed via PyPI
  and GitHub, last release 2026-09-25). Covers table 12-10-0176-01 (monthly imports by
  industry NAICS, country of origin, customs basis) and CPI tables 18-10-0004-01 /
  18-10-0004-06 (clothing and footwear CPI, with -06 giving finer sub-group detail).
- **Bank of Canada Valet API**: direct `httpx` calls, no wrapper. `pyvalet` was checked and
  found stale (no commits in ~2.5 years); the Valet API itself is a simple no-auth REST/JSON
  endpoint, so a wrapper isn't needed. Series: `FXUSDCAD` (USD/CAD daily rate). Confirmed
  reliable history only from ~2017-03-01 onward, due to a BoC methodology change (moved
  from a noon rate to a single 16:30 ET rate); this caps backtest window length.
- **NY Fed GSCPI**: direct download of
  `https://www.newyorkfed.org/medialibrary/research/interactives/gscpi/downloads/gscpi_data.xlsx`.
  Monthly, published 10:00am ET on the 4th business day of the month. History from 1997.
- **HS-level trade data (CIMT)**: confirmed to have **no programmatic API** — only reachable
  via the interactive web app (manual only) or periodic bulk CSV dumps published to the
  Open Government Portal in multi-year batches (e.g.
  `https://open.canada.ca/data/en/dataset/b1126a07-fd85-4d56-8395-143aba1747a4` for
  2017-2022). Ingested via a separate, lower-frequency job (checked monthly, acts only when
  a new batch is published) rather than the weekly job. Gives finer categories (knitwear,
  denim, outerwear, footwear) than the industry-level NAICS table, which only distinguishes
  broad categories like "clothing manufacturing" (NAICS 315/316).

### 3.3 Storage and transformation

- DuckDB + Parquet. `dbt Core` with the `dbt-duckdb` adapter (chosen over SQLMesh — dbt is
  the name retail/BI hiring managers are far more likely to recognize, which matters for
  the interview story; SQLMesh has some technical advantages but less name recognition).
- Standard staging -> marts layering.
- Final Parquet files committed to `data/` in the repo (chosen over GitHub Release assets —
  simpler for both the weekly Action and the DuckDB-Wasm frontend to fetch via a plain
  HTTP URL, e.g. raw.githubusercontent.com; repo size growth from Parquet is expected to
  stay small, revisit if it becomes a problem).
- Revisions: StatCan revises recent trade data. Each pull is stored with a retrieval
  timestamp and release date rather than overwritten; dbt models select the latest known
  value per period, and revision history stays queryable for audit rather than assumed
  fixed.

### 3.4 Data quality and testing

- dbt tests: not-null / accepted-values checks on category and country dimensions, plus
  source freshness checks per source, so a broken or late source fails loudly rather than
  silently serving stale data (per the brief's risk section).
- pytest for the Python extraction/normalization code (e.g. currency conversion, HHI
  calculation) — separate from dbt's own tests.
- ruff for linting, pre-commit hooks.
- Great Expectations / Soda explicitly not used — heavier than this project needs, per the
  brief's own guidance.

### 3.5 Orchestration

GitHub Actions, weekly cron. Weekly (rather than exactly monthly) because sources release
on different days (BoC daily, StatCan and NY Fed monthly on different dates) and weekly
checks are cheap; the pipeline is idempotent, so a week with no new source data is a no-op
commit. The HS-level bulk CSV check runs on its own slower schedule (e.g. monthly) since
new batches appear rarely and are not tied to the weekly refresh.

### 3.6 Frontend

- Plain HTML/CSS/JS, no framework, no build step. Chosen because the pipeline is the
  showcase, not the frontend, and the author is not writing the frontend by hand
  (Claude Code builds it) — a framework's added complexity would not pay for itself here
  and would work against "explain every line in an interview."
- DuckDB-Wasm loads the committed Parquet files and runs SQL client-side for the what-if
  recompute and driver detail queries — the same SQL mental model as the dbt marts,
  entirely in-browser, no server round-trip.
- Plotly.js for charts (chosen over Observable Plot — more built-in interactivity like
  hover/zoom/legend-toggling for little extra code, and a name recruiters recognize).
- Single-page app, state encoded in the URL (profile inputs, current driver view) so pages
  are bookmarkable/shareable per the brief's no-accounts constraint.

### 3.7 Views / user journey

1. **Home / profile setup** — categories, country/spend split, currency, lead time/ship
   mode. Submitting encodes the profile into the URL.
2. **Results overview** — headline score + delta from last month, top-3 driver cards each
   with a Plotly sparkline, plain-English summary (template-driven from data, not
   free-form generated text, per the brief).
3. **Driver detail** (`?view=driver&driver=currency|freight|origin`) — full history chart
   for that component, explanation of what the underlying series measures and its source.
4. **What-if** — sliders re-run DuckDB-Wasm SQL live; chart and numbers update in place.
5. **Methodology & sources** — static content page, linked from everywhere.

**Drill-down to underlying data is mandatory, not optional.** Every chart or summary
number is accompanied by (a) the raw query result as an HTML table and (b) the exact SQL
that produced it, always visible (not behind a toggle) — this makes the brief's
transparency requirement (section 8, section 10) concrete and auditable.

## 4. Scoring methodology (v1)

Three components, each normalized against its own history as a z-score:

1. **Freight/delay pressure** — NY Fed GSCPI value for the current month, z-scored against
   its full history (already expressed in standard-deviation units, so this is close to
   pass-through).
2. **Currency exposure** — for the user's currency mix, compute (a) rolling volatility
   (90-day stdev of daily % change) and (b) level change (30-day % move) of USD/CAD,
   z-scored against their own history since 2017 (the reliable-data floor found during
   research). Reported as two sub-signals, not collapsed into one, so the distinction
   between "currency moved" and "currency has been unstable" stays honest and visible.
3. **Origin concentration** — Herfindahl-Hirschman Index (HHI) from the user's
   country-of-origin spend shares (a profile input, not actual purchase data), benchmarked
   against the HHI of the actual Canadian import mix for their category (from StatCan
   12-10-0176-01), each z-scored against that category's own historical HHI series.

**Composite**: equal-weighted (1/3 each) average of the three z-scores. Equal weighting is
the documented default because there is no principled reason yet to weight one component
higher; if the backtest later suggests otherwise, that becomes a stated, justified change,
not a silently tuned parameter. Mapped to Low / Elevated / High via fixed z-score
thresholds (e.g. below 0 = Low, 0 to 1 = Elevated, above 1 = High) — exact thresholds to be
finalized against real data during implementation.

**Explicitly out of scope for v1**: ARIMA or any other forecasting/predictive model. This
is deferred to a post-v1 iteration, once the composite-score version has shipped and been
backtested. Consistent with the brief's non-goal of "machine learning for its own sake."

**Backtest**: correlate the composite score (and each component separately) against next-
quarter Canadian clothing CPI change (StatCan 18-10-0004-01 / -06), over the longest common
window the data allows (effectively 2017-present, capped by the FX series history). Report
the result plainly, including if it is null or weak — a stated null result is treated as a
valid, credible finding, not a failure of the project, per the brief.

## 5. Portfolio deliverables

Carried over from `PROJECT_BRIEF.md` section 13 without change: README in the specified
order (business question, three findings with charts and so-what, what a retail team could
do, live app link, one-command run instructions, data sources/licences/limitations), plus a
one-page memo for a hypothetical sourcing/merchandising lead, a methodology and data
quality notes page, an honest backtest write-up, a LinkedIn post draft written last, and a
clean commit history with a working CI badge.

## 6. Open items carried into implementation

- StatCan WDS returned HTTP 503 during research for `getCubeMetadata` calls on tables
  12-10-0176-01 and 18-10-0004-01/-06 — likely transient, but the exact dimension/coordinate
  structure (and confirmation that apparel NAICS codes are present as expected) needs to be
  re-verified at implementation start, before building the dbt staging models for those
  sources.
- Exact z-score-to-threshold cutoffs (Low/Elevated/High) should be validated against the
  real historical distribution once data is loaded, rather than fixed sight-unseen.
- HS-level bulk CSV ingestion cadence (how often to check the Open Government Portal for a
  new batch) should be set based on how often that portal has actually published new
  batches historically.

## 7. Non-goals (unchanged from brief)

See `PROJECT_BRIEF.md` section 14 — named supplier/factory/brand analysis, real-time data,
company-specific cost forecasting, tariff modeling, user accounts/payments, and ML/
forecasting for its own sake all remain out of scope for v1.
