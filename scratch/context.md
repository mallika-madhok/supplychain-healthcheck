# Context handoff — Canadian Apparel Import Pressure Monitor

Paste/attach this file at the start of a new Claude Code session (on the MacBook, or
anywhere else) to resume this project with full context. It's a snapshot of everything
decided as of **2026-09-28**, session author: **Mallika** (GitHub: `mallika-madhok`).

## 0. First things to do in the new session

1. `git clone https://github.com/mallika-madhok/supplychain-healthcheck.git`
2. Read these two files in the repo — they're the source of truth, this document just
   summarizes and points to them:
   - `PROJECT_BRIEF.md` — the original brief (goals, constraints, candidate data sources)
   - `docs/superpowers/specs/2026-09-27-apparel-import-monitor-design.md` — the approved
     v1 architecture spec from the brainstorming session
   - `docs/superpowers/plans/2026-09-28-foundation-extraction-plan.md` — the detailed,
     ready-to-execute Phase 1 implementation plan (task-by-task, TDD, real verified code)
3. Re-create `.env` locally (it's gitignored, never committed) with:
   ```
   MOTHERDUCK_TOKEN=<your MotherDuck service account token>
   ```
   Paste the token yourself — don't have Claude read or type it, to keep it out of any
   transcript.
4. Set the GitHub Actions secret on the new machine if not already done:
   ```
   gh secret set MOTHERDUCK_TOKEN --repo mallika-madhok/supplychain-healthcheck
   ```
   (This may already be set from the first machine — check with `gh secret list --repo
   mallika-madhok/supplychain-healthcheck` before re-adding.)

## 1. What this project is

A portfolio project for Mallika (UBC Master of Business Analytics, targeting
analytics/BI consulting roles at retailers like Aritzia). Working title: "Canadian Apparel
Import Pressure Monitor." A web app that turns public trade/currency/supply-chain data
into a monthly "pressure" reading for a small Canadian apparel importer's own
category/country/currency mix — see `PROJECT_BRIEF.md` for the full problem statement.

**The data pipeline is the thing being showcased in interviews — not the frontend.**
Mallika is not writing frontend code by hand; Claude Code builds it. Every design decision
should keep this priority in mind.

**This is Mallika's first data engineering project.** She's explicitly asked for the build
to be a learning experience at every stage, not just a working black box — explain the
"why," not just the "what," when making decisions or writing code.

## 2. Hard constraints (do not relitigate these)

- **Fully self-hostable / free / open-source tooling.** No paid services, ever.
- **The finished app must be interactable on GitHub Pages itself** (not just linked from
  it) — this is why the frontend is static HTML/CSS/JS with DuckDB-Wasm, not a hosted
  Python app.
- **No accounts, no login, no server-side storage of user data** for app visitors. Profile
  lives in the browser/URL.
- **Zero spend under any circumstances.** MotherDuck's free tier has no card on file —
  that's the actual guarantee (see section 4 below). Never add a card to any service used
  by this project without discussing it first.
- **No ARIMA / forecasting models in v1.** Composite z-score scoring only. Explicitly
  deferred to post-v1.
- Traffic is expected to be low (small business owners) — simplicity over scalability.

## 3. Locked-in architecture (see the design spec for full detail/rationale)

```
GitHub Actions (cron, weekly) — free GitHub-hosted runner
  Extract (Python, on the Actions runner)
       -> dbt-duckdb targeting MotherDuck (md:) — staging -> marts
          (transformation SQL runs as MotherDuck cloud compute, free tier)
       -> COPY marts to Parquet -> data/ in repo -> git commit
GitHub Pages (static)
  plain HTML/CSS/JS + DuckDB-Wasm + Plotly.js
  loads committed Parquet files, runs SQL in-browser
  NEVER connects to MotherDuck — no token in the browser, ever
```

- **Language/env**: Python + `uv`.
- **Extraction**: `stats_can` package for StatCan WDS; direct `httpx` for BoC Valet
  (skip `pyvalet`, it's stale) and NY Fed's xlsx download.
- **Transform**: dbt Core + `dbt-duckdb` adapter, targeting MotherDuck via
  `md:<db>?motherduck_token={{ env_var('MOTHERDUCK_TOKEN') }}`. Chosen over SQLMesh for
  name recognition with hiring managers.
- **Orchestration**: GitHub Actions weekly cron — explicitly chosen over Cloudflare
  Workers/Netlify (wrong tool for a Python+dbt batch job) and Google Cloud Run (requires a
  GCP billing account/card on file, which conflicts with the zero-spend constraint).
- **Frontend**: plain HTML/CSS/JS, no framework, no build step, DuckDB-Wasm + Plotly.js.
  Mandatory (non-toggleable) SQL + raw-result display next to every chart, for
  transparency/auditability.
- **Composite score is NOT precomputed per-user in the pipeline** — it can't be, since it
  depends on each visitor's own profile (their categories/countries/currency). The
  pipeline produces *reference* series (freight z-score history, currency z-score history,
  the Canadian import mix's own HHI history per category); the **browser** combines those
  with the visitor's own HHI (computed live from their slider inputs) into the final score,
  via one parameterized SQL query that also powers the what-if control.

## 4. MotherDuck — why it's there and the safety rule

Added after Mallika asked for "a database in the mix" for learning purposes. Key facts,
verified against MotherDuck's own Fees Addendum:

- Free tier: 10 GB storage, 10 compute-hours/month, up to 3 users, **no credit card
  required or on file**.
- **The zero-spend guarantee is "no card on file," not usage discipline.** Free accounts
  cannot be charged because there's no payment method to charge — full stop. **This
  guarantee only breaks if a credit card is ever added to the MotherDuck account. Do not
  add one.**
- The browser (DuckDB-Wasm on the public site) **never** connects to MotherDuck — its
  WASM client requires an access token, and embedding one in public page source would
  expose it to abuse/extraction. MotherDuck is pipeline-only, authenticated via the
  `MOTHERDUCK_TOKEN` GitHub Actions secret, never touched by Claude Code directly.
- Pipeline is designed to fail *gracefully* if the free compute/storage cap is ever hit —
  skip that week's MotherDuck export, keep serving last-known-good Parquet, don't retry
  aggressively or prompt to upgrade.

## 5. Data sources — verified facts (don't re-research these)

All verified live during planning sessions on 2026-09-27 and 2026-09-28.

| Source | Access | Key facts |
|---|---|---|
| NY Fed GSCPI | Direct xlsx download: `https://www.newyorkfed.org/medialibrary/research/interactives/gscpi/downloads/gscpi_data.xlsx` | Actually a legacy `.xls` (BIFF) format despite the extension — needs `xlrd`, not `openpyxl`. Sheet `"GSCPI Monthly Data"`, columns `Date` (string, format `%d-%b-%Y`) and `GSCPI` (float). Monthly, published 10am ET, 4th business day of month. History from 1998. |
| Bank of Canada Valet | `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json`, no auth | Reliable history only from **2017-03-01** (BoC methodology change) — caps backtest window. Response shape: `{"observations": [{"d": "YYYY-MM-DD", "FXUSDCAD": {"v": "1.4145"}}]}`. |
| StatCan WDS | `POST https://www150.statcan.gc.ca/t1/wds/rest/getDataFromCubePidCoordAndLatestNPeriods`, no auth | Use the `stats_can` package (actively maintained) — `stats_can.scwds.get_data_from_cube_pid_coord_and_latest_n_periods(pairs, periods)`. Confirmed apparel NAICS members in table 12-10-0176-01: `305`=Apparel knitting mills, `308`=Cut and sew clothing manufacturing, `313`=Clothing accessories and other, `320`=Footwear manufacturing. Confirmed country members: `1`=Total, `19`=Bangladesh, `40`=Cambodia, `47`=China, `102`=India, `103`=Indonesia, `225`=Viet Nam. CPI table 18-10-0004-01, member `139`="Clothing and footwear", Canada geography member `2`. Full coordinate strings and example calls are in the Phase 1 plan. |
| CIMT (HS-level trade) | No API — bulk CSV via Open Government Portal, one zip per calendar year at `https://www150.statcan.gc.ca/n1/pub/71-607-x/2021004/zip/CIMT-CICM_Imp_{year}.zip` | Better than first assumed: the zip's `ODPFN022_*.csv` member is HS2-chapter level (~10MB, not the 170MB HS10 file) with columns `YearMonth,HS2,Country,Province,State,Value`. Apparel chapters: `61`=knit apparel, `62`=woven apparel, `64`=footwear. Current package id: `2909a648-5753-4924-878a-b069392d9cde` ("CIMT 2023-2026"). Runs on its own slower cadence, not the weekly job. |

`pyvalet` (BoC wrapper) was checked and found stale — use direct `httpx` calls instead.

## 6. Scoring methodology (v1, from the design spec)

Three z-scored components, equal-weighted (1/3 each) composite:
1. **Freight/delay pressure** — NY Fed GSCPI, z-scored against its own history.
2. **Currency exposure** — USD/CAD level change (30-day) and volatility (90-day stdev),
   two separate sub-signals, z-scored against history since 2017.
3. **Origin concentration** — Herfindahl-Hirschman Index (HHI) of the user's own
   country-of-origin mix, benchmarked against the Canadian import mix's own HHI for that
   category, both z-scored against that category's historical HHI distribution.

Backtest against Canadian clothing CPI (StatCan 18-10-0004-01/-06), reported honestly even
if null/weak. No ML/forecasting in v1 — explicitly deferred.

## 7. Where things stand right now

- **Brainstorming/design phase: complete.** Spec approved and committed.
- **Phase 1 (Foundation & Extraction) plan: written, not yet executed.** Full task-by-task
  TDD plan in `docs/superpowers/plans/2026-09-28-foundation-extraction-plan.md` — 7 tasks
  covering project scaffold, NY Fed/BoC/StatCan/CIMT extraction modules, DuckDB landing
  layer, and the CLI orchestrator. All code in the plan uses real, live-verified API
  shapes — nothing in it is a guess.
- **Not yet started**: actually executing Phase 1, and Phases 2-4 (dbt/MotherDuck
  transformation, CI/export workflow, frontend) only exist as a one-paragraph-each
  roadmap outline in conversation, not written plans yet.

**Immediate next step when resuming**: decide execution approach for the Phase 1 plan —
either subagent-driven (dispatch a fresh subagent per task with review between tasks) or
inline execution in the session (batch execution with checkpoints). This choice was being
asked when the session ended.

## 8. Repo layout so far

```
PROJECT_BRIEF.md
.env / .env.example / .gitignore
docs/superpowers/specs/2026-09-27-apparel-import-monitor-design.md
docs/superpowers/plans/2026-09-28-foundation-extraction-plan.md
scratch/                       # informal working notes, not part of the portfolio proper
  data-notes.md                 # plain-language + technical walkthrough of the data/joins
  architecture-journey.html     # source for a published Claude artifact (see below)
  context.md                    # this file
```

The architecture diagram was also published as a Claude Artifact (interactive, not just
this HTML file) — if you want the link again, check `/artifacts` or the claude.ai gallery
for "Pipeline Journey."

## 9. Working style notes for whoever picks this up

- Mallika wants to understand and defend every design choice in interviews — explain the
  "why" and the main alternative, don't just implement silently.
- She's comfortable making real architecture trade-off calls (e.g. she explicitly chose
  MotherDuck knowing it meant deviating slightly from "pure open source" in favor of a
  better learning experience, within the free-tier constraint).
- Prefers boring, well-documented, recognizable tools over clever ones — this shaped the
  GitHub Actions vs. Cloud Run/Workers decision.
- Git commits should stay clean and small — commit history is part of the portfolio.
