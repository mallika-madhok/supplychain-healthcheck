# Project Brief: Canadian Apparel Import Pressure Monitor

Working title. Rename freely.

Last updated: 2026-09-27. Facts about data sources were checked on this date and can change. Anything marked "to verify" has not been confirmed.

## 1. Purpose of this document

This brief gives Claude Code the context for a portfolio project: who it is for, what problem it addresses, what the user experience should feel like, which public data sources are candidates, which open source tools are worth evaluating, and which constraints are fixed.

It deliberately does not fix the technical design. The author will work out the architecture, data model, scoring method, and implementation plan in a separate planning session with Claude Code. Treat every tool named here as a candidate to evaluate, not a decision.

## 2. Author and goals

The author (Mallika) is a graduate student in UBC's Master of Business Analytics program, with prior experience in management consulting and account management. She is targeting analytics and BI consulting roles in Vancouver, at retail companies (Aritzia is the reference example) or tech companies.

Goals for this project:

1. A public GitHub repository that shows recruiters and hiring managers real analytics engineering and data analysis skill.
2. A live, clickable app, hosted free or nearly free.
3. A project she can explain line by line in an interview. If she cannot explain a query, a model, or a design choice, it should be simplified.
4. A credible story about a problem retail companies actually have, framed as a small open source tool that could plausibly grow into a cheap paid product.

## 3. Working agreement for Claude Code

- Start by asking questions and proposing a plan. Do not write implementation code until the author approves a spec.
- Explain each design choice briefly and give the main alternative. The author wants to learn, not just receive code.
- Prefer boring, well-documented tools over clever ones.
- Keep commits small and messages clear. The commit history is part of the portfolio.
- Say plainly when something cannot be verified or tested in the current environment.
- Do not invent data. Any simulated or placeholder data must be labeled as such in the code, the app, and the README.
- Cite the official source for every dataset in the repository docs.

## 4. Problem statement

Retailers that buy apparel overseas face three recurring pressures: shipping delays and freight cost swings, currency movements (most apparel is purchased in US dollars), and dependence on a small number of sourcing countries. Large retailers have internal teams and paid data feeds for this. Small and mid-size Canadian importers usually track it informally or not at all.

Public data covers a meaningful part of these pressures. The gap is that it is scattered across agencies, published in different formats and schedules, and not translated into "what does this mean for my sourcing mix."

## 5. Product concept

A web app that turns public supply chain, currency, and trade data into a monthly pressure assessment for a user-described sourcing profile.

Important constraint on scope: public data does not describe individual suppliers, factories, distributors, or brands. The tool works at the level of product category and country of origin. Users can attach their own labels to suppliers for their own reference, but the analysis only sees category and country. The app should say this openly.

Reference user story: a buyer at a small Canadian apparel brand sources knitwear from two countries, pays in USD, and wants to know whether the coming quarter looks riskier than the last one and why.

## 6. Target users

Primary (for the portfolio narrative): merchandising, sourcing, planning, and finance staff at small to mid-size Canadian apparel importers and resellers.

Secondary: analytics hiring managers reading the repository. The project should be legible to them in five minutes from the README.

## 7. User experience

Design principles:

- No accounts, no login, no database of user data. The user's profile lives in the browser and in the page URL so it can be bookmarked and shared.
- No manual data upload. All data comes from scheduled public API pulls.
- A first result within about a minute of arriving.
- Plain English first, detail on demand.

### 7.1 Inputs (sourcing profile)

- Product categories purchased (for example knitwear, outerwear, denim, basics, footwear), mapped to whatever classification the public trade data supports.
- Approximate share of spend by country of origin.
- Currency paid in.
- Typical lead time and ship mode (ocean or air).
- Optional free-text labels for suppliers, for the user's own reference only.

### 7.2 Outputs

- Headline pressure level (for example low, elevated, high), the change since last month, and the top three drivers in plain language.
- Driver pages for freight and delay, currency, and origin concentration, each with history and a short explanation of what the underlying series measures.
- A benchmark comparing the user's origin mix with the overall Canadian import mix for the same category.
- A what-if control, for example "shift 20% of knitwear spend from country A to country B," showing how the concentration and currency exposure change.
- A "what changed this month" summary written from the data (template driven, not free-form generated text, unless the author decides otherwise).
- Later, optional: a monthly email digest as the possible paid feature.

