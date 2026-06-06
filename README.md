# Neksur Documentation

Public documentation for **Neksur — the Data Contract Plane for open lakehouses on Apache Iceberg**.

This repository builds and publishes [docs.neksur.com](https://docs.neksur.com).

## What Neksur is

Neksur governs Apache Iceberg datasets through a single **Data Contract** per dataset — one declaration that binds three coupled dimensions and is honored by every engine, catalog, and AI agent that touches the data:

- **Meaning** — metrics and dimensions that compile to bit-identical results across Spark, Trino, Snowflake, and Dremio.
- **Access** — one declarative policy (row filter, column mask, RBAC, ABAC) enforced identically on read and write, default-deny on failure.
- **State** — snapshot pinning, schema/partition-spec versioning, write-conflict resolution, and compaction coordination across engines.

Each Contract runs one lifecycle — `draft → review → compile → deploy → active → audit` — serving three jobs: **Define** the Contract, **Enforce** it everywhere, **Prove** it with audit evidence. AI agents are first-class Contract consumers over MCP.

Read [What is Neksur?](./docs/intro/what-is-neksur.md) for the full overview.

## Status

Neksur Core has progressed from foundation through a GA milestone (v1.0) into v1.1 hardening. It ships as a **single binary** whose commercial capabilities are gated by a signed license; the open Core is BSL 1.1 (→ Apache 2.0 on 2030-05-10).

The hosted documentation site is not yet published — content lands into the directory layout below as each capability stabilizes, and the site goes live alongside the public distribution milestone.

## What's available now

Neksur **Core** (BSL) provides:

- **Metadata graph** — Apache AGE 1.6 on Postgres 16; per-tenant graph isolation (`tenant_id` + RLS); Patroni HA (<30s failover); pgBackRest backup/PITR (RTO 1h / RPO 15min); OpenTelemetry → Prometheus → AlertManager observability.
- **Iceberg catalog integration** — Polaris and Nessie live adapters behind a 6-method `IcebergCatalogClient` interface; Glue / Unity adapter slots.
- **Catalog Gateway (write path)** — Iceberg REST proxy enforcing commit-time policy with fail-closed semantics, multi-table reject-all transactions, and ≤5% commit overhead.
- **Access policy engine** — CEL policies (row filter, column mask, schema, write-ACL, retention), LRU-compiled, default-deny on any evaluation failure.
- **Read-path enforcement** — SQL proxy with per-engine dialect compilation and an engine dispatcher (Trino), plus `pgwire` and XMLA transports for BI tools (Excel / Power BI).
- **Semantic layer** — metric / dimension authoring with an AST source of truth and per-engine compilation; OSI import/export.
- **Contract lifecycle** — the full `draft → review → compile → deploy → active → audit` state machine, review queue, and sign-offs.
- **Lineage** — OpenLineage v2 ingestion with cycle prevention and bounded traversal.
- **Detection** — regex PII classification (post-commit), with ML classification and a training-data curation workflow in the AI/ML track.
- **Compliance & audit** — tamper-evident hash-chain audit log; data-quality reconciliation; FinOps cost attribution.
- **API surface** — REST (`/v1/*`), GraphQL, an MCP server (`graph.traverse` with row-filter / column-mask push-down), and the SQL-proxy read path.
- **Deployment modes** — SaaS (AWS, Terraform), self-managed, and air-gapped / on-prem.

**Commercial / Enterprise editions** add multi-engine coordination (schema-cache invalidation, write-conflict resolution, cross-engine verification), partition-spec evolution and compaction coordination, writer-side Spark transforms, and the Intelligence-tier ML features. See [Editions and tiers](./docs/concepts/editions.md).

## Documentation map

- [Introduction](./docs/intro/what-is-neksur.md) — what Neksur is, who it's for, status.
- [Concepts](./docs/concepts/README.md) — the Data Contract, the three dimensions, the lifecycle, the enforcement model, and the editions.
- [Architecture overview](./docs/architecture/overview.md) — system design, the commit pipeline, the graph schema, the API surface, and the ADR index.
- [Getting started](./docs/getting-started/install-and-first-policy.md) — from zero to a policy rejecting a non-compliant commit.
- [Guides](./docs/guides/README.md) — task-oriented how-tos: connect Spark / Trino / BI / AI agents, author policies and metrics, ship a Contract, prove compliance.
- [REST API reference](./docs/reference/rest-api.md) — gateway, lineage, and admin endpoints; the broader API surface.
- [CLI & binaries reference](./docs/reference/cli.md) — `neksur-cli`, the server, and the operator tools.
- [Policy language reference](./docs/reference/policy-language.md) — the CEL evaluation environment.
- [Deployment](./docs/operations/deploy.md) — production deploy, HA, backup/DR, infrastructure, and the Spark integration.
- [Licensing](./docs/licensing/README.md) — editions, tiers, and the BSL.

## License

This **documentation** repository is licensed under the **Apache License, Version 2.0** — see [`LICENSE`](LICENSE). Apache 2.0 is permissive: anyone can read, copy, modify, and redistribute the documentation, including in commercial products, as long as the notice and copyright are preserved.

The **Neksur Core source code** is licensed under the **Business Source License 1.1** (not Apache 2.0) — see [`neksur-com/neksur`](https://github.com/neksur-com/neksur). Apache 2.0 here applies only to documentation, examples, and reference material in this repository.

## Repository map

This is the **Neksur Documentation** repository. Related repositories under the `neksur-com` organization:

| Repository | Visibility | License | Purpose |
|---|---|---|---|
| [`neksur-com/neksur`](https://github.com/neksur-com/neksur) | public | BSL 1.1 → Apache 2.0 (2030-05-10) | Neksur Core source code (single binary) |
| `neksur-com/neksur-commercial` | private | Neksur Commercial License | Multi-Engine + Defense-in-Depth coordination |
| `neksur-com/neksur-enterprise` | private | Neksur Enterprise License | Enterprise multi-engine coordination |
| `neksur-com/neksur-spark-policy` | public | BSL 1.1 → Apache 2.0 | Spark writer-side enforcement library |
| `neksur-com/neksur-infra` | private | proprietary | AWS Terraform infrastructure |
| `neksur-com/docs` (this repo) | public | Apache 2.0 | Public documentation |

## Documentation structure

```
docs/
├── intro/             # What is Neksur, who is it for, status
├── concepts/          # Data Contract, dimensions, lifecycle, enforcement, editions
├── architecture/      # System design, commit pipeline, graph schema, ADR index
├── getting-started/   # Install, connect a catalog, write your first policy
├── reference/         # API docs (REST, GraphQL, MCP, SQL proxy)
├── guides/            # How-to: integrate Spark, integrate Trino, compliance
├── operations/        # Deploy, scale, monitor, backup/restore, DR, infrastructure
├── licensing/         # BSL, commercial tiers, design partner program
└── examples/          # End-to-end scenarios, sample policies, sample workloads
```

The static-site framework is chosen alongside the public distribution milestone (candidates: Astro Starlight, Hugo + Doks, MkDocs Material).

## Contributing

Documentation contributions use a lightweight process — see [`CONTRIBUTING.md`](CONTRIBUTING.md). No DCO sign-off required for docs (Apache 2.0 doesn't need it the way BSL does). For typos and small fixes, open a PR directly. For structural changes or new top-level sections, open an issue first.

## Contact

- **General:** `hello@neksur.com`
- **Documentation issues:** open a GitHub issue on this repo
- **Architecture / roadmap questions:** `hello@neksur.com` or open an issue on [`neksur-com/neksur`](https://github.com/neksur-com/neksur)

---

*Documentation site scaffold initialized 2026-05-12. Reframed to the Data Contract Plane model 2026-06-06. Site publication target: the public distribution milestone of the Neksur roadmap.*
