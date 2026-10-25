with ranked as (
    select
        month,
        product_group,
        cpi_index,
        retrieved_at,
        row_number() over (partition by month order by retrieved_at desc) as rn
    from {{ source('raw', 'raw_cpi') }}
)

select
    month,
    product_group,
    cpi_index
from ranked
where rn = 1