### 7.3 Screens to sketch before building

1. Home and profile setup
2. Results overview
3. Driver detail (one page, three tabs)
4. What-if comparison
5. Methodology and data sources page (this is a portfolio asset, not filler)

## 8. What the tool can and cannot claim

Can claim:

- How national and global indicators have moved, with sources and dates.
- How concentrated a described sourcing mix is, relative to the Canadian import mix.
- How exposed a described payment currency mix is to recent exchange rate movement.

Cannot claim:

- Anything about a named supplier, factory, distributor, or brand.
- Country-specific freight conditions, unless a public source supporting that is found. The main global supply chain index is not broken out by country.
- Forecasts of the user's actual costs. The tool reports pressure and history, and any predictive claim must come from a backtest.

## 9. Candidate data sources

All of these are public. Verified means confirmed by reading the source's own description on the check date.

### 9.1 Verified to exist

| Source | What it offers | Access | Notes |
|---|---|---|---|
| New York Fed, Global Supply Chain Pressure Index | Monthly composite of global transportation and manufacturing indicators, built from 27+ variables, history back to 1997 | Downloadable data on the NY Fed site | Updated at 10:00 ET on the fourth business day of each month. Expressed as standard deviations from the mean. Exact file URL to verify. |
| Bank of Canada Valet API | Daily exchange rates, policy and benchmark interest rates, bond yields, other series | REST, JSON, CSV or XML, no authentication | Cache results, since rates publish once per day. Series history depth to verify. |
| Statistics Canada Web Data Service | Programmatic access to published tables | REST, JSON | Documented at statcan.gc.ca/eng/developers/wds. Check rate limits and the release schedule. |
| Statistics Canada table 12-10-0176-01 | Monthly imports and exports by industry (NAICS), with country of origin or destination, customs basis | WDS or table download | Likely the v1 source for import mix by origin. Confirm which apparel related NAICS codes are available. |
| Statistics Canada table 18-10-0004-01 | Monthly CPI by geography and product group, not seasonally adjusted | WDS or table download | Candidate outcome variable for backtesting (clothing price changes). |
| Statistics Canada Canadian International Merchandise Trade (CIMT) web application | Trade by HS code at 6 to 10 digits, by partner country, monthly | Web application with CSV export | Programmatic access at HS level is not confirmed. |

### 9.2 To verify or find

- HS-level trade data by API. If unavailable, v1 uses the industry-level table and says so.
- Statistics Canada retail trade table for clothing stores (table ID not confirmed).
- Any free public source for container freight rates or port congestion. None was found yet. The NY Fed index is the proxy in the meantime.
- Any public source of tariff schedules suitable for a later version. Tariff rules change often, so this is likely out of scope for v1.

### 9.3 Data handling notes

- Record the source URL, retrieval timestamp, and release date for every pull.
- Statistics Canada revises recent trade data. The pipeline should handle revisions rather than assume history is fixed.
- Check each source's licence and attribution terms and put them in the repository.

## 10. Analytical approach (principles only)

The method is for the planning session to design. Constraints on it:

- Transparent. Every component of the score can be explained in one paragraph and reproduced in a query.
- Components likely include freight and delay pressure, currency exposure, and origin concentration (for example a Herfindahl-type index), each normalized against its own history.
- No black box model in v1. A documented weighted composite is acceptable if the weights and their rationale are stated.
- Backtest: test whether the score, or its components, led changes in a relevant outcome (for example Canadian clothing CPI) over a defined horizon. Report the result honestly even if weak or null. A negative result stated clearly is more credible than an unexamined claim.
- State assumptions, data gaps, and revision behavior in a data quality notes section.

## 11. Constraints

- Hosting: free or near free. A scheduled GitHub Actions workflow refreshes the data monthly and a static or lightly hosted front end serves it. No always-on server, no paid database.
- Refresh: monthly, aligned to source release dates. Weekly checks are fine if cheap, since some sources publish on different days.
- Reproducibility: the whole repository should run locally with one documented command, and tests and data checks should run in CI.
- No manual dataset upload anywhere in the user flow.
- No user accounts or stored personal data.
- Everything public and open source, including the code and the methodology.

