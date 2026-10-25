with ranked as (
    select
        month,
        gscpi_value,
        retrieved_at,
        row_number() over (partition by month order by retrieved_at desc) as rn
    from {{ source('raw', 'raw_gscpi') }}
)

select
    month,
    gscpi_value
from ranked
where rn = 1
