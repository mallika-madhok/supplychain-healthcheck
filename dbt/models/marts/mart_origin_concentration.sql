-- Origin concentration: Herfindahl-Hirschman Index (HHI) of the Canadian import mix,
-- per month and HS2 apparel chapter, from the full-country CIMT data (not the 6-country
-- StatCan trade table, which would understate concentration since it excludes most
-- countries). Each chapter's HHI series is z-scored against its own history, since
-- "concentrated" means something different for knit apparel vs. footwear.

with shares as (
    select
        month,
        hs2_chapter,
        hs2_label,
        country,
        import_value_cad,
        import_value_cad / sum(import_value_cad) over (
            partition by month, hs2_chapter
        ) as country_share
    from {{ ref('stg_cimt') }}
),

hhi as (
    select
        month,
        hs2_chapter,
        hs2_label,
        sum(country_share * country_share) as hhi
    from shares
    group by month, hs2_chapter, hs2_label
),

stats as (
    select
        hs2_chapter,
        avg(hhi) as mean_hhi,
        stddev_samp(hhi) as stdev_hhi
    from hhi
    group by hs2_chapter
)

select
    h.month,
    h.hs2_chapter,
    h.hs2_label,
    h.hhi,
    (h.hhi - s.mean_hhi) / s.stdev_hhi as hhi_zscore
from hhi as h
inner join stats as s using (hs2_chapter)
order by h.hs2_chapter, h.month
