# Concepts

In-depth conceptual explanations of Neksur's core ideas — what an "open lakehouse," "write-path enforcement," "policy-as-code," or "lineage graph" actually means in Neksur terms, and why each design choice was made.

## Status

This section is **scaffolded but not yet populated**. The early Neksur work has focused on shipping working code first (Phases 0–1) and operator-facing docs second (this repository). Conceptual deep-dives will land as the product surface grows beyond the write-path foundation.

Until then, the relevant concept material is interleaved into:

- [What is Neksur?](../intro/what-is-neksur.md) — the layered enforcement model (L1 / L2 / L3) at a high level
- [Architecture Overview](../architecture/overview.md) — how the pieces fit together in code
- [Getting Started](../getting-started/install-and-first-policy.md) — what a policy *is* in practice, by example

## Planned topics

- **Open lakehouse, defined** — what counts as "open," what doesn't, why the distinction matters
- **Write-path enforcement** — the case for catching policy violations at commit time, not after
- **Multi-engine policy** — one expression, enforced across Spark / Trino / Snowflake / Dremio (planned Phase 2+)
- **The lineage graph** — Iceberg metadata + OpenLineage as graph data, why a graph, what queries open up
- **Detection as backstop, not primary control** — the L3 layer's role and limits

Have a concept you'd like documented? Open an issue.
