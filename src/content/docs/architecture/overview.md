---
title: "Architecture Overview"
description: "Neksur is the Data Contract Plane for Apache Iceberg lakehouses: it governs each dataset through a single Data Contract — binding Meaning, Access, and…"
---

## Overview

Neksur is the **Data Contract Plane** for Apache Iceberg lakehouses: it governs each dataset through a single [Data Contract](/concepts/data-contract/) — binding [Meaning, Access, and State](/concepts/dimensions/) — and enforces that Contract at **several coordinated points** in the data path, backed by a tenant-scoped property graph. It places **policy at the point of mutation** — every commit passes through a write-path gateway that evaluates CEL policies before the upstream catalog sees the request — *and* at the point of consumption — a read-path SQL proxy that compiles the same Access policy into query traffic — with a detection sweep behind both as a backstop.

The enforcement points (catalog gateway, read-path SQL proxy, writer-side Spark transform, credential vending, post-commit detection) are complementary rather than redundant. The Contract that they all enforce is the **authoritative root** of the metadata graph — see [The Data Contract as authoritative root](#the-data-contract-as-authoritative-root-adr-017) below. This document is the operator's-eye map of the moving parts — read it before installing. The [Enforcement model](/concepts/enforcement/) concept page explains *why* the design is multi-point; this page covers *how* it is wired.

> **Heritage note.** Earlier revisions of this document described an "L1 / L2 / L3" three-layer model where L2 was a *planned* read-path proxy. That naming collided with the write-path defense levels in ADR-003 and is no longer used in user-facing material; the read path is now part of Core. This page keeps the detailed L1-gateway and detection sections (they remain accurate) and describes the read path and the other points by name.

## The coordinated enforcement points

Neksur enforces one Data Contract through several points chosen to fail in different ways. Single-point designs are brittle: a write-path filter can't see novel data shapes, a detector alone is always reactive, and a read-path proxy alone can't stop writes from ever landing. Defense in depth across the points is the design point. The two sections below — the **write-path catalog gateway** and **post-commit detection** — document the commit and backstop paths in depth; the **read-path SQL proxy**, **writer-side transform**, and **credential vending** are summarized under [Read path, writer-side, and credential vending](#read-path-writer-side-and-credential-vending).

### L1 — Write-Path Catalog Gateway (shipped — Phase 1)

The L1 gateway is an HTTP proxy that sits in front of an upstream Iceberg REST catalog (Polaris, Nessie, and — once Phase 3 lights them up — Glue and Unity). Every `CommitTable` request is intercepted, policy-evaluated, and either forwarded to the upstream catalog or rejected with `403 Forbidden`. The gateway lives at:

```
POST /v1/iceberg/{prefix}/namespaces/{namespace}/tables/{table}
POST /v1/iceberg/{prefix}/transactions/commit
```

(See `cmd/neksur-server/main.go` route mounting; the handler is in `internal/gateway/iceberg/handler.go`.)

The per-commit pipeline is **fourteen steps**:

1. Tenant context assertion (defense-in-depth — the WorkOS tenant middleware is the wire-layer gate).
2. Path identifier validation — `{prefix}` / `{namespace}` / `{table}` are constrained to `^[a-zA-Z0-9_-]+$` to block Cypher / SQL / URL-traversal injection precursors.
3. Principal extraction from the request (OIDC `sub`, email, roles).
4. Body read with a **16 MiB cap** (`http.MaxBytesReader`) and SHA-256 hash of the body for replay detection.
5. JSON unmarshal into the typed `CommitRequest` shape.
6. Per-tenant catalog credentials fetch (RLS-scoped — the row is in the calling tenant's schema only).
7. Adapter construction — dispatches to the Polaris / Nessie / Glue-stub / Unity-stub adapter based on the catalog kind in the credentials row.
8. Load the table's current metadata from the upstream catalog (`adapter.LoadTable`).
9. **Policy fetch** — load all policies governing the table from the AGE graph. *This is fail-closed:* any error returns `503 Service Unavailable` and increments `commit_rejected_total{reason="policy_engine_unavailable"}`. No silent pass.
10. **Policy evaluation** — every policy is run through the CEL evaluator. First Deny rejects the commit with `403`, the rejection is recorded to the audit graph (`WriteEvent` + `INTENDED_WRITE`), and `commit_rejected_total{reason="policy_denied"}` increments. Eval failures (compile error, non-bool return, panic) are also fail-closed → `503`.
11. Forward to the upstream catalog via `adapter.CommitTable`.
12. Emit an `APPROVED` `WriteEvent` to the audit graph (also creates `ACTUAL_WRITE` and `INTENDED_WRITE` edges).
13. Ingest the new snapshot into the graph (best-effort — upstream commit is already accepted, so a graph-ingest failure is logged but does not roll back).
14. Echo the upstream response back to the client.

The full pipeline runs inside the request goroutine; there is no async hop between policy decision and upstream forward. HTTP status conventions:

| Code | Meaning |
|------|---------|
| 200  | Success; body is the upstream catalog's commit response |
| 400  | Malformed path identifier or commit body |
| 401  | Principal missing or upstream credentials expired |
| 403  | Policy denied — `WriteEvent` rejection has been recorded |
| 404  | Catalog credentials not configured, or upstream table not found |
| 409  | Upstream commit conflict (caller must reload + retry) |
| 502  | Upstream catalog forward failure |
| 503  | Policy engine unavailable (fail-closed) |

### Read path, writer-side, and credential vending

Three further enforcement points complete the surface. They share the Contract's Access definition with the gateway, so a policy authored once applies on read, on write, and pre-write.

**Read-path SQL proxy.** Cross-engine read-time enforcement: a SQL proxy (`internal/sqlproxy`) intercepts queries, compiles the Contract's row filters and column masks into the query, and forwards to the underlying compute engine through an engine dispatcher (`internal/engines`, with a Trino dialect today). It is fail-closed and emits per-query usage records. BI tools that don't speak the proxy's native protocol connect through two wire-protocol transports:

- **`pgwire`** (`internal/pgwire`) — a PostgreSQL libpq v3 wire server, so any Postgres-compatible BI client or driver connects directly and gets policy-compiled results.
- **XMLA** (`internal/xmla`) — the SOAP-over-HTTP Analysis Services protocol, so Excel and Power BI open Neksur as an OLAP connection.

Both transports run the same listener → auth → tenant-resolve → dispatch pipeline and apply the same Access compilation.

**Writer-side transform (Spark).** For Spark, an optional pre-write layer applies column masking, encryption, redaction, and tokenization *before* bytes land in object storage. It ships as a separate library ([`neksur-com/neksur-spark-policy`](https://github.com/neksur-com/neksur-spark-policy)) with two byte-identical frontends — a Catalyst optimizer extension (silent) and an explicit SDK (`writeWithNeksur`) — proven equivalent by a CI parity gate. This is a Defense-in-Depth edition capability; see [Editions and tiers](/concepts/editions/).

**Credential vending.** A vending boundary (`internal/credvend`) issues short-lived, scoped storage credentials so an engine cannot reach data outside the Contract's bounds, with a quarantine path for revoked sessions. Also a Defense-in-Depth capability.

### Post-Commit Detection (regex baseline in Core; ML in the Intelligence edition)

L3 is a backstop that scans newly-committed snapshots for content the write-path policies couldn't anticipate — novel column names, unexpected PII shapes — and alerts. It runs as an **in-process goroutine pool** (default 4 workers; tune via `NEKSUR_L3_WORKERS`) consuming `Hit` events from three trigger sources:

1. **30-second baseline poller** — walks the Iceberg metadata table for every tenant on a fixed interval and emits `Hit{}` for any snapshot whose `metadata_location` hasn't been scanned.
2. **Polaris webhook** — `POST /v1/webhooks/polaris`, HMAC-verified per-tenant. Mounted **outside** the tenant middleware because HMAC signature verification *is* the auth check.
3. **S3 `ObjectCreated` events** — optional, via SNS → SQS; off unless `NEKSUR_S3_EVENTS_QUEUE_URL` is set. Useful for catching writes that bypass the gateway entirely (direct file rewrites).

All three sources push onto one channel; the pool dedups in-process by `metadata_location` (via a `sync.Map`), and a `UNIQUE` constraint on `detection_runs.snapshot_metadata_location` catches cross-replica races.

The Phase 1 classifier is **regex-based** (`internal/detect/regex/classifier.go`), with five built-in patterns: US SSN, email, credit card, phone, IBAN. Confidence scoring is the load-bearing false-positive mitigation:

| Match shape                    | Confidence | Alert? |
|---------------------------------|-----------:|:------:|
| Column-name match only          | 0.65       | no     |
| Cell-value pattern match only   | 0.55       | no     |
| Column-name **and** value match | 0.92       | **yes** (Slack) |

A column literally named `email` carrying integer rows does not alert; only the combination of suggestive name and matching values trips the threshold. **ML-based classification** is an Intelligence-edition capability, with a training-data curation workflow (encrypted store, scan/pre-label, review/edit, export-for-training, DPO/admin gating) in the AI/ML track — the graph emission shape (`Tag` + `Classification` + edges) is identical, so downstream consumers don't change when the classifier is swapped.

Why multiple points: write-time policy is fast, clean, and stops violations before they ever land — but it can't see novel data shapes the policy author didn't anticipate. Detection catches the rest, slightly after the fact, by sweeping the artefacts the gateway already let through. The read-path proxy closes the third side: anything still in the lake that violates current policy is filtered at query time.

## The graph foundation (shipped — Phase 0 + 1)

Every catalog snapshot, column, lineage edge, policy, and audit event Neksur knows about lives as nodes and edges in an **Apache AGE graph on Postgres 16**.

- **Tenancy:** per-tenant Postgres schemas (`tenant_<uuid>`), with row-level security policies on every label table keyed on `current_setting('app.current_tenant')`. The pgxpool's `BeforeAcquire` hook runs `DISCARD ALL` on connection release, so tenant context can never bleed across requests.
- **Bounded traversals:** Cypher path queries are capped at 3 hops by default and **never exceed 5** (`*1..5`). Cycle pre-checks before lineage MERGEs walk up to 5 hops of ancestors; the bounded form is enforced at the query-template level, not just by convention.
- **Phase 1 graph inventory:** 23 vertex labels and 29 edge labels (Phase 0 baseline of 19 + 24 plus Phase 1's 4 + 5). See `migrations/graph/V0030__phase1_vlabels_elabels.sql` for the full list. The new Phase 1 labels include `Snapshot`, `Column`, `RetentionPolicy`, `Classification`, `LifecyclePolicy`, `ScheduledAction`, `HAS_COLUMN`, `SCHEMA_GOVERNS`, `WRITE_GOVERNS`, `RETAINS`, and `DETECTED_BY`.
- **AGE 1.6 quirks accepted:** AGE 1.6.0 does not implement `MERGE ... ON CREATE SET ... ON MATCH SET ...`. The codebase emulates these semantics via `WITH s SET s.x = COALESCE(s.x, $val)` patterns. Multi-`MERGE`-per-`cypher()`-call is also rejected, so multi-step writes dispatch as multiple `cypher()` invocations inside one transaction.

Per-snapshot natural keys are `metadata_location` (the S3 URL of the snapshot's `metadata.json`) — globally unique by Iceberg's own design, so MERGE-on-this-key is collision-free without coordination.

## The Data Contract as authoritative root (ADR-017)

Above the raw graph, a single [Data Contract](/concepts/data-contract/) is the **authoritative root** of everything Neksur knows about a dataset. Its three dimensions — [Meaning, Access, and State](/concepts/dimensions/) — and every attestation about the dataset hang off that one root. The graph holds the Contract and the edges that connect it to its dimensions, and **those edges are the source of truth**.

- **Authoring is graph-first.** A Contract's dimensions are written into the tenant-scoped graph inside one transaction, which also appends a durable outbox record. An async projector idempotently upserts the relational tables that serve the fast read path, and an hourly reconciliation sweep raises any graph⇄projection drift as a breach. This is a CQRS shape: the hot read path stays a fast relational read (not a live traversal), but it is *reconciled* against the authoritative graph rather than independently authored.
- **Meaning is grounded.** Metrics connect to a glossary ontology (`MEANS` → `GlossaryTerm`, one definition per concept) and to the physical columns they are computed over (`COMPUTED_OVER`).
- **Access is tag-scoped.** A column is classified once with a `Tag`; policy written against the tag compiles to per-table artifacts wherever the tag appears — *classify once, govern everywhere*. A metric inherits the sensitivity of its columns by default; declassification requires an explicit governance-steward attestation (a trust fact), never an automatic rule — and exact numbers are preserved.
- **A durable pinned snapshot anchors attestation.** The agreed Iceberg snapshot is recorded as an event-sourced, append-only `PinEvent` stream (the current pin is a projection of the latest event), so quality, reconciliation, and compliance evidence anchor as-of *this* version of the data rather than "whatever is latest."
- **The lifecycle gates promotion.** The `deploy → active` transition runs DQ checks plus cross-engine reconciliation against the pinned snapshot; posture is block + breach + escalate-breaking — a verified non-breaking change auto-advances, a breaking schema change escalates to human sign-off.

See [The unified contract model](/concepts/unified-contract-model/) for the full treatment.

## Catalog adapter model (shipped — Phase 1)

Neksur talks to every Iceberg catalog through one **6-method interface**: `IcebergCatalogClient` (defined in `internal/iceberg/client.go`).

```go
type IcebergCatalogClient interface {
    ListTables(ctx, namespace string) ([]TableRef, error)
    GetTable(ctx, ref TableRef)  (*TableMetadata, error)
    LoadTable(ctx, ref TableRef) (*TableMetadata, error)
    CommitTable(ctx, ref, CommitRequest) (*CommitResult, error)
    ExpireSnapshots(ctx, ref, olderThan time.Time) error
    Capabilities() Capabilities
}
```

Every concrete adapter satisfies this surface. The shipped adapters today:

| Adapter        | Status              | Branches | Cred-vend (STS) | Webhooks | Max NS depth |
|----------------|---------------------|---------:|----------------:|---------:|-------------:|
| **Polaris**    | live (tested live)  | no       | yes             | yes      | 100          |
| **Nessie**     | live (tested live)  | **yes**  | no              | no       | 1            |
| **Glue**       | stub — Phase 3      | —        | —               | —        | —            |
| **Unity**      | stub — Phase 3      | —        | —               | —        | —            |

Both live adapters wrap the Apache `iceberg-go` REST catalog client and translate iceberg-go's lower-level types into Neksur's shared shapes. Errors translate to four sentinels (`ErrTableNotFound`, `ErrCommitConflict`, `ErrCredentialsExpired`, `ErrAdapterStub`) so the gateway can map them uniformly to HTTP status codes regardless of which catalog is behind the adapter.

The Glue and Unity adapters are **stub adapters that satisfy the interface at compile time** — every state-mutating method returns `ErrAdapterStub`. Live integrations land in Phase 3. A startup sanity check rejects catalog configurations whose `catalog_kind` is `glue` or `unity` if the deployment is on Phase 1.

The `Capabilities()` escape hatch publishes per-catalog static facts (branches? credential vending? webhook events?) so the gateway and the L3 scheduler can branch on quirks without each adding per-catalog conditionals.

New catalogs plug in by:

1. Adding a sub-package under `internal/iceberg/` with a `Config` struct and a `New(ctx, cfg) (IcebergCatalogClient, error)` constructor.
2. Adding a `catalog_kind` discriminator to the `BuildAdapter` dispatch.

No graph schema change is required.

## Policy engine (shipped — Phase 1)

Policies are written in **CEL** (Common Expression Language — `github.com/google/cel-go`). Each policy is a single boolean expression evaluated against three input bindings:

- `table` — the post-load `TableMetadata` projection (schema, partition spec, current snapshot, properties).
- `commit` — the incoming `CommitRequest` (requirements + updates).
- `principal` — the OIDC principal (`sub`, `email`, `roles`).

Three policy kinds ship in Phase 1:

| Kind         | Code | Graph shape                                    | Typical use                              |
|--------------|:----:|-----------------------------------------------|------------------------------------------|
| Schema       | P1   | `Policy-[:SCHEMA_GOVERNS]->Table`             | Required columns ("must include `tenant_id`") |
| Write ACL    | P2   | `Policy-[:WRITE_GOVERNS]->Table`              | Principal-based allow ("only `data-eng` role may write") |
| Retention    | P3   | `RetentionPolicy-[:RETAINS]->Table`           | Minimum retention period before snapshot expiry |

The evaluator (`internal/policy/cel/eval.go`) is **fail-closed on every error path**. Compile failure, eval failure, non-bool return, panic — all four produce a non-nil error that the gateway translates to `503 Service Unavailable`. A buggy CEL binding cannot crash the gateway process: a `defer/recover` catches panics and reports them as `ErrEvalPanic`.

Policies are loaded fresh from AGE on every commit (via `internal/policy/store/age.go`). The compiler caches compiled programs by `(policy_id, policy_text)`, so re-evaluating the same policy text is cheap; the load path is a thin `MATCH` query per request.

## Lineage (shipped — Phase 1)

OpenLineage v2 run events land at `POST /v1/lineage`, behind the tenant middleware. The pipeline (`internal/lineage/http/handler.go`):

1. Method gate + tenant assertion + body cap (**1 MiB**).
2. JSON decode + required-field validation.
3. **Durability first:** the raw event is `INSERT`ed into the per-tenant `lineage_inbox` table with `ON CONFLICT (producer, run_id) DO NOTHING`. Spark's OpenLineage HTTP transport retries on transient failures; the unique constraint absorbs duplicates so the downstream MERGE worker never double-processes.
4. Inputs/outputs are translated to `LINEAGE_OF` edge MERGEs through the ingest service.
5. **Cycle prevention:** before every `LINEAGE_OF` MERGE, a Postgres advisory lock keyed on `hashtext(srcURI)` is acquired (`pg_advisory_xact_lock` — auto-released at transaction end) and a bounded `[:LINEAGE_OF*1..5]` traversal checks whether the proposed edge would close a cycle. Concurrent cycle-introducing writes on the same source serialize through the lock; cycle detection is exact for chains ≤ 5 hops, and a periodic sweep catches longer chains.
6. On `*LineageCycleError` → `422 Unprocessable Entity`; on other errors → `503`; success → `202 Accepted`.

The at-least-once durability + cycle prevention together give you replay-safe lineage ingestion even when the producer is a chatty Spark cluster on a flaky network.

## Component diagram

```
                        ┌──────────────────┐
                        │  Iceberg client  │   (Spark / Trino / your code)
                        │ (e.g., pyiceberg)│
                        └────────┬─────────┘
                                 │   POST /v1/iceberg/.../commit
                                 │   Bearer <OIDC token>
                                 ▼
            ┌─────────────────────────────────────┐
            │      WorkOS Tenant Middleware       │   resolves tenant_id,
            │   (sets app.current_tenant GUC)     │   sets Postgres RLS scope
            └────────────────┬────────────────────┘
                             │
                             ▼
            ┌─────────────────────────────────────┐
            │    L1 Catalog Gateway (Phase 1)     │
            │   14-step pipeline (handler.go)     │
            └─┬──────┬──────────────────┬─────────┘
              │      │                  │
   policy fetch│      │ load metadata    │ forward commit
              ▼      ▼                  ▼
    ┌──────────────┐ ┌──────────────┐  ┌──────────────────┐
    │ Policy Store │ │  Adapter     │  │ Upstream Catalog │
    │  (AGE graph) │ │ (Polaris /   │──▶ (Polaris /       │
    │              │ │  Nessie)     │  │  Nessie / ...)   │
    └──────┬───────┘ └──────┬───────┘  └──────────────────┘
           │                │
           ▼                ▼
    ┌──────────────┐ ┌─────────────────────────────────┐
    │ CEL Evaluator│ │   Ingest Service (post-commit)  │
    │ (fail-closed)│ │   merges Snapshot/Column/edges  │
    └──────┬───────┘ └────────────────┬────────────────┘
           │                          │
           └──────────┬───────────────┘
                      ▼
            ┌─────────────────────────────┐
            │  Audit Graph (per-tenant)   │
            │  WriteEvent + INTENDED_WRITE│
            │  + ACTUAL_WRITE + audit_log │
            └─────────────────────────────┘

                ▲                          ▲
                │                          │
       POST /v1/lineage         L3 Detection Pool
       (OpenLineage v2)         (poller / webhook /
                                 S3 events) → Slack
```

Audit emission and the relational `audit_log` row land in the **same transaction** as the graph MERGEs — a half-emitted audit trail is not a state the system can be in.

## How the dimensions map to components

The three Contract dimensions are not separate subsystems — they are realized by the same graph + enforcement machinery, projected differently:

| Dimension | Realized by |
|-----------|-------------|
| **Meaning** | Semantic layer (`internal/semantic`: AST + per-engine compilation), metric store, OSI import/export, the `pgwire`/XMLA read transports. |
| **Access** | CEL policy engine (`internal/policy`), the catalog gateway (write), the read-path SQL proxy + dispatcher (read), the writer-side Spark transform (pre-write), credential vending. |
| **State** | Snapshot pinning + schema/retention policy at the gateway (Core); cross-engine coordination — schema-cache invalidation, write-conflict resolution, partition-spec evolution, compaction coordination — in the Commercial / Enterprise modules. |

## API surface

Neksur exposes the governed graph and the Contract through several protocols, all tenant-scoped and Access-enforced:

| Surface | Path / transport | Purpose |
|---------|------------------|---------|
| **REST** | `/v1/*` (`internal/api/rest`) | Iceberg gateway, lineage, contracts/lifecycle, semantic/metrics, detection, compliance, FinOps, admin. See the [REST API reference](/reference/rest-api/). |
| **GraphQL** | `internal/api/graphql` | Schema-first query surface mirroring the REST resources for graph/contract queries. |
| **MCP** | `internal/api/mcp` | Model Context Protocol server for AI agents. The generic `graph.traverse` tool (with preset recipes: `ai_agent_context`, `impact_analysis`, `pii_propagation`, `explain_a_number`) runs under the same **row-filter + column-mask push-down** as human read traffic, with a clause whitelist and bounded traversal depth. |
| **SQL proxy** | `internal/sqlproxy` + `pgwire` + `xmla` | Read-path query enforcement and BI connectivity (see above). |

## Editions and the single binary

Neksur is one binary whose capabilities are gated by a signed license verified at startup. Commercial code is compiled in behind build tags (`commercial`, `commercial enterprise`) and constructed only when the license allows:

- **Core** (BSL) — everything documented in the sections above.
- **Commercial module** ([`neksur-com/neksur-commercial`](https://github.com/neksur-com/neksur-commercial)) — cross-engine coordination: schema-cache invalidation broadcaster, write-conflict coordinator, cross-engine consistency verifier.
- **Enterprise module** ([`neksur-com/neksur-enterprise`](https://github.com/neksur-com/neksur-enterprise)) — partition-spec evolution tracking, multi-engine compaction coordination, snapshot-pin retention. Depends on the commercial module.

Commercial modules avoid importing Core `internal/` packages; the server wires them in via narrow interfaces and a shared connection pool. See [Editions and tiers](/concepts/editions/).

## Architecture decision records

The architecture is governed by a set of ADRs (published copies land in this section over time):

| ADR | Title |
|-----|-------|
| **ADR-001** | Graph foundation — Apache AGE on Postgres; node/edge label canon; bounded traversal. |
| **ADR-002** | Licensing — BSL 1.1 Core + commercial modules; one-way ratchet; single binary + feature flags. |
| **ADR-003** | Write-path policy enforcement — defense-in-depth points (pre-commit, writer-side, post-commit, credential vending); policy categories. |
| **ADR-004** | SaaS deployment — pooled multi-tenancy (schema-per-tenant + dedicated), connection isolation, AWS + customer VPC peering. |
| **ADR-005** | MCP Cypher hardening — parameterized queries only, clause whitelist, per-query budgets, tenant RLS. |
| **ADR-011** | Product concept & terminology — the Data Contract Plane; Meaning/Access/State; one lifecycle; Define/Enforce/Prove; the four additive tiers. |
| **ADR-017** | The unified contract model — `DataContract` as the authoritative root; graph-first authoring + reconciled projection (CQRS); grounded Meaning; tag-scoped Access + steward-attested declassification; durable pinned snapshot; the `deploy → active` lifecycle gate. See [The unified contract model](/concepts/unified-contract-model/). |

## Catalog adapters and the roadmap

The architecture is designed for the full multi-engine surface. Adapter / engine coverage is staged:

| Capability | Status |
|------------|--------|
| **Polaris / Nessie** catalog adapters | live in Core |
| **Glue / Unity** catalog adapters | adapter slots present; live integration on the multi-engine track |
| **Trino** read-path engine | live (engine dispatcher dialect) |
| **Snowflake / Dremio / Flink** engines | Multi-Engine edition coordination track |
| **Spark writer-side transform** | [`neksur-spark-policy`](https://github.com/neksur-com/neksur-spark-policy) (Defense-in-Depth) |
| **ML classification** | Intelligence edition |
| **Compliance bundles** (SOC 2 / HIPAA / GDPR) | compliance + audit-chain foundation in Core; reporting bundles on the compliance track |

If you're evaluating Neksur today, the highest-leverage starting point remains **write-path Access policy on Polaris or Nessie**, with the read-path proxy enforcing the same policy on Trino and detection as the backstop.

## Where to next

- [Getting Started](/getting-started/install-and-first-contract/) — install Neksur, configure a Polaris or Nessie catalog, write your first policy.
- [REST API Reference](/reference/rest-api/) — full endpoint surface, request/response shapes, status codes.
- [Concepts: Write-Path Enforcement](/concepts/) — how policies are evaluated, fail-closed semantics, audit trail shape.
- [Deployment](/operations/deploy/) — production deployment, observability, scaling considerations.
