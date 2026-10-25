# Phase 2: Transformation (dbt + MotherDuck) — plan and record

Status: executed and verified, 2026-10-24. Author (Mallika) asked to build this phase
end-to-end first and get a walkthrough afterward, so this doc records what was actually
built rather than being written and approved before implementation (unlike Phase 1).

## Goal

Turn the raw, append-only tables from Phase 1 into clean, z-scored reference series —
freight pressure, currency exposure, origin concentration — durably stored in MotherDuck
and exported as Parquet for the eventual static frontend. No composite score and no
backtest yet (both deferred: composite scoring happens in the browser since it depends on
each visitor's own profile; backtest is its own later phase).

## Decisions made with the author before building

1. **Land CIMT now**, not deferred to Phase 3. The weekly StatCan trade table only covers
   6 countries, so shares computed from it aren't true shares of all imports. CIMT (bulk,
   full country list, HS2-chapter level) is used for the real origin-concentration mart.
2. **Dedicated MotherDuck database**: `apparel_import_monitor`, created fresh (previously
   the token's default database was `my_db`).
3. **Backtest is a separate phase**, not part of this one.

## What was built

- `src/pipeline/extract_cimt.py` — new CLI entry point, separate from `extract.py`'s
  weekly run, landing CIMT for a list of years (default 2023-2026) into `raw_cimt`.
  Retries once per year on any `httpx.HTTPError` (a live run hit a `ConnectTimeout` that
  a retry fixed — the Phase 1 lessons-learned note about CIMT's flaky connection was real).
- `src/pipeline/load_motherduck.py` — copies the local `data/raw.duckdb` tables into
  MotherDuck's `raw` schema (`CREATE OR REPLACE TABLE`, full refresh from the local file,
  which already holds the accumulated history on a dev machine). Not unit tested — it's
  an integration script against the live MotherDuck connection, verified by running it and
  checking row counts, the same pattern Phase 1 used for its own live-only verification.
- `dbt/` — a dbt Core + `dbt-duckdb` project targeting MotherDuck:
  - `models/staging/` — one view per raw table, deduplicated to the latest `retrieved_at`
    per natural key via `row_number() over (partition by ... order by retrieved_at desc)`.
    This is what makes the append-only raw layer safe to re-run.
  - `models/marts/` — three tables:
    - `mart_freight_pressure` — GSCPI z-scored against its own full history.
    - `mart_currency_exposure` — USD/CAD 30-day level change and 90-day rolling
      volatility, each z-scored separately against history since 2017-03-01.
    - `mart_origin_concentration` — HHI per month and HS2 apparel chapter (61/62/64)
      from CIMT country shares, z-scored per chapter against its own history.
  - `macros/generate_schema_name.sql` — overrides dbt-duckdb's default schema prefixing
    (which would otherwise create `main_staging`/`main_marts`) so the schemas are plainly
    named `staging` and `marts`, matching the naming used everywhere else in the project.
  - Source freshness checks (`dbt source freshness`) on all 5 raw tables; not-null,
    unique, and accepted-values tests on staging and mart columns (37 total nodes).
- `src/pipeline/export_marts.py` — copies the 3 mart tables from MotherDuck to
  `data/*.parquet`, the only thing the eventual GitHub Pages frontend will read.

## What the test suite caught

The `not_null` test on `stg_cimt.country` failed on the first `dbt build` run — 114 raw
rows (54 after partial dedup) had a blank country, likely StatCan suppressing a
confidential or unallocated amount. Checked the dollar value before deciding how to
handle it: ~$87K out of ~$126B total (0.0001%) — negligible, so those rows are now
filtered out in `stg_cimt.sql` with a comment explaining why, and the test stays in place
to catch this growing larger in a future pull. Logged in
`scratch/flagged-to-explain.md` as a known, quantified data-quality limitation to mention
on the methodology page later, not something to hide.

## Known follow-ups (not blocking, tracked for later)

- `load_motherduck.py`'s full-refresh approach only works because the local dev machine's
  `data/raw.duckdb` already holds complete history. Phase 3's GitHub Actions job runs on
  an ephemeral runner with no persisted local file between weekly runs, so the MotherDuck
  copy step will need to switch to an append (or the raw layer's "durable store of
  history" needs to live in MotherDuck itself across runs, not be rebuilt from a fresh
  local file each time). Needs a decision when Phase 3 is planned.
- A MotherDuck token was briefly printed into this session's terminal output by
  `dbt debug`. Flagged in `scratch/flagged-to-explain.md` — the author should rotate the
  token (MotherDuck UI + update `.env` + the GitHub Actions secret) before treating this
  project as finished.
- `mart_currency_exposure`'s "30-day" and "90-day" windows are actually 30/90 *row*
  (published-day) offsets, not calendar days, since the FX series only has rows for days a
  rate was published. Close enough for v1, but worth stating precisely on the methodology
  page rather than implying calendar days.
- Origin concentration uses CIMT's own category scheme (HS2 chapters 61/62/64), which is
  a different breakdown than the StatCan NAICS categories used in `stg_trade`
  (knitwear/cut-and-sew/accessories/footwear). The two don't map 1:1 — worth a clear note
  wherever both appear so it doesn't read as an inconsistency.

## Verification performed

- `uv run pytest` — 16 passed (2 new tests for `extract_cimt.py`).
- `uv run ruff check .` — clean.
- `dbt build` — 37/37 (3 table models, 5 view models, 29 data tests) passed.
- `dbt source freshness` — 5/5 sources passed.
- Live run end to end: CIMT landed for 2023-2026 (~83K new rows), weekly sources
  refreshed, raw tables copied into MotherDuck, `dbt build` green, marts exported to
  Parquet and spot-checked against known facts (GSCPI's all-time peak z-score of +4.43
  lands on 2021-12, the well-documented peak of the global supply chain crisis).
