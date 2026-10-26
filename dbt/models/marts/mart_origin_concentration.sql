-- Origin concentration: Herfindahl-Hirschman Index (HHI) of the Canadian import mix,
-- per month and product category (HS4 heading or HS chapter roll-up), from the full-country
-- CIMT data (not the 6-country StatCan trade table, which would understate concentration
-- since it excludes most countries). Each category's HHI series is z-scored against its
-- own history, since "concentrated" means something different for T-shirts vs. footwear.
-- Also exposes the mean and stdev so the browser can z-score a visitor's own mix against
-- the same benchmark.

with hhi as (
    select
        month,
        category_code,
        category_label,
        category_level,
        sum(import_value_cad) as import_value_cad,
        count(*) as country_count,
        sum(country_share * country_share) as hhi
    from {{ ref('mart_country_shares') }}
    group by month, category_code, category_label, category_level
),

stats as (
    select
        category_code,
        avg(hhi) as hhi_mean,
        stddev_samp(hhi) as hhi_stdev
    from hhi
    group by category_code
)

select
    h.month,
    h.category_code,
    h.category_label,
    h.category_level,
    h.import_value_cad,
    h.country_count,
    h.hhi,
    s.hhi_mean,
    s.hhi_stdev,
    (h.hhi - s.hhi_mean) / nullif(s.hhi_stdev, 0) as hhi_zscore
from hhi as h
inner join stats as s using (category_code)
order by h.category_code, h.month
