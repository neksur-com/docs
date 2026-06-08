---
title: "What is Neksur?"
description: "Neksur is the Data Contract Plane for open lakehouses. It governs Apache Iceberg tables through a single Data Contract per dataset — one declaration that…"
---

Neksur is **the Data Contract Plane for open lakehouses**. It governs Apache Iceberg tables through a single **Data Contract** per dataset — one declaration that every query engine, every catalog, and every AI agent must honor when it reads or writes that data.

It is not a query engine, and it is not a catalog. Neksur runs **in front of** your existing Iceberg catalog (Polaris, Nessie, Glue, Unity) and **in the request path** of your engines (Spark, Trino, Snowflake, Dremio) — turning a policy authored once into behavior that is identical everywhere the data is reachable.

## The Data Contract

Everything in Neksur is organized around one abstraction: the **Data Contract**. A Contract binds a dataset to three coupled dimensions, governed by one lifecycle.

### Three coupled dimensions

| Dimension | What it guarantees |
|-----------|--------------------|
| **Meaning** | A metric or dimension returns *bit-identical* results from Spark, Trino, Snowflake, and Dremio. A semantic layer with per-engine dialect compilation and an AST as the single source of truth eliminates the "every engine computes revenue slightly differently" problem. |
| **Access** | One declarative policy — row filter, column mask, RBAC, ABAC — is compiled and enforced *identically* when Spark writes and when Trino / Snowflake / Dremio read, at runtime, with **default-deny** if the policy cannot be evaluated. |
| **State** | The same Iceberg snapshot, schema version, write-conflict policy, partition spec, and compaction window are honored by every engine that touches the table — no more "Spark expired the snapshot Trino was pinned to." |

