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
