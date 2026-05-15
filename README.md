# Neksur Documentation

Public documentation for **Neksur — the Open Lakehouse Control Plane for Apache Iceberg**.

This repository builds and publishes [docs.neksur.com](https://docs.neksur.com).

## Status

**Active development — Phase 0 + Phase 1 shipped, Phase 2 in planning (as of 2026-05-15).** The graph foundation and the first write-path enforcement layer are operational against design-partner clusters. The documentation site itself is not yet published; content is landing into the directory layout below as each phase completes, and the site goes live in Phase 7 (Distribution, Licensing Infra & GTM Enablement).

## What's Available Now

Phase 0 + Phase 1 deliverables that an operator can deploy and exercise today:

- **Metadata graph foundation** — Apache AGE on Postgres 16, 19 canonical node labels + 24 edge labels, mandatory `tenant_id` + Postgres RLS, Patroni-managed HA with <30s failover, pgBackRest backups sized for RTO 1h / RPO 15min, OpenTelemetry → Prometheus → AlertManager observability with on-call paging on P99 Cypher latency breach.
- **Iceberg catalog integration** — Polaris reference adapter and Nessie adapter behind a 6-method `IcebergCatalogClient` interface; idempotent MERGE ingestion of Tables, Columns, Snapshots, and `LINEAGE_OF` edges; OpenLineage v2 HTTP receiver with cycle prevention and bounded traversal helpers.
- **L1 Catalog Gateway (ADR-003 basic)** — Iceberg REST proxy in front of Polaris / Unity / Glue / Snowflake / Nessie that intercepts commit endpoints and enforces schema policy (P1), write ACL (P2), and retention (P3) at commit time. Violations rejected with `403`; valid commits forwarded transparently and audit-logged.
- **CEL policy engine** — Policy text authored against a stable evaluation environment (table / commit / principal bindings), compiled with an LRU cache, fail-closed semantics on engine unavailability. `neksur-cli policy compile` validates policies offline before push.
- **Lineage tracking** — Every commit produces `WriteEvent` + `INTENDED_WRITE` (Principal→Table) + `ACTUAL_WRITE` (Snapshot→Table) edges; lineage queries are bounded (default depth 3, cap 5) and indexed for the Phase 0 envelope (10M nodes / 50M edges).
- **L3 basic PII detection** — Async post-commit scanner driven by three sources (30s poller, Polaris webhook, S3 ObjectCreated via SNS+SQS); regex classifier for SSN / email / credit card / phone with stratified-by-file-size sampling; Slack alerts at confidence ≥0.85; `DetectionRun` nodes with `VIOLATION_DETECTED_BY` edges recorded in the graph.

Future phases — cross-engine read-path policy enforcement (Phase 2), multi-engine adapters and coordination (Phase 3), the semantic engine and API surface (Phase 4), the MCP server (Phase 5), compliance bundles and ML-based detection (Phase 6), and the licensing / distribution machinery (Phase 7) — are in planning. See [`intro/`](./docs/intro/) for the full roadmap once landed.

## Documentation Map

Live entry points for the Phase 0 + Phase 1 surface:

- [Introduction & roadmap](./docs/intro/) — What Neksur is, who it's for, current status.
- [Architecture overview](./docs/architecture/overview.md) — System diagram, write-path enforcement levels, ADR index.
- [Install and write your first policy](./docs/getting-started/install-and-first-policy.md) — End-to-end from zero to a policy rejecting a non-compliant Iceberg commit.
- [REST API reference](./docs/reference/rest-api.md) — Iceberg gateway endpoints, OpenLineage receiver, admin surface.
- [Deployment runbook](./docs/operations/deploy.md) — Production deploy, HA topology, backup and DR drills, alert routing.

## License

This documentation repository is licensed under the **Apache License, Version 2.0**. See [`LICENSE`](LICENSE) for the full text. Apache 2.0 is permissive — anyone can read, copy, modify, and redistribute the documentation, including in commercial products, as long as the license notice and copyright are preserved.

Note that the **Neksur Core source code** is licensed under the **Business Source License 1.1** (not Apache 2.0) — see [`neksur-com/neksur`](https://github.com/neksur-com/neksur) for details. Apache 2.0 here applies only to documentation, examples, and reference material in this repository.

## Planned Structure

Documentation is organized by audience. Final framework choice is TBD (candidates: Astro Starlight, Hugo + Doks, MkDocs Material) — to be picked when Phase 7 work begins. Anticipated top-level structure:

```
docs/
├── intro/             # What is Neksur, who is it for, status
├── architecture/      # ADRs (published copies of ADR-001..004+), system diagrams
├── concepts/          # Open lakehouse, Iceberg, multi-engine, write-path enforcement
├── getting-started/   # Install Core, connect a catalog, write your first policy
├── reference/         # API docs (REST, GraphQL, MCP, SQL proxy, SDK)
├── guides/            # How-to: integrate Spark, integrate Trino, compliance bundles
├── operations/        # Deploy, scale, monitor, backup/restore, DR drill
├── licensing/         # BSL FAQ, Commercial tiers, design partner program
└── examples/          # End-to-end scenarios, sample policies, sample workloads
```

## Contributing

Documentation contributions are welcome and use a lightweight process — see [`CONTRIBUTING.md`](CONTRIBUTING.md). No DCO sign-off required for docs (Apache 2.0 doesn't need it the way BSL does).

For typos and small fixes, open a PR directly. For structural changes or new top-level sections, open an issue first.

## Repository Map

This is the **Neksur Documentation** repository. Related repositories under the `neksur-com` organization:

| Repository | Visibility | License | Purpose |
|---|---|---|---|
| [`neksur-com/neksur`](https://github.com/neksur-com/neksur) | public | BSL 1.1 → Apache 2.0 (2030-05-10) | Neksur Core source code |
| [`neksur-com/neksur-premium`](https://github.com/neksur-com/neksur-premium) | private | Neksur Commercial License | Commercial Premium components |
| `neksur-com/docs` (this repo) | public | Apache 2.0 | Public documentation |

## Contact

- **General:** `hello@neksur.com`
- **Documentation issues:** open a GitHub issue on this repo
- **Architecture / roadmap questions:** `hello@neksur.com` or open an issue on [`neksur-com/neksur`](https://github.com/neksur-com/neksur)

---

*Documentation site scaffold initialized 2026-05-12. Last updated 2026-05-15 after Phase 0 + Phase 1 shipped. Site publication target: Phase 7 of Neksur roadmap.*
