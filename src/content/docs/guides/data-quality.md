---
title: "Data quality contracts"
description: "A data-quality (DQ) contract attaches measurable quality guarantees — freshness, volume, and cross-engine reconciliation — to a dataset. Breaches are…"
---

**Job:** Prove · **Edition:** Core (DQ engine); cross-engine reconciliation across additional engines is Multi-Engine.

A data-quality (DQ) contract attaches measurable quality guarantees — freshness, volume, and cross-engine reconciliation — to a dataset. Breaches are detected, recorded in the graph, and surfaced as part of the Contract's State/Quality view.

## The DQ contract YAML

DQ contracts use the `neksur.io/v1` schema:

```yaml
apiVersion: neksur.io/v1
table_uri: s3://data-lake/warehouse/orders
name: Orders SLA Contract
description: Service level agreement for the orders table

schema:
  fields:
    - name: order_id
      type: long
      required: true
      description: Primary key
    - name: customer_id
      type: long
      required: true
    - name: total_usd
      type: double
    - name: created_at
      type: timestamp
    - name: status
      type: string

freshness:
  max_staleness_seconds: 86400      # data must be < 1 day old
  severity: high                    # critical | high | medium | low

volume:
  max_deviation_fraction: 0.2       # row count within ±20% of expected
  severity: medium

cross_engine_check:
  query: "SELECT COUNT(*), SUM(total_usd) FROM orders GROUP BY status"
  engines: [trino, snowflake]
  tolerance: 0.001                  # results must agree within 0.1%
```

### Allowed field types

Iceberg-compatible: `boolean, int, long, float, double, decimal, date, time, timestamp, timestamptz, string, uuid, binary, fixed, struct, list, map`.

### Cross-engine query safety

The `cross_engine_check.query` is constrained so it can't be used to exfiltrate rows or produce non-deterministic comparisons:

- **Aggregates only** (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, …) — no plain row-level `SELECT`.
- **No non-deterministic functions** (`NOW()`, `CURRENT_DATE`, `RAND()`, `RANDOM()`).
- **No `ORDER BY` without `LIMIT`** (non-deterministic ordering).

A check runs the same query on each listed engine and flags a breach if the results diverge beyond `tolerance` — this is the **State/Meaning** guarantee made measurable: every engine agrees on the numbers.

## Breaking-change rules

When a DQ contract's schema evolves, Neksur classifies the change:

| Change | Allowed? |
|--------|----------|
| Add a column | ✅ additive |
| Remove a column | ❌ breaking |
| Change a column type | ❌ breaking |
| Narrow optional → required | ❌ breaking |

## Generating a starter contract

Neksur can generate a DQ contract from an existing table's current schema, giving you a baseline to tighten. Author and refine it in the Contract's **State → Quality** section in the console.

## Breaches as evidence

A breach produces a record in the metadata graph linked to the dataset and the governing Contract, so it shows up in the Contract's Quality view and in the **Activity** feed. Combined with the [audit chain](/guides/compliance-and-audit/), this is the *Prove* job: defensible evidence of whether quality guarantees held over time.

## See also

- [Compliance and audit](/guides/compliance-and-audit/)
- [Meaning, Access, State](/concepts/dimensions/)
