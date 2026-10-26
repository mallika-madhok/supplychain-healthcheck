-- Country shares of Canadian imports per month and product category, so the browser can
-- show how the visitor's own sourcing mix compares with the national mix.
-- Categories are each HS4 heading plus a roll-up per HS chapter ("all knit apparel").

with headings as (
    select
        month,
        hs4 as category_code,
        hs4_label as category_label,
        'heading' as category_level,
        country,
        sum(import_value_cad) as import_value_cad
    from {{ ref('stg_cimt') }}
    group by month, hs4, hs4_label, country
),

chapters as (
    select
        month,
        'ch' || hs2_chapter as category_code,
        case hs2_chapter
            when '61' then 'All knit apparel (ch. 61)'
            when '62' then 'All woven apparel (ch. 62)'
            when '64' then 'All footwear (ch. 64)'
            when '42' then 'All handbags, wallets & luggage'
            when '65' then 'All headgear (ch. 65)'
        end as category_label,
        'chapter' as category_level,
        country,
        sum(import_value_cad) as import_value_cad
    from {{ ref('stg_cimt') }}
    group by month, hs2_chapter, country
),

combined as (
    select * from headings
    union all
    select * from chapters
)

select
    month,
    category_code,
    category_label,
    category_level,
    country,
    import_value_cad,
    import_value_cad / sum(import_value_cad) over (
        partition by month, category_code
    ) as country_share
from combined
where import_value_cad > 0
order by category_code, month, country
