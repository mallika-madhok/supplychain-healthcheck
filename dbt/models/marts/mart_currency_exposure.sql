-- Currency exposure: two separate sub-signals for USD/CAD, each z-scored against its
-- own history since 2017-03-01 (the reliable-data floor).
--   1. level_change_30d: 30-trading-day % move (approximates calendar 30 days by row
--      offset, since the FX series only has rows for days a rate was published)
--   2. volatility_90d: 90-trading-day rolling stdev of the daily % change
-- Kept as two signals rather than collapsed into one, so "currency moved" and
-- "currency has been unstable" stay distinct and honest.

with fx as (
    select
        date,
        usd_cad_rate,
        usd_cad_rate / lag(usd_cad_rate) over (order by date) - 1 as daily_pct_change
    from {{ ref('stg_fx') }}
),

rolling as (
    select
        date,
        usd_cad_rate,
        usd_cad_rate / lag(usd_cad_rate, 30) over (order by date) - 1 as level_change_30d,
        stddev_samp(daily_pct_change) over (
            order by date rows between 89 preceding and current row
        ) as volatility_90d
    from fx
),

stats as (
    select
        avg(level_change_30d) as mean_level_change,
        stddev_samp(level_change_30d) as stdev_level_change,
        avg(volatility_90d) as mean_volatility,
        stddev_samp(volatility_90d) as stdev_volatility
    from rolling
)

select
    r.date,
    r.usd_cad_rate,
    r.level_change_30d,
    (r.level_change_30d - s.mean_level_change) / s.stdev_level_change as level_change_zscore,
    r.volatility_90d,
    (r.volatility_90d - s.mean_volatility) / s.stdev_volatility as volatility_zscore
from rolling as r
cross join stats as s
order by r.date