The three dimensions are **co-equal**. Meaning and State are not plumbing for Access; customers buy all three. But cross-engine enforcement of the **Access** dimension is the **primary wedge** — the narrowest, most-documentable starting point. The April 2026 Databricks Unity Catalog limitation, where [row filters and column masks are not enforced through the Iceberg REST API](https://docs.databricks.com/aws/en/data-governance/unity-catalog/filters-and-masks/), is the concrete story: a policy that holds inside one platform's own compute silently evaporates the moment another engine reads the same table.

### One lifecycle

Every Contract moves through one governed state machine:

```
draft → review → compile → deploy → active → audit
```

- **draft** — authored, not yet submitted.
- **review** — submitted for sign-off (data owner, access owner, governance owner). Can return to draft on requested revisions.
- **compile** — sign-offs collected; the compiler materializes per-engine artifacts. Compile failure returns to draft.
- **deploy** — compiled artifacts roll out to the engines (Trino, the SQL proxy, the catalog gateway). Deploy failure returns to compile.
- **active** — the Contract is live and enforced everywhere. Can roll back to deploy.
- **audit** — post-active review against audit evidence; returns to active on a clean audit, or to draft to re-author.

Illegal jumps (e.g. `draft → compile`, skipping review) are rejected by construction.

### Three buyer jobs

The Contract and its lifecycle serve three jobs, in order:

1. **Define** the Contract — author Meaning, Access, and State once.
2. **Enforce** it across every engine — at write time, at read time, and as a post-commit backstop.
3. **Prove** it — produce audit-grade, tamper-evident evidence that the Contract was honored.

AI agents are **first-class Contract consumers**: the same governed metadata graph is exposed to LLM agents over the Model Context Protocol (MCP) under the same Access policies — agents get row-filtered, column-masked results, not raw graph access.

## Who is it for?

Neksur is built for the operators and governors of the open lakehouse, not for the analysts who consume it.

- **Data platform engineers / CTOs** who run multi-engine lakehouses and need one place to express Meaning, Access, and State.
- **Lakehouse operators** who deploy and maintain Iceberg catalogs and the engines around them — the people paged when a Spark write breaks a Trino read.
- **Compliance officers and security engineers** who need defensible, audit-grade evidence that a row filter authored once is actually enforced everywhere the underlying table is reachable.

The qualified profile: an Iceberg adopter with **2+ query engines**, *or* a **documented compliance audit gap**.

If you write SQL or call an API, you will not interact with Neksur directly. You will only notice that your queries respect the same policies whether they run through Spark, Trino, Snowflake, or Dremio.

## How does it work?

Neksur enforces the Contract at **multiple coordinated points** in the data path, backed by one tenant-scoped metadata graph. Each point fails differently, so together they cover the surface no single interception can.

```
   Spark / Flink  ─ writer-side transform ─┐
                                           ▼
                 ┌──────────────────────────────────────┐
                 │  Catalog Gateway (Iceberg REST proxy) │ ─► Polaris / Nessie /
                 │  commit-time policy + audit           │     Glue / Unity
                 └──────────────────────────────────────┘
                                           │
   Trino / Dremio / ─ read-path SQL proxy ─┤        ┌───────────────────────────┐
   BI (pgwire/XMLA)   row filter + mask    │        │  Credential vending       │
                                           │        │  (compute isolation gate) │
                                           ▼        └───────────────────────────┘
                 ┌──────────────────────────────────────┐
                 │  Post-commit detection                │
                 │  (regex + ML PII classification)      │
                 └──────────────────────────────────────┘
                                           │
                                           ▼
                       Tenant-scoped metadata graph
                       (Apache AGE on Postgres 16)
                       Contracts · lineage · audit chain
```

- **Catalog Gateway (write path).** Neksur is an Iceberg REST catalog proxy in front of your real catalog. Every commit is inspected at commit time — schema policy, write ACL, retention, classification, residency — and either forwarded transparently or rejected with a structured error and an audit record. Customers change one URL in their Spark config; the upstream catalog is unchanged.
- **Writer-side transform.** For Spark, an optional pre-write layer (Catalyst extension *or* explicit SDK) applies column masks, encryption, redaction, and tokenization *before* bytes land in object storage. Fail-closed: no governed write proceeds without a successfully applied policy.
- **Read-path SQL proxy.** The same declarative Access policy is compiled to each engine's dialect and injected into read traffic, so a row filter authored once is enforced when Trino, Dremio, or a BI tool reads. BI clients connect over the Postgres wire protocol (`pgwire`) or XMLA (Excel / Power BI).
- **Credential vending (compute isolation).** A vending boundary that hands out short-lived, scoped credentials so engines cannot reach storage outside the Contract's bounds.
- **Post-commit detection.** A backstop for write paths that bypass the gateway (direct S3 writes, hand-crafted manifests, third-party ingestion). New snapshots are sampled and classified; findings raise alerts and a detection record in the graph.

> **A note on terminology.** Internally these enforcement points carry level codes (the write-path defense model defined in ADR-003). Public docs use the descriptive names above; the level codes are an implementation detail and do not appear in user-facing surfaces.

## Editions and tiers

Neksur ships as a **single binary** whose capabilities are unlocked by a signed license file. The product is sold as four **additive** tiers — each includes everything below it.

| Tier | License | What it adds | Buyer question |
|------|---------|--------------|----------------|
| **Core** | BSL 1.1 → Apache 2.0 (2030-05-10) | Catalog-level enforcement (the Iceberg gateway), the CEL policy engine, the metadata graph, lineage, the semantic layer, basic (regex) detection, REST/GraphQL/MCP/SQL-proxy surfaces. | "I want the model end-to-end on one catalog." |
| **Multi-Engine** | Commercial | Identical enforcement across Spark + Trino + ≥1 of Snowflake / Dremio / Flink, plus continuous cross-engine consistency verification. | "Production is multi-engine; the Contract must hold everywhere." |
| **Defense-in-Depth** | Commercial | Writer-side pre-write transforms, continuous compliance scanning, and compute-isolation credential vending. | "Auditors require defense in depth on the write path." |
| **Intelligence** | Commercial | ML-based classification, anomaly detection, semantic-anomaly detection over Contracts, and AI-agent observability. | "We want proactive detection, not just enforcement." |

See [Licensing](/licensing/) for the full edition / repository map and BSL mechanics.

## Status

Neksur Core has progressed from foundation through a GA milestone (v1.0) and is in v1.1 hardening. The capabilities below are present in Neksur Core today; Commercial-tier capabilities are gated behind license flags in the same binary.

**Neksur Core (BSL) — available:**

- **Metadata graph** — Apache AGE 1.6 on Postgres 16, per-tenant graph isolation with `tenant_id` + Postgres RLS, Patroni HA (<30s failover), pgBackRest backup/PITR (RTO 1h / RPO 15min), OpenTelemetry → Prometheus → AlertManager observability.
- **Iceberg catalog integration** — Polaris and Nessie live adapters behind a 6-method `IcebergCatalogClient` interface; Glue and Unity adapter slots.
- **Catalog Gateway** — Iceberg REST proxy with commit-time CEL policy enforcement, fail-closed semantics, multi-table reject-all transactions, and a measured ≤5% commit overhead.
- **Access policy engine** — CEL policies (row filter, column mask, schema, write-ACL, retention), compiled with an LRU cache, default-deny on any evaluation failure.
- **Read-path enforcement** — a SQL proxy with per-engine dialect compilation and an engine dispatcher (Trino), plus `pgwire` and XMLA transports for BI tools.
- **Semantic layer** — metric / dimension authoring with an AST source of truth and per-engine compilation (the Meaning dimension).
- **Contract lifecycle** — the full `draft → review → compile → deploy → active → audit` state machine with review queue and sign-offs.
- **Lineage** — OpenLineage v2 ingestion with cycle prevention and bounded traversal.
- **Detection** — regex PII classification (post-commit), with ML classification and a training-data curation workflow in the AI/ML track.
- **Compliance & audit** — a tamper-evident hash-chain audit log, plus data-quality reconciliation and FinOps cost attribution.
- **API surface** — REST (`/v1/*`), GraphQL, an MCP server (`graph.traverse` with row-filter / column-mask push-down), and the SQL-proxy read path.
- **Deployment** — SaaS (AWS, Terraform), self-managed, and air-gapped / on-prem modes.

**Commercial / Enterprise editions** add multi-engine coordination (schema-cache invalidation, write-conflict resolution, cross-engine verification), partition-spec evolution and compaction coordination, and the Intelligence-tier ML features. See [Licensing](/licensing/).

The hosted documentation site goes live alongside the public distribution milestone; until then, content lands here as each capability stabilizes.

## Where to go next

- **[Concepts](/concepts/)** — the Data Contract, the three dimensions, the lifecycle, and the enforcement model, explained from first principles.
- **[Architecture](/architecture/overview/)** — the full system design, layer by layer, with the graph schema and the commit pipeline.
- **[Getting Started](/getting-started/install-and-first-contract/)** — install Neksur, point it at a catalog, and author your first commit-time policy.
- **[Guides](/guides/)** — how to connect Spark / Trino / BI / AI agents, author policies and metrics, ship a Contract, and prove compliance.
- **[REST API Reference](/reference/rest-api/)** — the gateway, lineage, and admin surfaces. See also the [CLI](/reference/cli/) and [policy language](/reference/policy-language/) references.
- **[Deployment](/operations/deploy/)** — production deploy, HA, backup/DR, infrastructure, and the Spark integration.
- **[Licensing](/licensing/)** — editions, tiers, and the BSL.
