<!-- generated-by: gsd-doc-writer -->

# Architecture Overview

## Overview

Neksur is a three-layer enforcement system for Apache Iceberg data lakehouses, backed by a tenant-scoped property graph. It places **policy at the point of mutation** — every commit to your Iceberg catalog passes through a write-path gateway that evaluates CEL policies before the upstream catalog ever sees the request, with a detection sweep behind it as a backstop. The three layers (**L1** write-path gateway, **L2** read-path SQL proxy, **L3** post-commit detection) are designed to be complementary rather than redundant; in the shipped Phase 0 + Phase 1 baseline you get L1 and a basic regex-driven L3. L2 lands in Phase 2.

This document is the operator's-eye map of the moving parts — read it before installing.

## The three coordinated enforcement layers

Neksur applies the same governance contract through three layers chosen to fail in different ways. Single-layer designs are brittle: a write-path filter can't see novel data shapes, a detector alone is always reactive, and a read-path proxy alone can't stop writes from ever landing. Defense in depth across the three layers is the design point.

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

### L2 — Read-Path SQL Proxy (planned — Phase 2)

L2 is cross-engine read-time policy enforcement: a SQL proxy that intercepts queries, applies row/column policy, and forwards to the underlying compute engine. **Not in Phase 0 + Phase 1.** Phase 2 ships it; the architectural slot exists so today's policy definitions stay portable across the read- and write-paths.

### L3 — Post-Commit Detection (shipped — Phase 1, regex baseline)

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

A column literally named `email` carrying integer rows does not alert; only the combination of suggestive name and matching values trips the threshold. ML-based classification is on the roadmap (Phase 6) — the graph emission shape (`Tag` + `Classification` + edges) is identical, so downstream consumers don't change.

Why three layers: write-time policy is fast, clean, and stops violations before they ever land — but it can't see novel data shapes the policy author didn't anticipate. Detection catches the rest, slightly after the fact, by sweeping the artefacts the gateway already let through. Phase 2's L2 read-path closes the third side: anything still in the lake that violates current policy is filtered at query time.

## The graph foundation (shipped — Phase 0 + 1)

Every catalog snapshot, column, lineage edge, policy, and audit event Neksur knows about lives as nodes and edges in an **Apache AGE graph on Postgres 16**.

- **Tenancy:** per-tenant Postgres schemas (`tenant_<uuid>`), with row-level security policies on every label table keyed on `current_setting('app.current_tenant')`. The pgxpool's `BeforeAcquire` hook runs `DISCARD ALL` on connection release, so tenant context can never bleed across requests.
- **Bounded traversals:** Cypher path queries are capped at 3 hops by default and **never exceed 5** (`*1..5`). Cycle pre-checks before lineage MERGEs walk up to 5 hops of ancestors; the bounded form is enforced at the query-template level, not just by convention.
- **Phase 1 graph inventory:** 23 vertex labels and 29 edge labels (Phase 0 baseline of 19 + 24 plus Phase 1's 4 + 5). See `migrations/graph/V0030__phase1_vlabels_elabels.sql` for the full list. The new Phase 1 labels include `Snapshot`, `Column`, `RetentionPolicy`, `Classification`, `LifecyclePolicy`, `ScheduledAction`, `HAS_COLUMN`, `SCHEMA_GOVERNS`, `WRITE_GOVERNS`, `RETAINS`, and `DETECTED_BY`.
- **AGE 1.6 quirks accepted:** AGE 1.6.0 does not implement `MERGE ... ON CREATE SET ... ON MATCH SET ...`. The codebase emulates these semantics via `WITH s SET s.x = COALESCE(s.x, $val)` patterns. Multi-`MERGE`-per-`cypher()`-call is also rejected, so multi-step writes dispatch as multiple `cypher()` invocations inside one transaction.

Per-snapshot natural keys are `metadata_location` (the S3 URL of the snapshot's `metadata.json`) — globally unique by Iceberg's own design, so MERGE-on-this-key is collision-free without coordination.

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

## What's NOT in Phase 0 + Phase 1 (roadmap)

The architecture is designed for the full enforcement surface; today's shipped baseline is the foundation. The following land in later phases — see [ROADMAP](../README.md) for milestone dates.

| Capability                                              | Phase   |
|---------------------------------------------------------|--------:|
| **L2 Read-Path SQL Proxy** — cross-engine query-time enforcement | Phase 2 |
| **Glue catalog adapter** — live integration              | Phase 3 |
| **Unity catalog adapter** — live integration             | Phase 3 |
| Spark write-path integration (native committer)         | Phase 3 |
| Trino engine connector                                   | Phase 4 |
| Snowflake engine connector                               | Phase 4 |
| Dremio engine connector                                  | Phase 5 |
| ML-based classification (replaces / augments regex L3)  | Phase 6 |
| Compliance reporting bundles (SOC 2, HIPAA, GDPR)       | Phase 6 |
| Public distribution (self-managed binaries, Helm chart) | Phase 7 |

If you're evaluating Neksur today, target a workload where **L1 write-path policy on Polaris or Nessie** is the centerpiece, with detection-driven Slack alerts as the safety net. Read-path enforcement (L2) and the additional catalog adapters arrive on the schedule above.

## Where to next

- [Getting Started](../getting-started/install-and-first-policy.md) — install Neksur, configure a Polaris or Nessie catalog, write your first policy.
- [REST API Reference](../reference/rest-api.md) — full endpoint surface, request/response shapes, status codes.
- [Concepts: Write-Path Enforcement](../concepts/README.md) — how policies are evaluated, fail-closed semantics, audit trail shape.
- [Deployment](../operations/deploy.md) — production deployment, observability, scaling considerations.
