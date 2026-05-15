# Guides

Task-oriented how-to guides — "how do I do X with Neksur?" Each guide walks through a single scenario end-to-end.

## Status

This section is **scaffolded but not yet populated**. Phase 1 ships the write-path foundation; most of the guides below depend on later phases (read-path proxy, engine integrations, compliance bundles).

For now, the closest thing to a guide is [Getting Started](../getting-started/install-and-first-policy.md) — install Neksur and ship a first policy in ~30 minutes.

## Planned guides

| Guide | Depends on |
|---|---|
| Integrate Spark with Neksur | Phase 2 (read-path SQL proxy) + Phase 3 (Spark engine connector) |
| Integrate Trino with Neksur | Phase 2 + Phase 4 (Trino engine connector) |
| Integrate Snowflake with Neksur | Phase 5 (Snowflake Horizon connector) |
| Integrate Dremio with Neksur | Phase 5 |
| Author a P1 schema policy (must-have columns) | Phase 1 ✓ — covered inline in [Getting Started](../getting-started/install-and-first-policy.md) |
| Author a P2 write-ACL policy (principal-based) | Phase 1 ✓ — pending standalone guide |
| Author a P3 retention policy | Phase 1 ✓ — pending standalone guide |
| Ship a compliance bundle (SOC 2 / HIPAA / PCI) | Phase 6 (compliance reporting) |
| Set up cross-tenant lineage queries | Phase 2 |

See the [roadmap](../../README.md#status) for phase status.

Have a guide you'd like to see prioritized? Open an issue.
