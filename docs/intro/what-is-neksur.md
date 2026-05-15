# What is Neksur?

Neksur is **the open lakehouse control plane for Apache Iceberg**. It sits between query engines and Iceberg catalogs, enforcing a single declarative governance policy uniformly across every engine that reads or writes the same Iceberg tables, with full lineage and audit captured in a single tenant-scoped metadata graph.

It is not a query engine. It is not a catalog. It is the coordination and enforcement layer that runs **in front of** your existing catalog (Polaris, Nessie, Glue, Unity) and **in the request path** of your engines (Spark, Trino, Snowflake, Dremio).

## Who is it for?

Neksur is built for the operators of the open lakehouse, not for the application developers who consume it.

- **Data platform engineers** who run multi-engine lakehouses and need one place to express policy, lineage, and write rules.
- **Lakehouse operators** who deploy and maintain Iceberg catalogs and the engines around them, and who get paged when a Spark write breaks a Trino read.
- **Compliance officers and security engineers** who need defensible, audit-grade evidence that a row filter authored once is actually enforced everywhere the underlying table is reachable.

If you are an analyst writing SQL or a developer calling an API, you will not interact with Neksur directly. You will only notice that your queries respect the same policies whether they go through Spark, Trino, Snowflake, or Dremio.

## What problems does it solve?

Open lakehouses are almost always multi-engine in production: Spark or Flink writing, Trino or Dremio reading, Snowflake consuming the same tables, and AI agents on top. Each engine's native catalog (Databricks Unity, Snowflake Horizon, Polaris RBAC) enforces policies only on its own compute. When an external engine reads through the Iceberg REST API, row filters and column masks are [not enforced](https://docs.databricks.com/aws/en/data-governance/unity-catalog/filters-and-masks/) — a documented April 2026 limitation of Unity Catalog, and a structural property of every platform-native solution.

Neksur addresses four concrete operational gaps that come out of this reality:

1. **Multi-engine policy drift.** One declarative policy (row filter, column mask, RBAC, ABAC) is compiled per engine and enforced identically across all of them, with default-deny on compile failure.
2. **Manual write-path enforcement.** A coordinated layer of catalog-level validation, writer-side transformation, post-commit detection, and credential vending replaces the ad-hoc scripts that teams write to keep PII out of Iceberg snapshots.
3. **Cross-engine lineage tracking.** OpenLineage events from every engine land in one tenant-scoped metadata graph, with cycle prevention and bounded traversal depth, so impact analysis works the same way regardless of which engine produced the data.
4. **Basic PII detection backstop.** Stratified post-commit sampling with regex classifiers (SSN, email, credit card, phone) catches violations that pass through unmediated write paths and alerts the operator before downstream consumers read the bad snapshot.

## How does it work?

Neksur enforces policy through **three coordinated layers** that compose into defense-in-depth. Each layer addresses a different class of risk; together they cover the surface that no single interception point can.

```
                  +----------------------------+
   Spark  ---->   |  L1: Write-Path Gateway    |  ---->  Polaris / Nessie /
   Flink  ---->   |  (Iceberg REST proxy)      |         Glue / Unity
                  +----------------------------+
                              |
                              v
                  +----------------------------+
   Trino  ---->   |  L2: Read-Path SQL Proxy   |  ---->  Iceberg tables
   Dremio ---->   |  (Phase 2+, planned)       |
                  +----------------------------+
                              |
                              v
                  +----------------------------+
                  |  L3: Post-Commit Detection |
                  |  (regex / ML classifiers)  |
                  +----------------------------+
                              |
                              v
                     Tenant-scoped graph
                  (Apache AGE on Postgres)
                  policies, lineage, audit
```

**L1 — Write-Path Gateway.** Neksur acts as an Iceberg REST catalog proxy in front of your real catalog. Every commit (`POST /v1/namespaces/{ns}/tables/{table}`) is inspected at commit time: schema policy, write ACL, retention, and (in later phases) data residency, classification requirements, and partition-spec constraints. Valid commits forward to the upstream catalog transparently; violating commits are rejected with a structured error and recorded in the audit log. Customers change one URL in their Spark config; the upstream catalog deployment is unchanged.

