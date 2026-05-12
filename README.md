# Neksur Documentation

Public documentation for **Neksur — the Open Lakehouse Control Plane for Apache Iceberg**.

This repository builds and publishes [docs.neksur.com](https://docs.neksur.com).

## Status

**Pre-MVP / Discovery (as of 2026-05-12).** The documentation site is not yet published. This repository currently holds the scaffold. Content lands as Phase 0–7 of the Neksur roadmap completes; the site goes live in Phase 7 (Distribution, Licensing Infra & GTM Enablement).

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

*Documentation site scaffold initialized 2026-05-12. Site publication target: Phase 7 of Neksur roadmap.*
