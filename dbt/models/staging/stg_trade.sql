with ranked as (
    select
        month,
        country,
        naics_category,
        import_value_cad,
        retrieved_at,
        row_number() over (
            partition by month, country, naics_category order by retrieved_at desc
        ) as rn
    from {{ source('raw', 'raw_trade') }}
)

select
    month,
    country,
    naics_category,
    import_value_cad
from ranked
where rn = 1
