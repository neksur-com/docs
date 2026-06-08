---
title: "Getting Started: Install and Your First Contract"
description: "This is the canonical first thirty minutes with Neksur. By the end you will have a local Neksur Core stack running against a Polaris testcontainer, a…"
---

This is the canonical first thirty minutes with Neksur. By the end you will have a local Neksur Core stack running against a Polaris testcontainer, a tenant onboarded, a catalog credential registered, a CEL policy compiled and loaded into the graph, and two commits exercised through the L1 Catalog Gateway — one that the policy **rejects** with `403`, and one that it lets through with `200`. You will then inspect the audit trail the gateway wrote into the metadata graph.

The whole walkthrough is local development. Production deployments run on AWS with Patroni-managed Postgres+AGE, pgBackRest, and per-tenant VPC peering; see the [Deployment runbook](/operations/deploy/) for that path. The shape of every command in this guide is the shape you will run in production — just with different secrets, hostnames, and credentials.

Roughly thirty minutes start to finish if Docker is already running and `go` is on your PATH.

## What you're about to set up

A few terms used below — Neksur Core uses them precisely:

- **Tenant.** The unit of isolation. Every node and edge in the metadata graph carries a `tenant_id`; every Postgres row sits behind RLS keyed on the tenant; every L1 gateway request is authenticated under exactly one tenant. In production a tenant corresponds to one customer organization. In local dev, you'll create one tenant for yourself.
- **Catalog credential.** A row in the tenant's `catalog_credentials` table that tells the gateway "for the URL prefix `acme-polaris`, forward upstream to this Polaris (or Nessie / Glue / Unity) endpoint with this config." One row per configured catalog; you'll create one row pointing at the Polaris testcontainer.
- **CEL policy.** A boolean Common Expression Language expression evaluated at commit time against three bindings: `table` (current Iceberg table metadata), `commit` (the proposed change), and `principal` (the authenticated user). If the expression returns `false`, the gateway returns `403` and writes an audit record. This guide walks through a P1 schema policy ("no commit may add a column named `ssn`").
- **L1 Catalog Gateway.** The Neksur server's Iceberg REST proxy. It intercepts `POST /v1/iceberg/{prefix}/namespaces/{namespace}/tables/{table}` (and the multi-table transaction variant), runs your CEL policies, forwards to the upstream catalog on allow, rejects on deny, and emits a `WriteEvent` audit node either way.

## 1. Prerequisites

You need:

