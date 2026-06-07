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

The rendered docs live at **[docs.neksur.com](https://docs.neksur.com)**. Source for each section is under [`src/content/docs/`](./src/content/docs/).

- [Introduction](https://docs.neksur.com/intro/what-is-neksur/) — what Neksur is, who it's for, status.
- [Concepts](https://docs.neksur.com/concepts/) — the Data Contract, the three dimensions, the lifecycle, the enforcement model, and the editions.
- [Architecture overview](https://docs.neksur.com/architecture/overview/) — system design, the commit pipeline, the graph schema, the API surface, and the ADR index.
- [Getting started](https://docs.neksur.com/getting-started/install-and-first-policy/) — from zero to a policy rejecting a non-compliant commit.
- [Guides](https://docs.neksur.com/guides/) — task-oriented how-tos: connect Spark / Trino / BI / AI agents, author policies and metrics, ship a Contract, prove compliance.
- [REST API reference](https://docs.neksur.com/reference/rest-api/) — gateway, lineage, and admin endpoints; the broader API surface.
- [CLI & binaries reference](https://docs.neksur.com/reference/cli/) — `neksur-cli`, the server, and the operator tools.
- [Policy language reference](https://docs.neksur.com/reference/policy-language/) — the CEL evaluation environment.
- [Deployment](https://docs.neksur.com/operations/deploy/) — production deploy, HA, backup/DR, infrastructure, and the Spark integration.
- [Licensing](https://docs.neksur.com/licensing/) — editions, tiers, and the BSL.

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

## Site framework

The site is built with **[Astro](https://astro.build) + [Starlight](https://starlight.astro.build)** and deployed as a static site to **Cloudflare Pages**. All prose is Markdown/MDX under `src/content/docs/`; navigation lives in `astro.config.mjs`.

```
src/content/docs/
├── index.mdx          # Landing (splash)
├── intro/             # What is Neksur, who is it for, status
├── concepts/          # Data Contract, dimensions, lifecycle, enforcement, editions
├── architecture/      # System design, commit pipeline, graph schema, ADR index
├── getting-started/   # Install, connect a catalog, write your first policy
├── guides/            # How-to: connect Spark/Trino/BI/AI, author policies & metrics, ship a Contract, prove
├── reference/         # REST API, CLI & binaries, policy language (CEL)
├── operations/        # Deploy, scale, monitor, backup/restore, DR, infrastructure
├── licensing/         # BSL, commercial tiers, design partner program
└── examples/          # End-to-end scenarios, sample policies, sample workloads
```

(Each section's `index.md` is its landing page; e.g. `concepts/index.md` → `/concepts/`.)

## Develop & build

Requires Node (see [`.nvmrc`](.nvmrc)).

```bash
npm install      # install dependencies
npm run dev      # local dev server with hot reload
npm run build    # static build to ./dist (also builds the Pagefind search index)
npm run preview  # preview the production build locally
```

To add a page: create a Markdown file with `title` frontmatter under `src/content/docs/<section>/`, then add it to the `sidebar` in `astro.config.mjs`. Use root-relative links between pages (e.g. `/concepts/dimensions/`).

## Deploy

The site deploys to **Cloudflare (Workers static assets)** — Worker `neksur-docs`, custom domain `docs.neksur.com`. Config is [`wrangler.jsonc`](wrangler.jsonc): it serves the static `./dist` directory directly (no server code), with the prebuilt `404.html` for not-found handling. (This matches the `neksur-com/site` deploy model; the assets directory is `./dist`, **not** `public/`.)

```bash
npm run deploy   # astro build && wrangler deploy   (needs CF auth)
```

Two automated paths:

1. **CI (this repo).** [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds on every push/PR and runs `wrangler deploy` on push to `main`. It requires repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; until those are set, CI still builds (deploy step is skipped).
2. **Cloudflare Workers Builds (dashboard).** Connect this repo with build command `npm run build` and deploy command `wrangler deploy` (the assets directory comes from `wrangler.jsonc`, so it must be `./dist`). Set `NODE_VERSION=22`.

## Contributing

Documentation contributions use a lightweight process — see [`CONTRIBUTING.md`](CONTRIBUTING.md). No DCO sign-off required for docs (Apache 2.0 doesn't need it the way BSL does). For typos and small fixes, open a PR directly. For structural changes or new top-level sections, open an issue first.

## Contact

- **General:** `hello@neksur.com`
- **Documentation issues:** open a GitHub issue on this repo
- **Architecture / roadmap questions:** `hello@neksur.com` or open an issue on [`neksur-com/neksur`](https://github.com/neksur-com/neksur)

---

*Documentation site scaffold initialized 2026-05-12. Reframed to the Data Contract Plane model 2026-06-06. Astro Starlight site stood up (docs.neksur.com) 2026-06-07.*