**L2 — Read-Path SQL Proxy.** Planned for Phase 2. Compiles the same declarative policy to each engine's native dialect and injects it into read traffic, so a row filter authored once is enforced identically when Trino, Snowflake, or Dremio reads.

**L3 — Post-Commit Detection.** A backstop for write paths that bypass L1 (direct S3 writes, hand-crafted manifests, third-party ingestion). New snapshots are sampled asynchronously via three trigger sources (catalog poller, catalog webhooks where supported, and S3 ObjectCreated events). Findings produce alerts and a `DetectionRun` node in the graph linked to the offending snapshot.

## What's shipped today (May 2026)

Neksur is pre-MVP. The architecture is locked; implementation has landed two phases of foundation work.

### Phase 0 — Metadata Graph Foundation

- Apache AGE 1.6.0 on Postgres 16 as the single-service metadata graph, with the full canonical schema (19 node labels, 24 edge labels) and all required indexes.
- Tenant isolation via mandatory `tenant_id` on every node plus Postgres row-level security, verified by cross-tenant read tests in CI.
- High availability via Patroni + etcd + HAProxy, with sub-30-second failover verified by chaos tests.
- Backup and disaster recovery via pgBackRest and WAL streaming, sized for RTO 1 hour / RPO 15 minutes.
- Observability: every Cypher query emits duration, nodes visited, edges traversed, and errors via OpenTelemetry, with PagerDuty alerts on sustained P99 latency breaches and clock skew above 100 ms.
- 3-hop bounded queries on a 10M-node / 50M-edge envelope, with depth caps enforced at the query layer.

See [Architecture](../architecture/overview.md) for the full Phase 0 design.

### Phase 1 — Iceberg Catalog Integration, Ingestion & L1 Write-Path Foundation

- **Iceberg catalog adapter model.** Polaris is the reference adapter, tested end-to-end against a live Polaris instance. Nessie is also tested live as the second adapter, proving the model. Glue and Unity Catalog adapters exist as null-object stubs; live end-to-end testing for those two is deferred to Phase 3 alongside the Trino and Snowflake engine work.
- **L1 Catalog Gateway.** Iceberg REST proxy with a CEL-based policy engine, fail-closed semantics, multi-table transaction support, and a measured commit overhead under 5% on warm cache.
- **OpenLineage ingestion.** HTTP consumer landing producer/consumer events as `LINEAGE_OF` edges in the graph, with cycle prevention on edge creation and bounded traversal depth.
- **Basic L3 PII detection.** Regex classifier for SSN, email, credit card, and phone, with stratified sampling per file size and three trigger sources (poller, webhook, S3 ObjectCreated events). Confidence ≥0.85 fires a Slack alert and writes a `DetectionRun` node linked to the snapshot.

The combined Phase 0 + Phase 1 deliverable: a customer can point a Spark write at the Neksur Catalog Gateway, have schema and write-ACL policies enforced at commit time against a Polaris or Nessie backend, see the resulting snapshot land in the metadata graph with lineage, and get alerted when a regex-detectable PII pattern slips through.

## Roadmap

Neksur is built in phases, each delivering a coherent and independently verifiable capability. The next major milestone is **Phase 2: Cross-Engine Policy Enforcement Core (Read + Write)** — a declarative policy DSL with per-engine compilation, verification probes, and default-deny on compile failure, plus the writer-side transformation SDK and the credential-vending gate. Later phases bring multi-engine adapters for Trino, Snowflake, and Dremio (Phase 3); the semantic engine, OSI, and Web UI (Phase 4); the MCP server for AI agents (Phase 5); and the compliance, FinOps, and data-quality bundles (Phase 6).

See the [project status section](../../README.md#status) for the live roadmap and current phase progress.

## Where to go next

- **[Architecture](../architecture/overview.md)** — the full system design, layer by layer, with the graph schema and the write-path enforcement model.
- **[Getting Started](../getting-started/install-and-first-policy.md)** — install Neksur, point it at a Polaris catalog, and author your first commit-time policy.
- **[REST API Reference](../reference/rest-api.md)** — the Iceberg REST endpoints proxied by the Gateway and the Neksur-specific policy and admin APIs.
- **[Deployment](../operations/deploy.md)** — production deployment, HA topology, backup and DR runbooks.
