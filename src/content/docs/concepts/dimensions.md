---
title: "Meaning, Access, State"
description: "Every Data Contract binds a dataset to three dimensions. They are coupled — changing one can affect the others — and co-equal — none is merely…"
---

Every [Data Contract](/concepts/data-contract/) binds a dataset to three dimensions. They are **coupled** — changing one can affect the others — and **co-equal** — none is merely infrastructure for the others. Customers buy all three; cross-engine **Access** enforcement is simply the easiest one to demonstrate first.

## Meaning

**Meaning** guarantees that a metric or dimension returns *bit-identical* results from every engine.

In a multi-engine lakehouse, "revenue this quarter" is usually computed slightly differently in each engine: a different rounding rule, a different join, a different fiscal-calendar boundary, a different null-handling convention. Two dashboards disagree, and nobody can say which is right.

Neksur's Meaning dimension is a **semantic layer** with three properties:

- **An AST is the source of truth.** Metrics and dimensions are authored once into an abstract syntax tree, not as per-engine SQL.
- **Per-engine dialect compilation.** The AST compiles to each engine's dialect, so the *same* metric definition produces equivalent SQL for Spark, Trino, Snowflake, and Dremio.
- **Roundtrip-stable interchange.** Semantic models import and export through the Open Semantic Interchange (OSI), so definitions are portable rather than locked into one vendor's modeling language.

The acceptance bar is literal: golden-test results must match bit-for-bit across engines.

Meaning is also **grounded**: a metric connects to a shared glossary concept (`MEANS` → `GlossaryTerm`) so the same concept has one definition tenant-wide, and to the physical columns it is computed over (`COMPUTED_OVER`) so it is anchored to real data. See [grounded Meaning](/concepts/unified-contract-model/#grounded-meaning).

## Access

**Access** guarantees that one declarative policy is enforced *identically* on read and on write, at runtime, everywhere the data is reachable.

A single policy expresses:

- **Row filters** — which rows a principal may see.
- **Column masks** — which columns are masked, hashed, tokenized, or redacted.
- **RBAC** — role-based allow/deny.
- **ABAC** — attribute-based rules over principal, table, and commit context.

The policy is authored once and compiled to every enforcement point: the catalog gateway (write), the read-path SQL proxy (read), and the writer-side transform (pre-write). The load-bearing property is **default-deny**: if the policy engine cannot produce a verdict — a fetch error, a compile error, a panic — the operation is *rejected*, never allowed-by-default. A policy that fails to evaluate fails closed.

This is the **primary wedge**. The April 2026 Databricks Unity Catalog limitation — row filters and column masks are not enforced through the Iceberg REST API — is the concrete, document-able gap the Access dimension closes.

Policy is **tag-scoped**: a column is classified once with a Tag, and a policy written against the Tag is compiled down to per-table artifacts wherever that tag appears — *classify once, govern everywhere*. A metric inherits the sensitivity of the columns it is computed over by default, and removing that inherited sensitivity (declassification) requires an explicit governance-steward attestation, never an automatic rule. See [tag-scoped Access](/concepts/unified-contract-model/#tag-scoped-access--classify-once-govern-everywhere) and [declassification](/concepts/unified-contract-model/#declassification).

## State

**State** guarantees that every engine sees the same *version* of the data, coordinates its mutations, and keeps that data measurably healthy. State is the broadest dimension, and it splits two ways.

### Contract-State vs Dataset-State

- **Contract-State** is where the *agreement* is — the [lifecycle](/concepts/lifecycle/) stage of the Contract itself (`draft → review → compile → deploy → active → audit`). It tracks the agreement, not the bytes.
- **Dataset-State** is the condition of the *data* the Contract owns, in two halves:
  - **Physical** — files, snapshots, compaction, expiry, schema/partition evolution: which version exists and how engines coordinate mutating it.
  - **Logical** — quality, classification, conformance, reconciliation: whether the data that exists is *healthy and means what it should*.

This split is why "data quality" is not a separate object in Neksur — it is the **Logical** half of one Contract's Dataset-State. See [Data quality (the Logical dimension of State)](/guides/data-quality/).

### Physical Dataset-State — version coordination

Heterogeneous engines writing and reading the same Iceberg tables fight over table state in ways that are hard to debug:

- **Snapshot pinning** — a consumer pins a snapshot for a reproducible read; State prevents another engine's `ExpireSnapshots` from silently deleting it out from under them. The Contract also carries a **durable pinned snapshot** — an event-sourced, as-of anchor (a `PinEvent` stream) that fixes which version of the data every attestation holds against, not "whatever is latest now." See [the durable pinned snapshot](/concepts/unified-contract-model/#the-durable-pinned-snapshot).
- **Schema cache invalidation** — when one engine evolves the schema, others' caches are invalidated so they don't read stale column layouts.
- **Write-conflict resolution** — a per-table policy (last-writer-wins, abort, or retry-with-backoff) decides how concurrent commits reconcile.
- **Partition-spec versioning** — partition-spec evolution is tracked so a downgrade doesn't reject valid writes.
- **Compaction coordination** — compaction windows are coordinated so an operator-held retention pin isn't expired by a default compaction job.

### Logical Dataset-State — measurable health

The Logical half makes the data's *health* a property of the Contract: **freshness** (how recent the pinned data is), **volume** (row counts in an expected band), **conformance** (the schema the data must keep), **classification** (the sensitivity tags detection attaches to columns), and **reconciliation** (every engine agrees on the numbers). These are authored in the Contract's **State → Quality** view and checked at the [`deploy → active` gate](/concepts/lifecycle/#the-deploy--active-data-gate). Full treatment: [Data quality (the Logical dimension of State)](/guides/data-quality/).

### The two State invariants

Two **separate** guarantees keep the pinned snapshot honest. They are different mechanisms protecting different things — do not conflate them:

- **Inv-A — pin-aware retention.** Garbage collection (snapshot expiry, compaction — *Physical* state) must not delete files reachable from a pinned snapshot. *Which files survive.*
- **Inv-B — cross-engine reconciliation.** Every engine reads the *same* pinned snapshot identically and agrees on the numbers. *Which numbers agree.*

Both anchor on the [durable pinned snapshot](/concepts/unified-contract-model/#the-durable-pinned-snapshot); see [the two invariants in the unified model](/concepts/unified-contract-model/#the-two-state-invariants).

Some State guarantees (snapshot pinning, schema/retention policy at the gateway, the DQ engine) are in Neksur Core; the cross-engine coordination pieces (write-conflict, partition-spec evolution, compaction, reconciliation across additional engines) are Commercial / Enterprise edition capabilities — see [Editions and tiers](/concepts/editions/).

## Why they are coupled

The dimensions are not independent. A schema change (State) can change what a column mask must cover (Access) and what a metric means (Meaning). Pinning a snapshot (State) determines which rows an Access filter applies to. Because all three live in one Contract and one lifecycle, a change that touches several dimensions is reviewed, compiled, and deployed as one unit — not as three policies that can drift apart.

## See also

- [The Data Contract](/concepts/data-contract/)
- [The unified contract model](/concepts/unified-contract-model/)
- [The Contract lifecycle](/concepts/lifecycle/)
- [Enforcement model](/concepts/enforcement/)
