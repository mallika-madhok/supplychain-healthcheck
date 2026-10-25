with ranked as (
    select
        date,
        usd_cad_rate,
        retrieved_at,
        row_number() over (partition by date order by retrieved_at desc) as rn
    from {{ source('raw', 'raw_fx') }}
)

select
    date,
    usd_cad_rate
from ranked
where rn = 1
