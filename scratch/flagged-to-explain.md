# Flagged: explain to the author at the end

## Backtest caveat (flagged 2026-10-22)

> Time series data breaks the usual textbook assumptions. Each month is correlated with the
> previous one, so ordinary p-values look far more impressive than they should. The fix is to
> use methods built for this, such as differencing the data or using robust (Newey-West)
> standard errors. We also only have about 9 years of overlapping data, since the
> exchange-rate history is only reliable from 2017. Small sample plus autocorrelation means
> the test may well come out inconclusive.
>
> Report the result honestly even if it's null. "I tested it, and here's what I found,
> including where it didn't work" is more impressive than an unexamined claim.

To do: explain this in very simple terms once the backtest phase is reached or the project is
finished.

## MotherDuck token exposure (flagged 2026-10-24)

> `dbt debug` printed the full MotherDuck token into the terminal/session output while
> setting up Phase 2. Author chose to continue and rotate later rather than stop and
> rotate immediately.

To do: remind the author to rotate the MotherDuck token (regenerate in the MotherDuck UI,
update `.env` and the `MOTHERDUCK_TOKEN` GitHub Actions secret) before treating this
project as done, since the old token is sitting in session history outside the repo.

## CIMT null-country rows (flagged 2026-10-24)

> ~114 raw CIMT rows (across both machines' pulls) have a blank country — likely StatCan
> suppressing a confidential or unallocated amount. Confirmed negligible: ~$87K out of
> ~$126B total import value (0.0001%) as of this date. Excluded in `stg_cimt` since a
> country-level HHI can't attribute a share to an unknown country.

To do: mention this exclusion on the methodology/data-quality notes page as a known,
quantified limitation — not hidden, just small enough not to change the story.
