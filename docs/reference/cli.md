# CLI & binaries reference

Neksur ships a single binary for the server plus an operator CLI and a few focused tools. This page is the reference for all of them.

Most commands read connection details from the environment — chiefly `DATABASE_URL` (the Pool A Postgres DSN). Exit codes follow a convention: **0** success/idempotent, **1** runtime error, **2** validation/usage error.

> Flag names and defaults below are drawn from the source. Run any command with no/invalid arguments to see its usage, and `neksur-cli <command> -h` for the live flag list.

## `neksur-cli`

The operator CLI. Subcommands are grouped below.

### Tenant management

#### tenant create

Create a tenant (public row, per-tenant AGE graph, Postgres role).

```bash
neksur-cli tenant create --tenant-uuid <uuid> --workos-org org_ABC123
```

| Flag | Required | Description |
|------|----------|-------------|
| `--tenant-uuid` | yes | Tenant UUID (v4). |
| `--workos-org` | yes | WorkOS organization ID. |

Env: `DATABASE_URL`.

#### tenant migrate

Apply tenant-loop migrations.

```bash
neksur-cli tenant migrate --tenant-uuid <uuid> --step bootstrap-schema
neksur-cli tenant migrate --tenant-uuid <uuid> --step apply-versioned
neksur-cli tenant migrate --step backfill-create-fns         # cluster-wide
```

| Flag | Required | Description |
|------|----------|-------------|
| `--step` | yes | `bootstrap-schema` \| `apply-versioned` \| `backfill-create-fns`. |
| `--tenant-uuid` | for the first two steps | Target tenant. |

#### tenant migrate-to-pool-b

Migrate a tenant from the shared Pool A to a dedicated Pool B (pg_dump/restore with row-count validation).

```bash
neksur-cli tenant migrate-to-pool-b \
  --tenant-uuid <uuid> \
  --pool-b-endpoint pool-b.example.com:5432 \
  --kms-key-arn arn:aws:kms:us-east-1:...:key/... \
  --yes
```

Key flags: `--pool-b-endpoint` (req), `--kms-key-arn` (req), `--yes` (req — confirms the downtime window), `--pool-b-dsn`, `--instance-class` (default `r6g.large`), `--dump-path`, `--actor`, `--keep-dump`. Env: `DATABASE_URL`, and `POOL_B_ADMIN_USER`/`POOL_B_ADMIN_PASSWORD` if `--pool-b-dsn` is omitted.

#### tenant suspend / wind-down / delete

```bash
neksur-cli tenant suspend   --tenant-uuid <uuid>            # active → suspended (read-only)
neksur-cli tenant wind-down --tenant-uuid <uuid>            # → 30-day read-only window
neksur-cli tenant delete    --tenant-uuid <uuid> --yes      # IRREVERSIBLE: drop schema + peering
```

`delete` requires `--yes`; it also needs `TF_DIR` unless `--skip-terraform`. All three accept `--actor` (audit identity).

#### tenant smoke / cert-issue / peer

```bash
# Post-provisioning smoke tests (audit edge, policy fetch, cross-tenant probe)
neksur-cli tenant smoke --tenant-uuid <uuid> [--probe-tenant-uuid <other>]

# Issue a per-customer mTLS client cert via AWS Private CA (PEM to stdout)
neksur-cli tenant cert-issue --tenant-uuid <uuid> > client.pem

# VPC peering (customer side): initiate / poll / print customer module
neksur-cli tenant peer --tenant-uuid <uuid> --customer-vpc vpc-... --customer-region us-east-1
neksur-cli tenant peer --tenant-uuid <uuid> --status
neksur-cli tenant peer --tenant-uuid <uuid> --show-customer-module
```

`cert-issue` honors `PRIVATE_CA_ARN` (returns a mock bundle if unset or `PROVISION_MOCK_PRIVATE_CA=1`). `peer` (initiate) needs `DATABASE_URL` and `TF_DIR`.

### Policy

#### policy compile

Validate a CEL policy file against the gateway evaluation environment.

```bash
neksur-cli policy compile ./policies/no-ssn.cel
```

Exit `0` = compiles cleanly; `1` = CEL error / undeclared binding; `2` = file/usage error. See [Author Access policies](../guides/author-access-policies.md).

### Catalog

#### catalog discover

