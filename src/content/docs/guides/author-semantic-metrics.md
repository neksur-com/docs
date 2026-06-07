---
title: "Author semantic metrics (Meaning)"
description: "The Meaning dimension lets you define a metric or dimension once and get bit-identical results from every engine. You author a semantic model; Neksur…"
---

**Job:** Define · **Edition:** Core.

The **Meaning** dimension lets you define a metric or dimension *once* and get bit-identical results from every engine. You author a semantic model; Neksur stores an AST as the source of truth and compiles it to each engine's SQL dialect, so "revenue this quarter" means the same thing in Spark, Trino, Snowflake, and Dremio.

## The model format

Semantic models follow Cube / OSI (Open Semantic Interchange) conventions: a fact table, **metrics** (measures), **dimensions**, and **joins**.

```yaml
semantic_model:
  name: order_analytics
  version: "1.0.0"
  description: "Order analytics for e-commerce"
  fact_table: orders

  metrics:
    - name: revenue
      aggregation: sum
      additivity: additive
      sql_expression: "orders.amount"
      measure_table: orders
      description: "Total order revenue"

    - name: order_count
      aggregation: count
      additivity: additive
      sql_expression: "orders.id"
      measure_table: orders

    - name: account_balance
      aggregation: sum
      additivity: semi_additive          # additive across time only
      additivity_anchor_dim_uri: "order_analytics/dimensions/order_date"
      sql_expression: "orders.balance"
      measure_table: orders

  dimensions:
    - name: region
      dimension_table: orders
      foreign_key: region
      primary_key: region
      dim_type: categorical

    - name: order_date
      dimension_table: orders
      foreign_key: order_date
      primary_key: order_date
      dim_type: time
      time_grain_def: day               # day | week | month | quarter | year

  joins:
    - from_table: orders
      to_table: customers
      join_condition: "orders.customer_id = customers.id"
      cardinality: "N:1"
```

A minimal model:

```yaml
semantic_model:
  name: my_model
  version: "1.0.0"
  fact_table: orders
  metrics:
    - name: revenue
      aggregation: sum
      sql_expression: "orders.amount"
      measure_table: orders
  dimensions:
    - name: region
      dimension_table: orders
      foreign_key: region
      primary_key: region
      dim_type: categorical
```

## Additivity — the rule that prevents wrong rollups

Every metric declares how it may be aggregated. Neksur enforces this so a query can't silently produce a meaningless number:

| Additivity | Safe to group by | Example |
|------------|------------------|---------|
| `additive` | any dimensions | `SUM(revenue) GROUP BY region, date` ✅ |
| `semi_additive` | only its anchor (usually time) | `SUM(balance) GROUP BY date` ✅ · `… GROUP BY region` ❌ |
| `non_additive` | only its anchor dimension | distinct counts, ratios |

A `semi_additive` or `non_additive` metric names an `additivity_anchor_dim_uri`; grouping by a non-anchor dimension is rejected with an additivity violation rather than returning a wrong total.

## Time intelligence

A `time` dimension with a `time_grain_def` unlocks time-intelligence operators (year-to-date, quarter-to-date, prior-period) at query time, compiled via a time-spine join. Fiscal calendars (4-4-5, 4-5-4, etc.) are configured per tenant — see the [CLI reference](/reference/cli/#fiscal-calendar-provision) or **Settings → Fiscal calendars** in the console.

## Author, import, and export

**In the console.** Use **Metrics → Add metric** (or the Meaning tab of a Contract) to author a model in a YAML/Form editor with compile-on-save. Saving issues `PUT /v1/metrics/{id}` and compiles the model; errors surface inline.

**Via the CLI (OSI).** Import a Cube YAML schema into a tenant's semantic registry, or export it back out:

```bash
# import a Cube YAML model
neksur-cli osi import --tenant <tenant-uuid> --dialect cube ./order_analytics.yml

# export a stored model back to Cube YAML
neksur-cli osi export --tenant <tenant-uuid> --model order_analytics --dialect cube
```

OSI roundtrip stability means your definitions are portable, not locked into one vendor's modeling language.

## Querying metrics

Once a model is active, query it through any read transport — a metric query over `pgwire`, XMLA from Excel/Power BI, or the REST/GraphQL metric endpoints. Whichever engine ultimately runs the SQL, the metric compiles to the same logical computation, and the [Access](/guides/author-access-policies/) row filters / column masks of the governing Contract still apply.

## Attach Meaning to a Contract

Metrics and dimensions are the **Meaning** dimension of a [Data Contract](/concepts/data-contract/). Author them in the Contract's Meaning tab, then ship the Contract through its [lifecycle](/guides/author-and-ship-a-contract/).

## See also

- [Connect Trino and BI tools (read path)](/guides/connect-read-path/)
- [Author and ship a Data Contract](/guides/author-and-ship-a-contract/)
- [Meaning, Access, State](/concepts/dimensions/)
