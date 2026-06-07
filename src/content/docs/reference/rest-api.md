---
title: "REST API Reference"
description: "This page documents the Iceberg gateway, lineage, and webhook endpoints in detail — the commit data path, which is the surface most integrations write…"
---

## Overview

This page documents the **Iceberg gateway, lineage, and webhook** endpoints in detail — the commit data path, which is the surface most integrations write against. These are the parts whose request/response contracts and fail-closed semantics operators most need to get exactly right.

> **The full API is larger than this page.** Neksur Core also exposes REST resources for contracts and the lifecycle, the semantic layer and metrics, detection, compliance, and FinOps, plus a **GraphQL** surface, an **MCP** server for AI agents, and the **SQL-proxy / `pgwire` / XMLA** read path. See [Architecture → API surface](/architecture/overview/#api-surface) for the map, and `internal/api/openapi.yml` in the source repo for the generated REST schema. The endpoints below are the stable, heavily-exercised core of that surface.

The gateway endpoints comprise four `POST` routes in three groups:

- **Catalog Gateway (write path)** — single-table and multi-table commit endpoints that proxy Apache Iceberg REST commits through the Neksur policy engine.
- **Lineage ingestion** — an OpenLineage v2 RunEvent receiver.
- **Polaris webhook** — an HMAC-signed callback that triggers the post-commit detection sweep.

All four routes are mounted on the same `http.ServeMux` in `cmd/neksur-server/main.go`. The first three (`/v1/iceberg/*` and `/v1/lineage`) are wrapped in `workosauth.TenantMiddleware`, which resolves the calling tenant and attaches the tenant UUID to the request context before any handler logic runs. The fourth (`/v1/webhooks/polaris`) is intentionally mounted **outside** the tenant middleware — the HMAC signature verification IS the authentication step (the per-tenant secret IS the principal), and tenant resolution happens against the signed payload only after verification succeeds.

All gateway routes are **tenant-scoped via the URL `{prefix}` segment**, which is a Neksur-side catalog alias (e.g. `prod-polaris`), not the upstream catalog's own name. See [Tenant prefix model](#tenant-prefix-model) below.

Related documents: [Architecture](/architecture/overview/) describes the 14-step commit pipeline; [Deployment](/operations/deploy/) covers operational alerting on the `503` fail-closed path.

---

## Authentication

The L1 gateway and lineage endpoints derive a request principal from a **three-step chain** defined in `internal/gateway/iceberg/principal.go` (`ExtractPrincipal`). The chain is evaluated in priority order; the first step that yields a usable subject wins. The selected step is also recorded verbatim in the audit log's `principal_source` column so SecOps can spot which path is in use per request.

### Step 1 — mTLS client certificate SAN (preferred, service-to-service)

If the request arrived over TLS with a client certificate (`r.TLS.PeerCertificates[0]`), the handler extracts the **first URI SAN** from the certificate. If no URI SAN is present, it falls back to the first DNS SAN. The trust anchor is the Phase 0.5 Private CA; the upstream terminator (e.g. ALB with mTLS termination) is responsible for chain validation before forwarding.

The audit `principal_source` value for this path is `mtls_san`.

### Step 2 — Authorization header (Bearer JWT, for human or SDK clients)

If no mTLS principal was extracted, the handler reads the `Authorization` header. It expects the form:

```http
Authorization: Bearer <jwt>
```

The JWT is parsed **without signature verification** in Phase 1 — Neksur trusts that an upstream proxy or identity provider has already verified the token. The handler extracts:

- `sub` — required; an empty `sub` causes the request to fail closed with `401 Unauthorized`.
- `email` — optional; surfaced to CEL policies as `principal.email`.
- Roles — pulled from `roles` (as a string array or as a space-delimited string) or from `groups` (WorkOS convention). Surfaced to CEL policies as `principal.roles`.

The audit `principal_source` value for this path is `auth_header`.

> Signed-token (JWKS) signature verification at this boundary is planned; today the gateway trusts an upstream proxy / IdP to have verified the token. Credential vending (compute isolation) is available as a Defense-in-Depth capability — see [Concepts: Enforcement model](/concepts/enforcement/#credential-vending-compute-isolation).

### Step 3 — Session cookie fallback (browser-initiated)

If neither mTLS nor `Authorization` produced a principal, the handler falls back to the tenant UUID attached by `workosauth.TenantMiddleware` (which itself resolved the tenant from the WorkOS session cookie set during `/callback`). The principal `sub` is set to the tenant UUID string.

This path is **lower fidelity** — it has per-tenant granularity but no per-user attribution. The audit `principal_source` value is `session`. Production deployments should configure mTLS or upstream JWT for proper user attribution.

### When all three steps fail

If none of the three steps produces a principal, the handler returns **`401 Unauthorized`**. This also happens if the chosen principal has an empty `sub` (defence-in-depth against a malformed JWT or an empty SAN slipping into the policy evaluator).

---

## Endpoint reference

### `POST /v1/iceberg/{prefix}/namespaces/{namespace}/tables/{table}`

Single-table Iceberg commit. This is the central L1 gateway endpoint — every Spark / Trino / Flink write to an Iceberg table flows through this route. The handler runs the full 14-step pipeline (validate → load → policy fetch → policy evaluate → forward → audit → ingest); see [Architecture](/architecture/overview/) for the step list.

**Path parameters:**

| Name        | Description |
|-------------|-------------|
| `prefix`    | Neksur-side catalog alias for this tenant (e.g. `prod-polaris`). Resolves via `catalog_credentials` to a concrete upstream catalog. |
| `namespace` | Iceberg namespace (e.g. `sales`). Single segment in the URL path. |
| `table`     | Iceberg table name (e.g. `orders`). |

All three identifiers must match `^[a-zA-Z0-9_-]+$`. Anything else returns `400`.

**Request body:** A standard Iceberg REST [`UpdateTableRequest`](https://iceberg.apache.org/rest-catalog-spec/) JSON object — `requirements[]` + `updates[]`. The body is hard-capped at **16 MiB** (`http.MaxBytesReader`); larger payloads return `413` from the wrapper.

**Success response:** `200 OK` with the upstream catalog's commit response body (a `LoadTableResult`) echoed verbatim.

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "metadata-location": "s3://warehouse/.../00042-abc123.metadata.json",
  "metadata": { /* updated table metadata */ }
}
```

**Error responses:**

| Status | Sentinel / cause |
|--------|------------------|
| `400`  | Malformed path identifier; body parse failure; identifier validation failed |
| `401`  | `ErrPrincipalMissing` (auth chain produced no principal); upstream catalog credentials expired |
| `403`  | `ErrPolicyDenied` — a P1/P2/P3 policy returned `Deny`; audit row written; `commit_rejected_total{reason="policy_denied"}` incremented |
| `404`  | Catalog credentials not configured for this `{prefix}`; upstream table not found |
| `405`  | Method other than `POST` |
| `409`  | Upstream commit conflict (Iceberg requirements mismatched — client should rebase and retry) |
| `413`  | Body exceeds 16 MiB |
| `500`  | Tenant context missing (mounted outside `TenantMiddleware` — config bug); catalog adapter config unmarshal error |
| `502`  | Upstream catalog returned a non-conflict, non-credentials-expired error |
| `503`  | `ErrPolicyEngineUnavailable` — D-1.09 fail-closed; `commit_rejected_total{reason="policy_engine_unavailable"}` incremented |

**Example:**

```bash
curl -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  --data @commit.json \
  https://api.neksur.example.com/v1/iceberg/prod-polaris/namespaces/sales/tables/orders
```

---

### `POST /v1/iceberg/{prefix}/transactions/commit`

Multi-table Iceberg commit, with **Reject-All** semantics. All listed tables share a single policy gate: if any one table's commit would be denied, the entire transaction is rejected and no upstream forwards occur. This prevents the "policy bypass via batched commit" attack pattern where a denied write hides inside a permitted batch.

**Path parameters:**

| Name     | Description |
|----------|-------------|
| `prefix` | Same as the single-table endpoint — Neksur-side catalog alias. |

**Request body:**

```json
{
  "table-changes": [
    {
      "identifier": { "namespace": ["sales"], "name": "orders" },
      "requirements": [ /* TableRequirement[] */ ],
      "updates":      [ /* TableUpdate[] */ ]
    },
    {
      "identifier": { "namespace": ["sales"], "name": "items" },
      "requirements": [ /* ... */ ],
      "updates":      [ /* ... */ ]
    }
  ]
}
```

Each `requirements[]` and `updates[]` follows the standard Iceberg REST shape; see the [Iceberg REST Catalog Spec](https://iceberg.apache.org/rest-catalog-spec/). The whole body is capped at **16 MiB**. Both `namespace[]` entries and `name` per change must match `^[a-zA-Z0-9_-]+$`.

**Success response:** `200 OK` with an array of upstream `CommitResult` objects, one per table, in input order:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "results": [
    { "new-snapshot-id": 1234567, "new-metadata-location": "s3://..." },
    { "new-snapshot-id": 1234568, "new-metadata-location": "s3://..." }
  ]
}
```

**Error semantics specific to this endpoint:**

- **Policy gate runs first, for all tables.** Any single `Deny` causes the offending table to be audit-logged as `REJECTED`, and the response is `403`. No upstream forwards happen. No `WriteEvent` is emitted for the non-offending tables.
- **Policy-engine-unavailable for any table** during the gate phase aborts the transaction with `503` (fail-closed).
- **Upstream forwarding is sequential and independent.** Phase 1 does NOT wrap the upstream commits in a cross-catalog transaction (iceberg-go does not yet support multi-table 2PC). If table N's commit succeeds and table N+1 fails, the prior commits stay. The handler returns `502` (or `409` on conflict) with the offending table name in the message.

**Status codes:** Same table as the single-table endpoint, plus the message body identifies which table caused a `403` / `409` / `502` (e.g. `"multi-table reject-all: policy denied on orders: <reason>"`).

**Example:**

```bash
curl -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  --data @transaction.json \
  https://api.neksur.example.com/v1/iceberg/prod-polaris/transactions/commit
```

---

### `POST /v1/lineage`

OpenLineage v2 RunEvent receiver. Spark, Flink, Airflow, and dbt's OpenLineage integrations push run events here; the handler persists the raw event to a durable `lineage_inbox` table FIRST (at-least-once durability per Pitfall 5) and then translates each `(input, output)` dataset pair into a `LINEAGE_OF` edge in the property graph.

This endpoint is **not bound to `{prefix}`** — lineage is a tenant-scoped concept but spans across catalogs. The tenant is resolved by `workosauth.TenantMiddleware`.

**Request body:** A subset of the OpenLineage v2 RunEvent schema — see [openlineage.io](https://openlineage.io/docs/spec). The handler types and validates these fields:

| Field          | Required | Description |
|----------------|----------|-------------|
| `eventType`    | Yes      | One of `START`, `RUNNING`, `COMPLETE`, `ABORT`, `FAIL`. |
| `eventTime`    | No       | RFC 3339 timestamp. Defaults to "now" if absent or unparseable. |
| `producer`     | Yes      | The emitting tool, e.g. `spark/3.5.0`. Forms half of the dedup UNIQUE key. |
| `run.runId`    | Yes      | UUID-shaped per OpenLineage. Forms the other half of the dedup UNIQUE key. |
| `job.namespace`, `job.name` | No | The logical pipeline identifier. |
| `inputs[]`, `outputs[]` | No | `Dataset{namespace, name}` pairs. May be empty (run-state-only events). |
| `schemaURL`    | No       | OpenLineage spec URL. |

The full untyped JSON body is preserved in `lineage_inbox.payload` so Phase 2 / Phase 3 enrichment can read facets we don't currently type.

**Body cap:** **1 MiB** (`http.MaxBytesReader`). Larger payloads should be split across multiple run events.

**Success response:** `202 Accepted` (empty body). The `202` reflects the at-least-once semantics — the event has been durably persisted; downstream MERGE may complete asynchronously.

**Error responses:**

| Status | Cause |
|--------|-------|
| `400`  | Body parse failure; missing required field (`eventType` / `run.runId` / `producer`); body exceeds 1 MiB |
| `405`  | Method other than `POST` |
| `422`  | A `LINEAGE_OF` edge would create a cycle (`ingest.LineageCycleError`) |
| `500`  | Tenant context missing |
| `503`  | `lineage_inbox` persist failure; downstream MERGE failure |

**Dedup behavior:** Re-POSTing the same `(producer, run_id)` is a no-op — the `UNIQUE (producer, run_id)` constraint on `lineage_inbox` swallows duplicates (`ON CONFLICT DO NOTHING`). Spark's OpenLineage HTTP transport retries on transient failures land here safely.

**Example:**

```bash
curl -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  --data '{
    "eventType": "COMPLETE",
    "eventTime": "2026-05-15T10:00:00Z",
    "producer": "spark/3.5.0",
    "run":  {"runId": "01900a3b-c4d5-7e6f-89ab-cdef01234567"},
    "job":  {"namespace": "etl", "name": "load_orders"},
    "inputs":  [{"namespace": "iceberg", "name": "raw.events"}],
    "outputs": [{"namespace": "iceberg", "name": "sales.orders"}]
  }' \
  https://api.neksur.example.com/v1/lineage
```

---

### `POST /v1/webhooks/polaris`

HMAC-signed callback from an upstream Polaris catalog. Used as a trigger source for the L3 detection sweep — when Polaris notifies Neksur of a new snapshot, the handler verifies the signature, decodes the payload, and pushes a `Hit{Source: "polaris-webhook"}` onto the dispatch channel for the detection pool to consume.

This endpoint is mounted **outside** `workosauth.TenantMiddleware`. The HMAC signature verification IS the authentication step.

**Required headers:**

| Header                | Required | Description |
|-----------------------|----------|-------------|
| `X-Polaris-Signature` | Yes      | Hex-encoded HMAC-SHA256 of the raw request body, computed with the per-tenant webhook secret. |
| `X-Polaris-Tenant`    | No       | Tenant UUID. Preferred when present; otherwise the handler reads `tenant_id` from the JSON body. |

**Request body:**

```json
{
  "tenant_id": "01900a3b-c4d5-7e6f-89ab-cdef01234567",
  "metadata_location": "s3://warehouse/.../00042-abc123.metadata.json",
  "namespace": "sales",
  "table_name": "orders"
}
```

`metadata_location` is required (the L3 dedup key); the other fields are advisory. Body is hard-capped at **256 KiB**.

**Verification flow:**

1. If `NEKSUR_POLARIS_WEBHOOK_ENABLED=0`, the handler returns `410 Gone` immediately.
2. Read the body (256 KiB cap).
3. Require `X-Polaris-Signature` header to be present.
4. Parse the body to extract `tenant_id` (falling back to `X-Polaris-Tenant` if the body field is empty).
5. Validate the tenant ID is a properly formatted UUID (strict character class — used as a SQL identifier suffix).
6. Look up the per-tenant webhook secret from `catalog_credentials.config_json[webhook_secret]` for `catalog_kind = 'polaris'`.
7. Compute HMAC-SHA256 of the body and constant-time compare against the header (`hmac.Equal`).
8. On match, push the `Hit{}` onto the dispatch channel and return `200 OK`.

**Success response:** `200 OK` (empty body).

**Error responses:**

| Status | Cause |
|--------|-------|
| `400`  | Body read / parse failure; missing `X-Polaris-Signature` header; missing tenant ID (neither header nor body); missing `metadata_location` |
| `401`  | No webhook secret configured for the named tenant; HMAC signature mismatch |
| `405`  | Method other than `POST` |
| `410`  | Handler disabled via `NEKSUR_POLARIS_WEBHOOK_ENABLED=0` |
| `503`  | Admin pool unreachable; `catalog_credentials` lookup failed; request context cancelled |

**Example (with helper signing):**

```bash
BODY='{"tenant_id":"...", "metadata_location":"s3://..."}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | awk '{print $2}')

curl -X POST \
  -H "X-Polaris-Signature: $SIG" \
  -H "Content-Type: application/json" \
  --data "$BODY" \
  https://api.neksur.example.com/v1/webhooks/polaris
```

---

## Error codes & meanings

The L1 gateway maps internal sentinel errors (`internal/gateway/iceberg/errors.go`) to HTTP status codes deterministically. Operators monitoring the gateway should treat the two policy-related codes — `503` and `403` — very differently.

### `403 Forbidden` — `ErrPolicyDenied`

A P1 (schema), P2 (write-ACL), or P3 (retention) policy returned `Deny` during evaluation. This is the **expected, business-as-usual** rejection path — a customer's policy correctly blocked a non-conforming commit. The gateway:

- Increments `commit_rejected_total{reason="policy_denied"}`.
- Writes a `WriteEvent` audit row with `decision = 'REJECTED'` and the policy's denial reason.
- Returns `403` with the reason in the response body (e.g. `policy denied: schema field 'pii_email' added without P3 retention tag`).

Alert on this via dashboard trend, **not** via page. A sudden spike may indicate an upstream client misconfiguration; a sustained zero may indicate a policy is missing.

### `503 Service Unavailable` — `ErrPolicyEngineUnavailable`

The policy engine could not produce a verdict. Possible causes:

- The policy fetch from the AGE graph store failed (`LoadPoliciesForTable` returned error).
- A CEL compile error in the stored policy text.
- A CEL eval error (e.g. type mismatch against the `Inputs` map).
- A non-bool return from a policy expression.
- A panic during evaluation.

**This is fail-closed by design** (D-1.09). The gateway refuses to forward the commit — it would rather reject a legitimate write than silently let a non-evaluated commit through. The gateway:

- Increments `commit_rejected_total{reason="policy_engine_unavailable"}`.
- Logs the underlying error (operator-visible via `slog`).
- Returns `503` with body `policy-engine-unavailable`.
- Does NOT emit an audit row (no policy verdict was produced).

**This is page-severity.** If the rate of `503`s from this counter exceeds threshold, the on-call should investigate immediately — either the engine itself is unhealthy or a recently-edited policy is malformed. See [Deployment](/operations/deploy/) for the AlertManager rule.

### `413 Payload Too Large`

Returned by `http.MaxBytesReader` when the body exceeds the per-endpoint cap:

- **16 MiB** for the two gateway endpoints (`/v1/iceberg/...`).
- **1 MiB** for `/v1/lineage`.
- **256 KiB** for `/v1/webhooks/polaris`.

Caps are constants in source and are not configurable in Phase 1.

### `400 Bad Request`

Returned for any malformed input that the handler can determine without consulting external state:

- Identifier validation failure (`{prefix}`, `{namespace}`, `{table}` not matching `^[a-zA-Z0-9_-]+$`).
- JSON parse failure on the commit body or lineage payload.
- Missing required fields (`eventType` / `run.runId` / `producer` on lineage; `metadata_location` / signature header on webhook).
- Empty `table-changes` array on a multi-table commit.

### `401 Unauthorized`

Returned when:

- The principal extraction chain produced no principal (no mTLS, no `Authorization`, no tenant context — see [Authentication](#authentication)).
- The extracted principal has an empty `sub`.
- The upstream catalog's stored credentials have expired (`iceberg.ErrCredentialsExpired`).
- On the Polaris webhook: no secret configured for the named tenant, or HMAC mismatch.

### Other codes (summary)

| Code | When |
|------|------|
| `404` | Catalog credentials not found for `{prefix}`; upstream table not found |
| `405` | Method other than `POST` on any of these routes |
| `409` | Upstream Iceberg commit conflict — requirements mismatch, client must rebase |
| `410` | Polaris webhook handler disabled |
| `422` | OpenLineage event would create a lineage cycle |
| `500` | Tenant context missing (route misconfiguration); catalog adapter config error |
| `502` | Upstream catalog returned an unexpected error (non-conflict, non-credentials path) |

---

## Tenant prefix model

The `{prefix}` path segment on the gateway routes is a **Neksur-side alias**, not the upstream catalog's own name. The mapping lives in the per-tenant `catalog_credentials` table:

| `{prefix}` (URL) → | Lookup → | `(catalog_kind, endpoint, config_json)` |
|--------------------|----------|----------------------------------------|

When a request arrives at `POST /v1/iceberg/prod-polaris/namespaces/sales/tables/orders`, the handler:

1. Validates `prod-polaris` against `^[a-zA-Z0-9_-]+$`.
2. Calls `CredStore.GetCatalogCredentials(ctx, "prod-polaris")` — this is RLS-scoped to the tenant resolved by `TenantMiddleware`, so two tenants can register the same prefix string independently with no collision.
3. Dispatches on `creds.Kind` to the matching adapter (`polaris` / `nessie` / `glue` / `unity`) via `BuildAdapter`. The Phase 1 default kind is Polaris; Nessie ships in Phase 1; Glue and Unity are stub adapters that return `ErrAdapterStub` on state-mutating calls until Phase 3.

**Multi-catalog-per-tenant is supported.** A single tenant can register multiple `{prefix}` aliases — e.g. `prod-polaris`, `stage-polaris`, `analytics-nessie` — each mapping to a different upstream catalog. The CEL policy graph attaches policies to logical table identities (namespace + name), not to prefix aliases, so the same policy can govern commits arriving via different prefixes.

The upstream Polaris catalog's own name (its `warehouse` config value) is stored inside `config_json` and is **never** visible in the URL path. This decouples the wire URL from upstream catalog renames and lets Neksur transparently swap upstreams without changing the URL contract for client integrations.

---

## Rate limits & quotas

**No rate limits are enforced at the Neksur application layer in Phase 1.** Deployment-level limits should be applied at the ingress (ALB, API Gateway, or equivalent) — see [Deployment](/operations/deploy/) for the recommended ingress configuration.

The only request-shape bounds enforced inside Neksur are the per-endpoint body caps documented above (16 MiB / 1 MiB / 256 KiB).

---

## Beyond the gateway endpoints

The four endpoints above are documented here in full because they carry the commit data path. The rest of the surface is available in Core but documented elsewhere as it stabilizes:

| Surface | Where it lives | Status |
|---------|----------------|--------|
| **SQL proxy** (read-path enforcement) + `pgwire` + XMLA | `internal/sqlproxy`, `internal/pgwire`, `internal/xmla` | Core — see [Architecture](/architecture/overview/#read-path-writer-side-and-credential-vending) |
| **GraphQL** (graph / contract queries) | `internal/api/graphql` | Core |
| **MCP server** (`graph.traverse` for AI agents) | `internal/api/mcp` | Core — Access-enforced, clause-whitelisted |
| **Contracts / lifecycle, semantic / metrics, detection, compliance, FinOps** REST resources | `internal/api/rest`, `internal/api/openapi.yml` | Core |
| First-party SDK clients (Go, Python, TypeScript) | — | on the distribution track |

When integrating, treat the gateway/lineage/webhook contracts on this page as stable; for the other surfaces, generate against `internal/api/openapi.yml` (REST) or the GraphQL schema, which are the source of truth.

See [Getting Started](/getting-started/install-and-first-policy/) for the supported integration path today (deploy `neksur-server`, point Spark / Trino at the gateway and read-path proxy, register policies via the admin CLI).
