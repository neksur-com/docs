---
title: "Guides"
description: "Task-oriented how-to guides. Each one walks a single job end-to-end. If you're new, do Getting Started first (install + your first commit-time policy in…"
---

Task-oriented how-to guides. Each one walks a single job end-to-end. If you're new, do [Getting Started](/getting-started/install-and-first-policy/) first (install + your first commit-time policy in ~30 minutes), then come back here.

The guides are grouped by the three buyer jobs — **Define**, **Enforce**, **Prove** — plus connectivity and operations.

## Connect your engines

- **[Connect Spark to the catalog gateway (write path)](/guides/connect-spark-write-path/)** — point Spark's Iceberg REST catalog at Neksur so every commit is policy-checked.
- **[Connect Trino and BI tools (read path)](/guides/connect-read-path/)** — route Trino, and BI tools over `pgwire` / XMLA, through the read-path proxy so reads are row-filtered and column-masked.
- **[Connect an AI agent over MCP](/guides/ai-agents-mcp/)** — give an LLM agent Access-enforced traversal of the metadata graph.

## Define — author the Contract

- **[Author Access policies (CEL)](/guides/author-access-policies/)** — write row filters, column masks, write-ACLs, schema, retention, residency, and classification rules.
- **[Author semantic metrics (Meaning)](/guides/author-semantic-metrics/)** — define metrics and dimensions once and get bit-identical results across engines.
- **[Author and ship a Data Contract](/guides/author-and-ship-a-contract/)** — the full `draft → review → compile → deploy → active → audit` lifecycle in the web console.

## Prove — evidence and quality

- **[Data quality contracts](/guides/data-quality/)** — freshness, volume, and cross-engine reconciliation checks with the DQ contract YAML.
- **[Compliance and audit](/guides/compliance-and-audit/)** — the tamper-evident audit chain, detection findings, FinOps cost attribution, and how to verify the chain offline.

## Use the product

- **[Using the web console](/guides/using-the-web-console/)** — a tour of Catalog, Contracts, Activity, Metrics, and Settings.

## Operate

For deploying and running Neksur (infrastructure, HA, backup/DR, on-prem/air-gapped, secret rotation), see the [Deployment runbook](/operations/deploy/). For the CLI and server binaries, see the [CLI reference](/reference/cli/).

---

Each guide notes which **edition** (Core / Multi-Engine / Defense-in-Depth / Intelligence) and which **role** (admin / DPO) a capability requires. See [Editions and tiers](/concepts/editions/).

Have a guide you'd like prioritized? Open an issue.
