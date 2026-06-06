# Editions and tiers

Neksur ships as a **single binary**. What it can do is determined by a **signed license file** that gates feature flags at startup. There is no separate "enterprise build" to install — the same artifact runs Core or any commercial tier depending on the license it verifies.

## The four additive tiers

Tiers are **additive**: each includes everything below it. A customer picks the rung that matches their auditors' requirements.

| Tier | License | Adds on top of the tier below |
|------|---------|-------------------------------|
| **Core** | BSL 1.1 → Apache 2.0 (2030-05-10) | Catalog-level enforcement (the Iceberg gateway), the CEL policy engine, the metadata graph, lineage, the semantic layer, the contract lifecycle, basic (regex) detection, and the REST / GraphQL / MCP / SQL-proxy surfaces. |
| **Multi-Engine** | Commercial | Identical Access enforcement across Spark + Trino + ≥1 of Snowflake / Dremio / Flink, plus **continuous cross-engine consistency verification** (the Contract is checked to hold the same way on every engine). |
| **Defense-in-Depth** | Commercial | **Writer-side pre-write transforms** (Spark Catalyst extension / SDK), **continuous compliance scanning**, and **compute-isolation credential vending**. |
| **Intelligence** | Commercial | **ML-based classification**, **anomaly detection**, semantic-anomaly detection over Contracts, and **AI-agent observability**. |

The buyer logic: *Core* is "try the model on one catalog"; *Multi-Engine* is "production is multi-engine and the Contract must hold everywhere"; *Defense-in-Depth* is "auditors require depth on the write path"; *Intelligence* is "we want proactive detection, not just enforcement."

## How the repositories map

The single binary is built from a public Core repo plus private commercial modules. Commercial code is compiled in behind build tags and gated at runtime by the license.

| Repository | Visibility | License | Role |
|------------|-----------|---------|------|
| [`neksur-com/neksur`](https://github.com/neksur-com/neksur) | public | BSL 1.1 → Apache 2.0 | **Neksur Core** — all Core-tier functionality; the substrate every tier builds on. |
| `neksur-com/neksur-commercial` | private | Neksur Commercial | Multi-Engine + Defense-in-Depth coordination: schema-cache invalidation broadcaster, write-conflict coordinator, cross-engine consistency verifier. |
| `neksur-com/neksur-enterprise` | private | Neksur Enterprise | Enterprise multi-engine coordination: partition-spec evolution tracking, multi-engine compaction coordination, snapshot-pin retention. Builds on the commercial module. |
| `neksur-com/neksur-spark-policy` | public | BSL 1.1 → Apache 2.0 | The Spark writer-side enforcement library (Catalyst extension + SDK) for the Defense-in-Depth write path. |
| `neksur-com/neksur-infra` | private | proprietary | Terraform for the AWS deployment (VPC, Postgres-on-EC2 HA, observability, mTLS, customer peering). |
| `neksur-com/docs` | public | Apache 2.0 | This documentation. |

## The one-way ratchet

The BSL / Commercial boundary moves in **one direction only**: a component may graduate from Commercial into BSL Core, never the reverse. This guarantees the open Core only ever grows, and that the BSL change-date (2030-05-10, after which Core becomes Apache 2.0) applies to a strictly expanding surface. The change date applies **only to the public Core repository**; commercial modules remain closed-source unless an explicit decision ratchets a component into Core.

## Feature gates in practice

Commercial capabilities use **license gates** that no-op cleanly when the feature is not licensed — a Core deployment simply doesn't construct the commercial coordinators. Running a higher tier is a license change, not a redeploy of a different binary.

## See also

- [Licensing](../licensing/README.md) — the BSL, what "non-competing use" means, and commercial inquiries.
- [Enforcement model](./enforcement.md) — where each tier's capabilities act in the data path.
- [What is Neksur?](../intro/what-is-neksur.md)