- **Docker** with at least 4 GB of memory available (Postgres+AGE plus the Polaris testcontainer fit comfortably).
- **Go 1.25 or newer.** Neksur Core pins `go 1.25.0` in `go.mod`; the build will refuse older toolchains.
- **`psql`** (the standard Postgres client) on your PATH — used for the catalog-credential insert and the audit-trail inspection.
- **`curl`** — used to exercise the gateway.
- **Atlas migration runner.** Neksur Core uses Atlas (versioned mode) to apply migrations. Install per the [Atlas docs](https://atlasgo.io/getting-started); a single `curl -sSf https://atlasgo.sh | sh` is usually enough.

The walkthrough does **not** require AWS, WorkOS, or any external service. The Polaris dependency is satisfied by a testcontainer image the integration tests already use; you can pull it in advance with `docker pull apache/polaris:latest` if you want to front-load the network time.

If this fails: confirm `docker info` returns without errors, `go version` reports `go1.25.0` or newer, and `atlas version` prints a version string. A common gotcha on macOS is that Docker Desktop's memory cap defaults to 2 GB — bump it to 4 GB in the Docker Desktop preferences.

## 2. Clone Neksur Core

```bash
git clone https://github.com/neksur-com/neksur.git
cd neksur
```

Neksur Core is licensed under **BSL 1.1** with a Change Date of 2030-05-10 (it becomes Apache 2.0 automatically on that date). The plain-English summary is in [`LICENSE.md`](https://github.com/neksur-com/neksur/blob/main/LICENSE.md); the full BSL text is in `LICENSE`. For local development and internal production use you do not need to do anything — BSL grants you both. The licence only constrains offering Neksur Core as a managed service that competes with Neksur's commercial offerings.

## 3. Bring up the local stack

The Phase 0 `docker-compose.yml` brings up exactly one service: a Postgres 16 image extended with **Apache AGE 1.6.0** and pgaudit. (Patroni, etcd, HAProxy, and pgBackRest land in production via the deploy runbook, not in local dev.) Polaris is pulled on demand by the integration test fixture in step 9 — you do not need to bring it up separately here.

```bash
docker-compose up -d postgres
```

Confirm it's healthy:

```bash
docker ps --filter name=neksur-postgres-dev
```

Expected output (abbreviated):

```
CONTAINER ID   IMAGE                              STATUS                      PORTS
xxxxxxxxxxxx   neksur/postgres-age:phase0-dev     Up (healthy)                0.0.0.0:5432->5432/tcp
```

The build context is `./infra/postgres/Dockerfile`; the first `docker-compose up` will take a couple of minutes building the image. Subsequent runs are instant.

If this fails:
- Port 5432 already in use? Stop your host Postgres (`brew services stop postgresql` on macOS) or change the host port in `docker-compose.yml`.
- Image build failing? `docker-compose build --no-cache postgres` to rebuild from scratch.
- Container starts but `pg_isready` keeps failing? Check `docker logs neksur-postgres-dev` for the `LOAD 'age'` error — it usually means the extension didn't get installed in the image and you need to rebuild.

## 4. Run migrations

Neksur Core uses **Atlas** (versioned mode) to apply migrations. The `cmd/migrate` Go binary wraps Atlas for the multi-tenant rollout: it applies the **public-tier** migrations first (V0041–V0044: `public.tenants`, RLS, audit log, lookup function), then iterates every discovered `tenant_<uuid>` schema applying the **tenant-tier** relational migrations (V0050–V0066: per-tenant audit log, query history, policies, catalog credentials, detection runs, lineage inbox, staging, RLS) and the **graph-tier** migrations (V0010–V0032: AGE graph creation, Phase 1 vlabels and elabels, property indexes, RLS policies).

Export the connection string the compose file declares, then run the headline migrate target:

```bash
export DATABASE_URL='postgres://neksur:neksur_dev@localhost:5432/neksur?sslmode=disable'
make migrate
```

Expected output (abbreviated):

```
migrate: applying public-tier migrations…
migrate: discovered 0 tenant schema(s)
OK public + 0 tenant(s)
```

Zero tenants is correct — you haven't onboarded one yet. The next step does that.

If this fails:
- `ERROR: DATABASE_URL is required` — re-`export` it; the Makefile checks for the env var before invoking `go`.
- `atlas: command not found` — Atlas isn't on your PATH; install per step 1.
- Migration applies but later steps fail with `relation "public.tenants" does not exist` — re-run `make migrate-status` to confirm which revisions actually landed.

## 5. Onboard a tenant

The `neksur-cli tenant create` subcommand runs the first two of the five provisioning steps (`public.tenants` INSERT, AGE graph create, per-tenant Postgres role create) idempotently. Two flags are required: the tenant UUID (must be a valid UUID v4) and the WorkOS organization ID. In local development WorkOS isn't actually involved — the org-id format is validated (`^org_[A-Za-z0-9]+$`) but never round-tripped against WorkOS, so any plausible value works.

```bash
go run ./cmd/neksur-cli tenant create \
  --tenant-uuid=11111111-1111-4111-8111-111111111111 \
  --workos-org=org_DEV_LOCAL
```

Expected output:

```
OK tenant create: id=11111111-1111-4111-8111-111111111111 workos_org=org_DEV_LOCAL schema=tenant_11111111_1111_4111_8111_111111111111 role=neksur_tenant_11111111_1111_4111_8111_111111111111
```

The tenant now has a Postgres schema (`tenant_<uuid_with_dashes_replaced_by_underscores>`) and an AGE graph. You still need to apply the tenant-tier migrations to populate that schema with the V0050+ tables. Run the same `make migrate` again — this time it discovers the new tenant and applies the tenant-tier sequence:

```bash
make migrate
```

Expected:

```
migrate: applying public-tier migrations…
migrate: discovered 1 tenant schema(s)
migrate: applying tenant tenant_11111111_1111_4111_8111_111111111111…
OK tenant tenant_11111111_1111_4111_8111_111111111111
OK public + 1 tenant(s)
```

Export the tenant UUID — every step below references it:

```bash
export TENANT_UUID=11111111-1111-4111-8111-111111111111
export TENANT_SCHEMA=tenant_11111111_1111_4111_8111_111111111111
```

If this fails:
- `invalid UUID format` — the CLI's `ValidateUUIDv4` rejects non-v4 UUIDs; either use the one above or generate a new one with `uuidgen` and the right version nibble.
- `invalid WorkOS org id` — the regex demands the `org_` prefix.
- Re-running `tenant create` with the same UUID is safe: the public.tenants INSERT is `ON CONFLICT DO NOTHING` and the graph + role creates are idempotent.

## 6. Register a Polaris catalog credential

There is **no `neksur-cli catalog onboard` subcommand in Phase 1** — the catalog-credential CLI is planned for a future phase. For now, insert the row directly via `psql`. The table schema is defined in [`migrations/postgres/V0060__tenant_catalog_credentials.sql`](https://github.com/neksur-com/neksur/blob/main/migrations/postgres/V0060__tenant_catalog_credentials.sql); the required columns are `catalog_kind` (one of `polaris` / `nessie` / `glue` / `unity`), `nickname` (UNIQUE per tenant — this is the `{prefix}` segment in the gateway URL), `endpoint`, and `config_json`.

For this walkthrough use the `acme-polaris` nickname pointed at the Polaris testcontainer URL the integration suite uses. The `config_json` minimum shape is the Polaris adapter config; the gateway adapter reads `endpoint` and the adapter-specific fields out of it.

```bash
psql "$DATABASE_URL" <<EOF
SET search_path TO $TENANT_SCHEMA, public;

INSERT INTO catalog_credentials (catalog_kind, nickname, endpoint, config_json)
VALUES (
  'polaris',
  'acme-polaris',
  'http://localhost:8181/api/catalog',
  jsonb_build_object(
    'endpoint', 'http://localhost:8181/api/catalog',
    'warehouse', 'neksur_dev'
  )
);
EOF
```

Confirm the row landed:

```bash
psql "$DATABASE_URL" -c "SELECT id, catalog_kind, nickname, endpoint FROM $TENANT_SCHEMA.catalog_credentials;"
```

Expected: one row with `catalog_kind = polaris` and `nickname = acme-polaris`.

The `INSERT` is admin-only by design — `V0060` REVOKEs INSERT/UPDATE/DELETE on this table from `PUBLIC` and grants only SELECT to the tenant role. The gateway reads this row via the tenant-scoped `catalog.Repo` at request time; mutations stay on the admin pathway.

If this fails:
- `permission denied for table catalog_credentials` — you're connected as the per-tenant role, not the admin role. The `$DATABASE_URL` above uses the `neksur` superuser the compose file creates, which has the right grants.
- `duplicate key value violates unique constraint` on `nickname` — pick a different nickname; one tenant cannot have two catalogs with the same prefix.

## 7. Start the server

The Neksur server binary mounts the L1 gateway routes only when `NEKSUR_SAAS_AUTH=1`. Phase 0.5 SaaS auth is the production path; in local dev the WorkOS keys can be placeholders (the binary checks they're non-empty but doesn't validate them against WorkOS at boot — only the `/api/*` and `/webhooks/workos` routes actually call WorkOS, and you won't hit those in this walkthrough).

```bash
export NEKSUR_SAAS_AUTH=1
export DATABASE_URL='postgres://neksur:neksur_dev@localhost:5432/neksur?sslmode=disable'
export WORKOS_API_KEY=sk_test_placeholder
export WORKOS_CLIENT_ID=client_placeholder
export WORKOS_WEBHOOK_SECRET=whsec_placeholder
export STRIPE_WEBHOOK_SECRET=whsec_stripe_placeholder

make run-server
```

Expected output:

```
Neksur Server (placeholder — Phase 0 stub; M1 will wire up REST API, MCP server, SQL proxy).
```

The server then sits on `:8080` (override with `NEKSUR_LISTEN_ADDR`) with these routes mounted:

| Route | Purpose |
|---|---|
| `POST /v1/iceberg/{prefix}/namespaces/{namespace}/tables/{table}` | L1 gateway — single-table commit |
| `POST /v1/iceberg/{prefix}/transactions/commit` | L1 gateway — multi-table transaction commit |
| `POST /v1/lineage` | OpenLineage v2 event receiver |
| `POST /v1/webhooks/polaris` | Polaris webhook subscriber (L3 trigger source) |
| `/api/...` | Authenticated tenant API (placeholder in Phase 1) |
| `/callback` | WorkOS OAuth code → session cookie |
| `/webhooks/workos`, `/webhooks/stripe`, `/admin/...` | SaaS infrastructure |

(The gateway also has L3 background goroutines: a 30-second poller and an optional S3 ObjectCreated SQS consumer — see `cmd/neksur-server/main.go` for the dispatch wiring.)

Leave this terminal running. Subsequent steps use a second terminal.

If this fails:
- `saas auth bootstrap failed: WORKOS_API_KEY + WORKOS_CLIENT_ID + WORKOS_WEBHOOK_SECRET required when NEKSUR_SAAS_AUTH=1` — re-export all three placeholders.
- `pgxpool.NewWithConfig: failed to connect` — Postgres compose isn't up. `docker-compose up -d postgres`.
- `graph.NewGraphClient` errors with `extension "age" is not available` — the image build dropped the AGE extension; rebuild with `docker-compose build --no-cache postgres`.

## 8. Write your first policy

Policies are written in **CEL** (Common Expression Language) against three bindings: `table`, `commit`, `principal`. Neksur registers three custom CEL functions on top of stock CEL because CEL has no JSONPath operator and you can't iterate `table.schema.fields` from raw CEL:

| Function | Returns | Purpose |
|---|---|---|
| `manifest.has_column(table, name string) bool` | true if any field in `table.schema.fields` has `name == name` | P1 schema policies |
| `manifest.has_partition(table, spec string) bool` | true if any field in `table.partition_spec.fields` has `name == spec` | P1 schema/partition policies |
| `principal.role(principal, role string) bool` | true if `role` is in `principal.roles` | P2 write-ACL policies |

(Source: [`internal/policy/cel/functions.go`](https://github.com/neksur-com/neksur/blob/main/internal/policy/cel/functions.go).)

A P1 schema policy that says "no commit may add a column named `ssn`" is one expression:

```
!manifest.has_column(table, "ssn")
```

The expression must return `true` for the commit to be allowed; `false` produces an `ActionDeny` and the gateway returns `403`.

Save it to a file and validate the syntax with the `policy compile` subcommand. This subcommand dogfoods the **same** CEL env and compiler the gateway uses at runtime, so a clean compile here means the gateway will accept the policy too:

```bash
cat > /tmp/p1-no-ssn.cel <<'EOF'
!manifest.has_column(table, "ssn")
EOF

go run ./cmd/neksur-cli policy compile /tmp/p1-no-ssn.cel
```

Expected output:

```
Policy /tmp/p1-no-ssn.cel compiles cleanly.
```

Exit codes from `policy compile`:

| Code | Meaning |
|---|---|
| `0` | Compiles cleanly |
| `1` | CEL syntax error or undeclared binding |
| `2` | Usage error or file unreadable |

Now load the policy into the tenant's AGE graph. **There is no `neksur-cli policy push` subcommand in Phase 1** — the policy management CLI is planned for a future phase. For now, insert the Policy node and the `SCHEMA_GOVERNS` edge via raw Cypher. (The same shape used by the integration tests — see [`tests/integration/policy_cel_p1_schema_test.go`](https://github.com/neksur-com/neksur/blob/main/tests/integration/policy_cel_p1_schema_test.go) for the canonical seed pattern.)

First create the table the policy will govern. The L1 gateway reads policies for a table via `LoadPoliciesForTable(ref)`, which matches the `Table` vlabel on `name` + `namespace`. Use `probe` / `default` to match the commit you'll send in step 9:

```bash
psql "$DATABASE_URL" <<EOF
SET search_path TO $TENANT_SCHEMA, public;
SELECT set_config('app.current_tenant', '$TENANT_UUID', false);

-- Create the Table node, the Policy node, and the SCHEMA_GOVERNS edge.
SELECT * FROM ag_catalog.cypher('neksur', \$\$
  CREATE (:Table {
    name: 'probe',
    namespace: 'default',
    tenant_id: '$TENANT_UUID',
    iceberg_id: 'tbl-probe-default-v1'
  })
\$\$) AS (result ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('neksur', \$\$
  CREATE (:Policy {
    id: 'p1-no-ssn',
    kind: 'schema',
    definition_cel: '!manifest.has_column(table, "ssn")',
    tenant_id: '$TENANT_UUID'
  })
\$\$) AS (result ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('neksur', \$\$
  MATCH (p:Policy {id: 'p1-no-ssn'}),
        (t:Table  {name: 'probe', namespace: 'default'})
  CREATE (p)-[:SCHEMA_GOVERNS {tenant_id: '$TENANT_UUID'}]->(t)
\$\$) AS (result ag_catalog.agtype);
EOF
```

That's the minimum shape the gateway's policy store will load: a `Policy` node with `definition_cel`, connected to a `Table` node via a `SCHEMA_GOVERNS` edge, all tagged with the tenant id.

If this fails:
- `function ag_catalog.cypher does not exist` — the AGE extension isn't loaded into the session. The graph-tier migration sets it up; if you see this error, re-run `make migrate` and confirm V0010 applied.
- `function set_config does not exist` — typo; it's `pg_catalog.set_config(setting, value, is_local)`.

## 9. Try a commit that violates the policy

The L1 gateway intercepts the standard Iceberg REST commit endpoint at `POST /v1/iceberg/{prefix}/namespaces/{namespace}/tables/{table}`. The `{prefix}` segment is the `nickname` you set in step 6 (`acme-polaris`). The body is a normal Iceberg `CommitRequest` — requirements plus updates. The principal must be present; in Phase 1 the gateway accepts a principal via the `X-Neksur-Principal` header for testcontainer integration tests, which is what you'll use here.

Send a commit that **adds an `ssn` column** — exactly what the policy bans:

```bash
curl -i -X POST http://localhost:8080/v1/iceberg/acme-polaris/namespaces/default/tables/probe \
  -H 'Content-Type: application/json' \
  -H "X-Neksur-Principal: alice@example.com" \
  --data '{
    "requirements": [],
    "updates": [
      {
        "action": "add-schema",
        "schema": {
          "fields": [
            {"id": 1, "name": "id",    "type": "long"},
            {"id": 2, "name": "email", "type": "string"},
            {"id": 3, "name": "ssn",   "type": "string"}
          ]
        }
      }
    ]
  }'
```

Expected response:

```
HTTP/1.1 403 Forbidden
Content-Type: text/plain; charset=utf-8

policy denied: <reason from policy decision>
```

The gateway also incremented the `commit_rejected_total{reason="policy_denied"}` Prometheus counter and emitted a `WriteEvent` audit node with `decision = 'REJECTED'`. You'll see that node in step 11.

If this fails:
- `404 catalog credentials not found` — your `nickname` in step 6 didn't match the `{prefix}` you used. They must be identical.
- `503 policy-engine-unavailable` — the policy fetch or eval failed; the gateway is **fail-closed** by design (D-1.09). Check the server logs for the wrapped error, then verify the Policy node and `SCHEMA_GOVERNS` edge from step 8 actually landed.
- `401 unauthorized: principal missing` — you forgot the `X-Neksur-Principal` header.

## 10. Try a commit that passes

Same request — but with the `ssn` field removed:

```bash
curl -i -X POST http://localhost:8080/v1/iceberg/acme-polaris/namespaces/default/tables/probe \
  -H 'Content-Type: application/json' \
  -H "X-Neksur-Principal: alice@example.com" \
  --data '{
    "requirements": [],
    "updates": [
      {
        "action": "add-schema",
        "schema": {
          "fields": [
            {"id": 1, "name": "id",    "type": "long"},
            {"id": 2, "name": "email", "type": "string"}
          ]
        }
      }
    ]
  }'
```

Expected response:

```
HTTP/1.1 200 OK
Content-Type: application/json

{ "metadata-location": "s3://.../probe/metadata/00001-...metadata.json", ... }
```

The body is the upstream Polaris catalog's commit response echoed back transparently. A `WriteEvent` node with `decision = 'APPROVED'` plus an `ACTUAL_WRITE` edge from the new `Snapshot` node to the `Table` node is now in the graph.

If this fails with `502 upstream commit failed`: the Polaris testcontainer at `http://localhost:8181/api/catalog` isn't running or doesn't have the `default.probe` table created yet. For end-to-end live testing against Polaris, use the integration fixture in `tests/integration/` (`StartPhase1Fixture`) which spins Polaris up alongside the AGE container and seeds the table — that's the path the test suite uses; a hand-rolled `docker run apache/polaris:latest` will require its own warehouse + table setup that's outside the scope of this guide.

## 11. Inspect the audit trail

Every commit through the gateway emits — atomically, in the same transaction as the upstream commit's audit row — a `WriteEvent` node into the AGE graph, plus an `INTENDED_WRITE` edge from a `Person` node (the principal) to the `Table`, plus (on `APPROVED` only) an `ACTUAL_WRITE` edge from the new `Snapshot` to the `Table`. The full shape is in [`internal/gateway/iceberg/audit.go`](https://github.com/neksur-com/neksur/blob/main/internal/gateway/iceberg/audit.go) (`EmitWriteEvent`).

Query the WriteEvent nodes for your tenant:

```bash
psql "$DATABASE_URL" <<EOF
SET search_path TO $TENANT_SCHEMA, public;
SELECT set_config('app.current_tenant', '$TENANT_UUID', false);

SELECT * FROM ag_catalog.cypher('neksur', \$\$
  MATCH (we:WriteEvent {tenant_id: '$TENANT_UUID'})
  RETURN we.commit_id    AS commit_id,
         we.committer    AS committer,
         we.decision     AS decision,
         we.reason       AS reason,
         we.created_at   AS created_at
  ORDER BY we.created_at
\$\$) AS (
  commit_id  ag_catalog.agtype,
  committer  ag_catalog.agtype,
  decision   ag_catalog.agtype,
  reason     ag_catalog.agtype,
  created_at ag_catalog.agtype
);
EOF
```

Expected output (abbreviated, two rows):

```
       commit_id        |     committer       | decision  |                reason                 |        created_at
------------------------+---------------------+-----------+---------------------------------------+-----------------------------
 "...-rejected-uuid..." | "alice@example.com" | "REJECTED"| "policy p1-no-ssn denied: ssn banned" | "2026-05-15T10:14:22.123Z"
 "...-approved-uuid..." | "alice@example.com" | "APPROVED"| ""                                    | "2026-05-15T10:14:25.456Z"
```

Two rows: the rejected commit from step 9 and the approved commit from step 10. The `WriteEvent` is the audit anchor; `INTENDED_WRITE` records what the principal *tried* to do regardless of outcome; `ACTUAL_WRITE` (which exists only for the approved row) records what *actually* landed. This is the core lineage primitive — the same shape Neksur uses to answer "who wrote this snapshot, when, under what policy decision, and what was their intent?"

If this fails:
- `column "result" returning agtype but agtype expected` mismatches — adjust the column type list at the end of the `cypher()` call to match the number of `RETURN` columns.
- Zero rows — the audit-emission step is best-effort after the upstream commit succeeds (the gateway logs `gateway: emit audit (...) failed` to slog on errors and does not roll back). Check the server stdout from step 7 for any audit emission errors.

## What's next?

You now have a working Neksur Core stack with one tenant, one configured Polaris catalog, one CEL policy, and an audit trail with one rejection and one approval. Three places to go from here:

- **[Architecture Overview](/architecture/overview/)** — the three-layer enforcement model (L1 gateway / L2 read-path proxy / L3 detection), the 14-step commit pipeline, the AGE graph schema, and the failure modes you'll encounter in production.
- **[REST API Reference](/reference/rest-api/)** — every endpoint the server mounts, the exact request and response shapes for the Iceberg gateway and the OpenLineage receiver, all HTTP status codes the gateway emits, and the principal-extraction chain.
- **[Deployment](/operations/deploy/)** — the production HA topology (Patroni + etcd + HAProxy, sub-30-second failover), backup and DR (pgBackRest, RTO 1h / RPO 15min), per-tenant VPC peering, and the full WorkOS / Stripe / PagerDuty wiring.