Discover an upstream catalog's tables into the tenant's graph (also the way to wire a `{prefix}` for the gateway).

```bash
# from a stored catalog credential
neksur-cli catalog discover --tenant-uuid <uuid> --nickname meridian \
  --namespaces catalog,crm,sales,marketing

# or direct Polaris details (local/dev)
neksur-cli catalog discover --tenant-uuid <uuid> \
  --polaris-endpoint http://localhost:8181/api/catalog \
  --warehouse my-warehouse --client-id ... --client-secret ...
```

`--nickname` (default `meridian`) selects the credential and becomes the gateway URL `{prefix}`. `--namespaces` defaults to `catalog,crm,sales,marketing`.

### Semantic (OSI)

#### osi import / export

```bash
neksur-cli osi import --tenant <uuid> --dialect cube ./model.yml
neksur-cli osi export --tenant <uuid> --model order_analytics --dialect cube
```

`--dialect` is `cube` (the supported OSI dialect). `--socket` overrides the compiler sidecar socket (`NEKSUR_COMPILER_SOCKET`, default `/var/run/neksur/compiler.sock`). See [Author semantic metrics](../guides/author-semantic-metrics.md).

### Fiscal calendars

#### fiscal-calendar provision

Pre-populate period boundaries for a pattern + year range.

```bash
neksur-cli fiscal-calendar provision <tenant-uuid> \
  --pattern 4-4-5 --fy-start-month 2 --years 2020-2030 --calendar-name retail
```

`--pattern` (`4-4-5` | `4-5-4` | `5-4-4` | `monthly` | `N-N-N`, default `4-4-5`), `--fy-start-month` (default `2`), `--years` (default `2020-2030`), `--calendar-name` (default `default`).

### Polaris webhook

#### polaris webhook-register

Register Neksur as a Polaris webhook subscriber (detection trigger). Prints the generated HMAC secret.

```bash
neksur-cli polaris webhook-register --tenant <uuid> \
  --polaris-endpoint https://polaris.acme.com/api/catalog \
  --neksur-webhook https://neksur.acme.com/v1/webhooks/polaris
```

`--skip-upstream` generates the secret locally without calling Polaris.

## `neksur-server`

The main backend binary — REST/GraphQL/MCP, the catalog gateway, the read-path proxy, detection, lineage, admin. It selects a deployment mode via `NEKSUR_DEPLOY_MODE` (`cloud` or `onprem`) and reads the rest of its configuration from the environment. See the [Deployment runbook](../operations/deploy.md#environment-variables) for the full variable list; the essentials are `DATABASE_URL`, the auth variables for the chosen mode, `NEKSUR_LISTEN_ADDR` (default `:8080`), and `NEKSUR_OBSERVABILITY=1`. The read-path listeners (SQL proxy / `pgwire` / XMLA) and TLS are configured via their own variables (e.g. `NEKSUR_SQLPROXY_ADDR`, `NEKSUR_TLS_CERT_PATH`/`NEKSUR_TLS_KEY_PATH`/`NEKSUR_CA_BUNDLE_PATH`).

## Other binaries

| Binary | Purpose | Notes |
|--------|---------|-------|
| `migrate` | Atlas multi-tenant migration runner. | `go run ./cmd/migrate` — flags `--bootstrap`, `--tenant <schema>`, `--skip-public`. Auto-bootstraps a fresh DB. Env `DATABASE_URL`. |
| `neksur-verify-chain` | Offline audit-chain verification. | See [Compliance and audit](../guides/compliance-and-audit.md). Flags: `--tenant-uuid`, `--database-url`, `--kms-key-arn` or `--public-key-pem`, `--table audit_log\|audit_events`, `--output text\|json`, `--from-id`/`--to-id`. |
| `neksur-worker` | Background detection worker. | |
| `neksur-gateway-dev` | Local dev harness for the read-path SQL proxy (plaintext, no mTLS). | Dev only. Env `DATABASE_URL`, `NEKSUR_TENANT`, `NEKSUR_TRINO_URI`, `GATEWAYD_DEV_ADDR`. |
| `license-gen` | Generate signed license manifests. | Private-key ceremony per operator runbook; run with `-h`. |

## See also

- [Deployment runbook](../operations/deploy.md) — environment variables, HA, backup/DR.
- [Policy language reference](./policy-language.md)
- [REST API reference](./rest-api.md)
