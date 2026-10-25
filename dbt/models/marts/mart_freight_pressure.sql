-- Freight/delay pressure: NY Fed GSCPI, z-scored against its own full history.
-- GSCPI is already expressed in standard-deviation units, so this is close to pass-through.

with stats as (
    select
        avg(gscpi_value) as mean_value,
        stddev_samp(gscpi_value) as stdev_value
    from {{ ref('stg_gscpi') }}
)

select
    g.month,
    g.gscpi_value,
    (g.gscpi_value - s.mean_value) / s.stdev_value as gscpi_zscore
from {{ ref('stg_gscpi') }} as g
cross join stats as s
order by g.month
