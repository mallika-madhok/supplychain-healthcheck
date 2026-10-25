-- A small number of source rows have a blank country (likely StatCan suppressing a
-- confidential or unallocated amount). Confirmed negligible: ~$87K out of ~$126B total
-- import value (0.0001%) as of 2026-10-24. Excluded here since a country-level HHI can't
-- attribute a share to an unknown country; the not_null test below guards against this
-- share growing unnoticed in a future pull.

with ranked as (
    select
        month,
        hs2_chapter,
        hs2_label,
        country,
        import_value_cad,
        retrieved_at,
        row_number() over (
            partition by month, hs2_chapter, country order by retrieved_at desc
        ) as rn
    from {{ source('raw', 'raw_cimt') }}
    where country is not null
)

select
    month,
    hs2_chapter,
    hs2_label,
    country,
    import_value_cad
from ranked
where rn = 1
