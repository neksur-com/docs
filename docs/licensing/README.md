# Licensing

How Neksur is licensed, what each license permits, and how the components fit together.

## Status

This section is **scaffolded but not yet populated** in detail. The high-level facts are summarized below; a full FAQ and tier comparison land in Phase 7 (Distribution, Licensing Infra & GTM Enablement).

## License summary

| Component | Repository | License | Notes |
|---|---|---|---|
| **Neksur Core** (source code) | [`neksur-com/neksur`](https://github.com/neksur-com/neksur) | Business Source License 1.1 → Apache 2.0 (2030-05-10) | The BSL grant permits use for non-competing production workloads; full source readable today; converts to Apache 2.0 on the change date. |
| **Documentation** (this repo) | [`neksur-com/docs`](https://github.com/neksur-com/docs) | Apache License 2.0 | Permissive — read, copy, modify, redistribute (commercial OK) as long as the notice is preserved. |
| **Neksur Premium** | `neksur-com/neksur-premium` (private) | Neksur Commercial License | Commercial components shipped to paying customers; not in the public BSL repo. |

## What's in the BSL repo today

Phase 0 (graph foundation) + Phase 1 (Iceberg catalog adapters, L1 Catalog Gateway, CEL policy engine, lineage ingestion, basic L3 detection) — all live on `main` in [`neksur-com/neksur`](https://github.com/neksur-com/neksur) under BSL 1.1.

## Planned content

- **BSL FAQ** — what "non-competing use" means, common scenarios (consulting, hosted services, internal deployments, embedded use), the change-date mechanics
- **Commercial tiers** — what's in Neksur Premium, how pricing is structured, when each tier makes sense
- **Design partner program** — early-access terms, what design partners get and give
- **Trademark policy** — using the Neksur name and marks

## Contact

- General licensing questions: `hello@neksur.com`
- Commercial / Premium inquiries: `hello@neksur.com`
