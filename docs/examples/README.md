# Examples

End-to-end scenarios with runnable code — sample policies, sample workloads, sample compliance setups.

## Status

This section is **scaffolded but not yet populated**. Phase 1 ships the policy engine and gateway; concrete example sets land alongside engine integrations (Phase 3+) and the compliance bundle work (Phase 6).

For inline examples right now, see:

- [Getting Started](../getting-started/install-and-first-policy.md) — a complete walkthrough with a P1 schema policy, curl requests against the gateway, and audit-trail inspection
- [REST API Reference](../reference/rest-api.md) — curl examples for every endpoint

## Planned example sets

- **Sample policies** — a curated library of P1 / P2 / P3 CEL expressions for common scenarios (PII columns required, write-by-role-only, 90-day-retention-on-PHI, etc.)
- **Sample workloads** — Iceberg write workloads under Polaris and Nessie, with and without policy violations, to exercise the gateway
- **Compliance scenarios** — SOC 2 controls mapped to Neksur policies; HIPAA-flavored retention + access control; PCI scope reduction via L3 detection
- **Integration recipes** — Spark writers behind the gateway, Trino readers (Phase 2+)

Have an example you'd like to contribute? See [CONTRIBUTING.md](../../CONTRIBUTING.md).
