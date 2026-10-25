{#
    dbt's default behavior prefixes a custom schema with the target schema (e.g.
    "main_marts" instead of "marts"). Override it to use the custom schema name as-is,
    matching the staging/marts naming used everywhere else in this project's docs.
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
