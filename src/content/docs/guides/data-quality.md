---
title: "Data quality (the Logical dimension of State)"
description: "Data quality is not a separate contract. Freshness, volume, conformance and cross-engine reconciliation are facets of the one Data Contract's State — the Logical half of Dataset-State — enforced at the deploy → active gate and surfaced as Prove evidence."
---

**Job:** Prove · **Edition:** Core (DQ engine); cross-engine reconciliation across additional engines is Multi-Engine.

Data quality in Neksur is **not a separate contract type**. There is exactly one [Data Contract](/concepts/data-contract/) per dataset, and quality is a **dimension of that one Contract** — specifically the **Logical** half of its [Dataset-State](/concepts/dimensions/#state). Freshness, volume, conformance, classification and reconciliation are *facets of the Contract's State*, not a parallel object with its own root.

That distinction matters. A standalone "DQ contract" floating next to the Data Contract would be a second source of truth about the same dataset — exactly the drift the [unified contract model](/concepts/unified-contract-model/) exists to eliminate. So everything on this page hangs off one root: the quality facets you author below become part of the Contract's State, they are checked at the Contract's [lifecycle gate](/concepts/unified-contract-model/#the-lifecycle-gate), they reconcile against the Contract's [durable pinned snapshot](/concepts/unified-contract-model/#the-durable-pinned-snapshot), and their breaches feed the Contract's **Prove** evidence.

## Where quality lives in the model

[State](/concepts/dimensions/#state) splits two ways:

- **Contract-State** — where the *agreement* is in its [lifecycle](/concepts/lifecycle/) (`draft → review → compile → deploy → active → audit`).
- **Dataset-State** — the condition of the data itself, in two halves:
  - **Physical** — files, snapshots, compaction, expiry.
  - **Logical** — **quality, classification, conformance, and reconciliation.** *This is where the material on this page lives.*

So a freshness rule or a cross-engine reconciliation check is a property of the *Logical* Dataset-State of the one Contract. It is authored in the Contract's **State → Quality** view, checked when the Contract crosses its gate, and proven as part of the Contract's audit evidence.

## Authoring the State / Quality facet

You declare the quality facets of a Contract's State as a YAML block. The block describes *the State of one Contract's owned table* — it is not a second contract object, even though it carries its own `apiVersion` for the authoring surface:

```yaml
# This is the State/Quality facet of a Data Contract — not a standalone contract.
# It is authored in the Contract's State → Quality view and checked at the
# deploy → active gate against the Contract's pinned snapshot.
apiVersion: neksur.io/v1
table_uri: s3://data-lake/warehouse/orders
name: Orders — State / Quality
description: Logical-state guarantees for the orders table this Contract owns

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

The fields map onto the Logical-state facets:

| Block | Logical-state facet |
|-------|---------------------|
| `schema` | **conformance** — the shape the data must keep |
| `freshness` | **freshness** — how recent the pinned data must be |
| `volume` | **volume** — row counts within an expected band |
| `cross_engine_check` | **reconciliation** — every engine agrees on the numbers |

### Allowed field types

Iceberg-compatible: `boolean, int, long, float, double, decimal, date, time, timestamp, timestamptz, string, uuid, binary, fixed, struct, list, map`.

### Cross-engine query safety

The `cross_engine_check.query` is constrained so it can't be used to exfiltrate rows or produce non-deterministic comparisons:

- **Aggregates only** (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, …) — no plain row-level `SELECT`.
- **No non-deterministic functions** (`NOW()`, `CURRENT_DATE`, `RAND()`, `RANDOM()`).
- **No `ORDER BY` without `LIMIT`** (non-deterministic ordering).

## The two State invariants quality rides on

The Logical-state checks above only mean something *as of a fixed version of the data* — the Contract's [durable pinned snapshot](/concepts/unified-contract-model/#the-durable-pinned-snapshot). Two separate guarantees keep that anchor honest:

- **Inv-A — pin-aware retention.** Snapshot expiry and compaction (the *Physical* half of Dataset-State) must not garbage-collect files reachable from a pinned snapshot. Quality you attested against a pinned version stays reproducible because the files behind it are protected.
- **Inv-B — cross-engine reconciliation.** Every engine reads the *same* pinned snapshot and agrees on the numbers. The `cross_engine_check` block is the authoring surface for this invariant: a check runs the same aggregate on each listed engine and flags a breach if results diverge beyond `tolerance`.

These are **two different guarantees** — Inv-A is about *which files survive*, Inv-B is about *which numbers agree* — and the [State dimension](/concepts/dimensions/#the-two-state-invariants) treats them as separate. See the [unified contract model](/concepts/unified-contract-model/#the-two-state-invariants) for how both anchor on the durable pin.

## The deploy → active gate runs these checks

Quality is not something a Contract opts into after it goes live — it is part of how a Contract is *allowed* to go live. The [`deploy → active` data gate](/concepts/lifecycle/#the-deploy--active-data-gate) runs **these DQ checks plus cross-engine reconciliation against the pinned snapshot** before promotion. The gate's posture is **block, breach, and escalate-breaking**:

| Change at the gate | Result |
|--------------------|--------|
| Add a column | additive · flows through (machine-gated) |
| Remove a column | breaking · escalates to human sign-off |
| Change a column type | breaking · escalates to human sign-off |
| Narrow optional → required | breaking · escalates to human sign-off |
| Freshness / volume / reconciliation check fails | gate **blocks the transition and raises a breach** |

Breaking-change detection is the **Evolution** axis at work (see the [unified contract model](/concepts/unified-contract-model/#evolution-trust-and-the-meta-axes)): a non-breaking, verified change advances automatically; a breaking one escalates to the review-stage sign-off so consumers are protected before they break. A re-pin runs through the same gate.

## Generating a starter facet

Neksur can generate a starter State/Quality block from an existing table's current schema, giving you a baseline to tighten. You then author and refine it in the Contract's **State → Quality** section in the console — not as a separate document, but as part of the one Contract.

## Breaches as Prove evidence

A breach produces a record in the metadata graph linked to the dataset and to the **governing Contract** (there is only one), so it shows up in that Contract's **State → Quality** view and in the **Activity** feed. Because the breach is anchored to the Contract's pinned snapshot, the record says *which version of the data* failed which guarantee. Combined with the [audit chain](/guides/compliance-and-audit/), this is the *Prove* job: defensible, as-of evidence of whether the Contract's quality guarantees held over time.

## See also

- [Meaning, Access, State](/concepts/dimensions/#state) — where Dataset-State / Logical fits among the dimensions.
- [The unified contract model](/concepts/unified-contract-model/) — the one authoritative root, the State split, and both invariants.
- [The Contract lifecycle](/concepts/lifecycle/#the-deploy--active-data-gate) — the gate that runs these checks.
- [Compliance and audit](/guides/compliance-and-audit/) — how breaches become audit evidence.
