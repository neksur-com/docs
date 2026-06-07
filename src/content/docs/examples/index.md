---
title: "Examples"
description: "End-to-end scenarios with runnable code — sample Contracts, sample policies, sample workloads, and compliance setups."
---

End-to-end scenarios with runnable code — sample Contracts, sample policies, sample workloads, and compliance setups.

## Status

This section is being populated. For worked examples available right now, see:

- [Getting Started](/getting-started/install-and-first-policy/) — a complete walkthrough with a schema policy, curl requests against the gateway, and audit-trail inspection.
- [Guides](/guides/) — end-to-end how-tos with copy-pasteable config: [connect Spark](/guides/connect-spark-write-path/), [connect Trino/BI](/guides/connect-read-path/), [author Access policies](/guides/author-access-policies/), [author metrics](/guides/author-semantic-metrics/), [ship a Contract](/guides/author-and-ship-a-contract/).
- [Policy language reference](/reference/policy-language/) — copy-pasteable CEL expressions.
- [REST API Reference](/reference/rest-api/) — curl examples for the gateway, lineage, and webhook endpoints.

## Planned example sets

- **Sample policies** — a curated library of CEL expressions for common scenarios (PII columns required, write-by-role-only, retention floors, row filters, column masks).
- **Sample Contracts** — full Data Contracts binding Meaning + Access + State for a dataset, walked through the `draft → review → compile → deploy → active → audit` lifecycle.
- **Sample workloads** — Iceberg write workloads under Polaris and Nessie, with and without violations, plus Trino reads through the SQL proxy showing identical enforcement.
- **Compliance scenarios** — SOC 2 controls mapped to Contracts; HIPAA-flavored retention + access control; PCI scope reduction via detection and the audit chain.
- **AI-agent recipes** — the MCP `graph.traverse` presets (`ai_agent_context`, `impact_analysis`, `pii_propagation`, `explain_a_number`) under Access enforcement.

Have an example you'd like to contribute? See [CONTRIBUTING.md](https://github.com/neksur-com/docs/blob/main/CONTRIBUTING.md).
