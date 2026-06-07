---
title: "Licensing"
description: "How Neksur is licensed, what each license permits, and how the editions fit together."
---

How Neksur is licensed, what each license permits, and how the editions fit together.

For the product-side view of editions (what each tier *does*), see [Concepts: Editions and tiers](/concepts/editions/). This page covers the legal/licensing facts.

## The model in one sentence

Neksur ships as a **single binary** built from an open **Core** (Business Source License 1.1, converting to Apache 2.0 on 2030-05-10) plus private **commercial modules**, with capabilities unlocked at runtime by a **signed license file**.

## License summary

| Component | Repository | License | Notes |
|-----------|------------|---------|-------|
| **Neksur Core** | [`neksur-com/neksur`](https://github.com/neksur-com/neksur) | BSL 1.1 → Apache 2.0 (2030-05-10) | Full source readable today. The BSL grant permits use for non-competing production workloads; converts to Apache 2.0 on the change date. |
| **Spark policy library** | `neksur-com/neksur-spark-policy` | BSL 1.1 → Apache 2.0 (2030-05-10) | The Defense-in-Depth writer-side enforcement library for Spark. |
| **Commercial module** | `neksur-com/neksur-commercial` (private) | Neksur Commercial License | Multi-Engine + Defense-in-Depth coordination. Source-available to licensed customers; not in the public BSL repo. |
| **Enterprise module** | `neksur-com/neksur-enterprise` (private) | Neksur Enterprise License | Enterprise multi-engine coordination. Requires a commercial license underneath it. |
| **Documentation** | [`neksur-com/docs`](https://github.com/neksur-com/docs) (this repo) | Apache 2.0 | Permissive — read, copy, modify, redistribute (commercial OK) as long as the notice is preserved. |

## The four product tiers

The tiers are **additive** — each includes everything below it. Only **Core** is BSL; the three commercial tiers are unlocked by license.

| Tier | License | Capability summary |
|------|---------|--------------------|
| **Core** | 🟢 BSL | Catalog-level enforcement, CEL policy engine, metadata graph, lineage, semantic layer, contract lifecycle, regex detection, REST/GraphQL/MCP/SQL-proxy. |
| **Multi-Engine** | 🔵 Commercial | Identical enforcement across Spark + Trino + ≥1 of Snowflake/Dremio/Flink, plus continuous cross-engine verification. |
| **Defense-in-Depth** | 🔵 Commercial | Writer-side pre-write transforms, continuous compliance scanning, compute-isolation credential vending. |
| **Intelligence** | 🔵 Commercial | ML classification, anomaly detection, AI-agent observability. |

See [Editions and tiers](/concepts/editions/) for what each tier contains in detail.

## The Business Source License (BSL 1.1)

The BSL is **source-available**, not open-source — until the change date, when it becomes fully open under Apache 2.0.

- **You can** read all of the Core source today, run it in production for your own non-competing workloads, modify it, and self-host it.
- **You cannot** offer Neksur Core itself as a competing hosted/managed service (the Additional Use Grant blocks hyperscaler-style hosting of the product).
- **Change date: 2030-05-10.** On that date, the then-current Core converts to Apache 2.0. Because of the [one-way ratchet](/concepts/editions/#the-one-way-ratchet), the Core that converts is a strictly *growing* surface — components only ever move from Commercial into Core, never out.

The change date applies **only** to the public `neksur-com/neksur` (and `neksur-spark-policy`) repositories. Commercial and Enterprise modules stay closed unless an explicit decision ratchets a component into Core.

## The signed license file

Commercial tiers are unlocked by a **signed license file** that the binary verifies at startup, gating feature flags. There is no separate enterprise build — the same artifact runs Core or any commercial tier depending on the license it loads. Air-gapped deployments use an offline signed license; no license server callout is required.

## Planned content

- **BSL FAQ** — worked examples of "non-competing use" (consulting, internal deployments, embedded use, hosted services), and change-date mechanics.
- **Commercial tier pricing** — how each tier is priced and when each makes sense.
- **Design partner program** — early-access terms.
- **Trademark policy** — using the Neksur name and marks.

## Contact

- General licensing questions: `hello@neksur.com`
- Commercial / Enterprise inquiries: `hello@neksur.com`
