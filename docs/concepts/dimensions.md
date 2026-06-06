# Meaning, Access, State

Every [Data Contract](./data-contract.md) binds a dataset to three dimensions. They are **coupled** — changing one can affect the others — and **co-equal** — none is merely infrastructure for the others. Customers buy all three; cross-engine **Access** enforcement is simply the easiest one to demonstrate first.

## Meaning

**Meaning** guarantees that a metric or dimension returns *bit-identical* results from every engine.

In a multi-engine lakehouse, "revenue this quarter" is usually computed slightly differently in each engine: a different rounding rule, a different join, a different fiscal-calendar boundary, a different null-handling convention. Two dashboards disagree, and nobody can say which is right.

Neksur's Meaning dimension is a **semantic layer** with three properties:

- **An AST is the source of truth.** Metrics and dimensions are authored once into an abstract syntax tree, not as per-engine SQL.
- **Per-engine dialect compilation.** The AST compiles to each engine's dialect, so the *same* metric definition produces equivalent SQL for Spark, Trino, Snowflake, and Dremio.
- **Roundtrip-stable interchange.** Semantic models import and export through the Open Semantic Interchange (OSI), so definitions are portable rather than locked into one vendor's modeling language.

The acceptance bar is literal: golden-test results must match bit-for-bit across engines.

## Access

**Access** guarantees that one declarative policy is enforced *identically* on read and on write, at runtime, everywhere the data is reachable.

A single policy expresses:

- **Row filters** — which rows a principal may see.
- **Column masks** — which columns are masked, hashed, tokenized, or redacted.
- **RBAC** — role-based allow/deny.
- **ABAC** — attribute-based rules over principal, table, and commit context.

The policy is authored once and compiled to every enforcement point: the catalog gateway (write), the read-path SQL proxy (read), and the writer-side transform (pre-write). The load-bearing property is **default-deny**: if the policy engine cannot produce a verdict — a fetch error, a compile error, a panic — the operation is *rejected*, never allowed-by-default. A policy that fails to evaluate fails closed.

This is the **primary wedge**. The April 2026 Databricks Unity Catalog limitation — row filters and column masks are not enforced through the Iceberg REST API — is the concrete, document-able gap the Access dimension closes.

## State

**State** guarantees that every engine sees the same *version* of the data and coordinates its mutations.

Heterogeneous engines writing and reading the same Iceberg tables fight over table state in ways that are hard to debug:

- **Snapshot pinning** — a consumer pins a snapshot for a reproducible read; State prevents another engine's `ExpireSnapshots` from silently deleting it out from under them.
- **Schema cache invalidation** — when one engine evolves the schema, others' caches are invalidated so they don't read stale column layouts.
- **Write-conflict resolution** — a per-table policy (last-writer-wins, abort, or retry-with-backoff) decides how concurrent commits reconcile.
- **Partition-spec versioning** — partition-spec evolution is tracked so a downgrade doesn't reject valid writes.
- **Compaction coordination** — compaction windows are coordinated so an operator-held retention pin isn't expired by a default compaction job.

Some State guarantees (snapshot pinning, schema/retention policy at the gateway) are in Neksur Core; the cross-engine coordination pieces (write-conflict, partition-spec evolution, compaction) are Commercial / Enterprise edition capabilities — see [Editions and tiers](./editions.md).

## Why they are coupled

The dimensions are not independent. A schema change (State) can change what a column mask must cover (Access) and what a metric means (Meaning). Pinning a snapshot (State) determines which rows an Access filter applies to. Because all three live in one Contract and one lifecycle, a change that touches several dimensions is reviewed, compiled, and deployed as one unit — not as three policies that can drift apart.

## See also

- [The Data Contract](./data-contract.md)
- [The Contract lifecycle](./lifecycle.md)
- [Enforcement model](./enforcement.md)
