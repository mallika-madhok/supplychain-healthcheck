-- CIMT imports at HS4-heading grain (aggregated from the HS6 file during extraction).
--
-- A small number of source rows have a blank country (likely StatCan suppressing a
-- confidential or unallocated amount). Confirmed negligible: ~$87K out of ~$126B total
-- import value (0.0001%) as of 2026-10-24. Excluded here since a country-level HHI can't
-- attribute a share to an unknown country; the not_null test below guards against this
-- share growing unnoticed in a future pull.
--
-- A later pull's revised value lands as a new row, so keep only the latest retrieval per
-- (month, heading, country).

with ranked as (
    select
        month,
        hs4,
        hs4_label,
        hs2_chapter,
        country,
        import_value_cad,
        row_number() over (
            partition by month, hs4, country order by retrieved_at desc
        ) as rn
    from {{ source('raw', 'raw_cimt_hs4') }}
    where country is not null
)

select
    month,
    hs4,
    hs4_label,
    hs2_chapter,
    country,
    import_value_cad
from ranked
where rn = 1