## 12. Candidate open source tools to evaluate

Not decisions. For each area the planning session should compare at least two options and choose based on the author's ability to understand and maintain them.

- Language and environment: Python with a modern package manager such as uv, or pip with a lockfile.
- API access: httpx or requests, plus community wrappers where they exist (for example the `stats_can` package for Statistics Canada and `pyvalet` for the Bank of Canada). Check maintenance status before depending on any wrapper.
- Storage and querying: DuckDB with Parquet files in the repository or in release assets. SQLite as a simpler alternative. Postgres only if a real need appears.
- Transformation: SQL models organized in staging and mart layers. dbt Core with the dbt-duckdb adapter is the natural fit and a common recruiter keyword. SQLMesh is an alternative.
- Data quality: dbt tests and source freshness checks. Great Expectations or Soda are heavier alternatives.
- Orchestration: GitHub Actions on a cron schedule. Prefect or Airflow are unnecessary at this scale and would add weight.
- Front end options: Evidence (SQL and markdown to static site, good for BI style pages), Streamlit (Python, hosted free on Streamlit Community Cloud, sleeps when idle), Observable Framework (static). What-if interaction and URL-based state may favor one over the others, which is a question for the planning session.
- Charts: Plotly, Altair, or Observable Plot, depending on the front end.
- Code quality: pytest, ruff, pre-commit, type hints where helpful.
- Documentation: a methodology page and a data dictionary generated from the dbt project if dbt is used.

## 13. Portfolio deliverables

The README matters more than the code. Order:

1. The business question, in two sentences.
2. Three findings from the data, each with a chart and a one-line so-what.
3. What a retail team could do about each finding.
4. Link to the live app.
5. How to run it (one command).
6. Data sources, licences, and known limitations.

Also:

- A one-page memo written for a hypothetical sourcing or merchandising lead, not just charts.
- A methodology page and data quality notes.
- A backtest write-up with the honest result.
- A short LinkedIn post draft (written last, in the author's own voice).
- Clean commit history and a working CI badge.

## 14. Non-goals for v1

- Named supplier, factory, distributor, or brand analysis.
- Real time data or intraday updates.
- Cost forecasting for a specific company.
- Tariff modeling.
- User accounts, saved profiles on a server, or payments.
- Machine learning for its own sake. Simple, explainable methods first.

## 15. Open questions for the planning session

1. Which apparel categories can be defined from the available industry and HS level trade data, and at what granularity?
2. Is HS-level trade data reachable programmatically? If not, is industry-level enough for the concentration analysis?
3. Which front end best supports the what-if control and URL-stored profile with free hosting?
4. How should currency exposure be defined in a way that is honest and simple (level change, volatility, or both), and over which windows?
5. Which outcome variable and horizon give a fair backtest, given the short length and revision behavior of some series?
6. How should revisions to Statistics Canada data be stored and displayed?
7. Where do data files live so the free hosting tier and the monthly job both work (repository, release assets, or object storage free tier)?
8. What is the minimum first release that is worth publishing, and what is the sequence after it?
9. Which parts are the author writing herself, and which are generated and then reviewed line by line?

## 16. Risks

- A source changes its format or URL and the monthly job breaks. Mitigation: freshness and schema checks that fail loudly, and a note on the app when data is stale.
- The score does not predict anything. Mitigation: report the backtest honestly and frame the tool as a monitor of pressure, not a forecaster.
- Over-claiming. Mitigation: the methodology page and the "cannot claim" list in section 8.
- Scope growth. Mitigation: the non-goals list and a small first release.
- Free tier limits or hosting changes. Mitigation: keep the app static or nearly static so it can move between hosts.

## 17. Definition of done for v1

- Scheduled job pulls at least three of the candidate sources and loads them into a queryable store.
- Tested transformation layer with documented models.
- Deployed app where a user enters a sourcing profile and receives a pressure assessment, driver detail, and a what-if comparison.
- Methodology page, data quality notes, and backtest write-up.
- README in the order above, with three findings.
- Repository runs locally with one command and CI is green.
