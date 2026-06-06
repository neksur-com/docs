<!-- generated-by: gsd-doc-writer -->

# Deployment

This is the canonical guide for deploying Neksur to production AWS. It covers the commit data path in depth — the metadata graph, the catalog gateway, OpenLineage ingestion, and the in-process detection pool — running as a stateless `cmd/neksur-server` binary behind an Application Load Balancer. The same binary also serves the read-path SQL proxy, `pgwire`, XMLA, GraphQL, and MCP surfaces; the operational concerns below (HA, fail-closed alerting, health checks, backup/DR) apply to the whole process.

For the **infrastructure-as-code**, **deployment modes** (SaaS / self-managed / air-gapped), and the **Spark writer-side integration**, see the new sections near the end of this guide. The target audience is the SRE / platform team operating Neksur for a single tenant or a small fleet of tenants.

> **Editions.** Neksur is a single binary; commercial-tier coordination (multi-engine, defense-in-depth, intelligence) is unlocked by a signed license verified at startup — there is no separate build to deploy. See [Editions and tiers](../concepts/editions.md).

> **Companion docs.** Read [Architecture](../architecture/overview.md) before this guide — the three-layer enforcement model and the AGE graph foundation set the context for every infrastructure choice below. After install, see [Getting Started](../getting-started/install-and-first-policy.md) for the end-to-end dev flow and the [REST API Reference](../reference/rest-api.md) for the endpoint surface the gateway exposes.

## Prerequisites

Operators bringing up a new Neksur deployment need the following before they start:

- **AWS account** with permissions to provision RDS (Postgres 16 + AGE 1.6), an Application Load Balancer, an EC2 Auto Scaling Group, ACM certificates, Secrets Manager entries, and (optionally) SNS + SQS for S3 ObjectCreated event delivery. <!-- VERIFY: Exact IAM policy bundle for the deploy role lives in `neksur-com/infra` Terraform. -->
- **Terraform CLI** 1.6+ for driving the private `neksur-com/infra` repository that holds the production Terraform modules. <!-- VERIFY: Terraform module versions and module-path layout in `neksur-com/infra`. -->
- **Iceberg catalog endpoint** — a reachable Apache Polaris OR Project Nessie instance. Phase 1 ships live adapters for both; Glue and Unity Catalog adapters are stub-only and rejected at startup until Phase 3.
- **OIDC identity provider** — WorkOS is the Phase 0.5 / Phase 1 default; `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, and `WORKOS_WEBHOOK_SECRET` must be available in Secrets Manager before the gateway will start in SaaS mode.
- **Go 1.24+** on the build host if you are baking your own AMI rather than consuming a published artifact.

Optional but strongly recommended for production:

- **PagerDuty integration key** — populates `${PAGERDUTY_INTEGRATION_KEY}` in `alertmanager.yml` and routes `severity=page` alerts (most importantly `PolicyEngineUnavailableAlert`) to the on-call rotation.
- **Slack incoming webhook URL** — populates `${SLACK_WEBHOOK_URL}` for `severity=warn` alerts (e.g., `PolicyDeniedSpikeAlert`) and, separately, `NEKSUR_SLACK_WEBHOOK_URL` for L3 detection findings at confidence ≥ 0.85.
- **AWS Secrets Manager** for all of the above; `cmd/neksur-server/main.go` reads them as plain env vars, and Phase 1 production deployments inject them via the Terraform layer. <!-- VERIFY: Secrets Manager → ECS env var injection mapping lives in `neksur-com/infra`. -->

A staging tenant with a single replica is acceptable for evaluation; **production tenants MUST run with ≥ 2 replicas** behind the ALB — see [HA + scaling](#ha--scaling) below for the rationale.

## Reference architecture

The Phase 1 production topology is a single-region AWS deployment with a stateless gateway tier in front of a shared metadata RDS and an optional SQS event source. The diagram below is the operator's-eye map; for the per-commit pipeline that runs inside each replica, see [Architecture](../architecture/overview.md).

```mermaid
graph TD
    Client["Iceberg client<br/>(Spark / Trino / pyiceberg)"]
    ALB["AWS ALB<br/>TLS termination<br/>health check: GET /readyz"]
    R1["neksur-server replica 1<br/>L1 gateway + L3 pool<br/>(in-process)"]
    R2["neksur-server replica 2<br/>L1 gateway + L3 pool"]
    R3["neksur-server replica N<br/>(ASG: min 2, max 4)"]
    RDS["Postgres 16 + AGE 1.6<br/>(Pool A, RDS Multi-AZ<br/>for production)"]
    Upstream["Upstream Iceberg catalog<br/>(Polaris / Nessie)"]
    S3["S3 bucket<br/>(Iceberg data + metadata)"]
    SNS["SNS topic<br/>(S3 ObjectCreated, optional)"]
    SQS["SQS queue<br/>(shared, competitive consume)"]
    Prom["Prometheus<br/>scrape :9100/metrics"]
    AM["AlertManager<br/>severity-tier routing"]
    PD["PagerDuty<br/>severity=page"]
    Slack["Slack<br/>severity=warn + L3 findings"]

    Client -->|HTTPS 443| ALB
    ALB -->|HTTP 8080| R1
    ALB -->|HTTP 8080| R2
    ALB -->|HTTP 8080| R3
    R1 --> RDS
    R2 --> RDS
    R3 --> RDS
    R1 -->|forward commits| Upstream
    R2 -->|forward commits| Upstream
    R3 -->|forward commits| Upstream
    S3 --> SNS
    SNS --> SQS
    SQS -->|competitive consume| R1
    SQS -->|competitive consume| R2
    SQS -->|competitive consume| R3
    R1 -.->|/metrics :9100| Prom
    R2 -.->|/metrics :9100| Prom
    R3 -.->|/metrics :9100| Prom
    Prom --> AM
    AM -->|severity=page| PD
    AM -->|severity=warn| Slack
```

Component notes:

- **ALB** terminates TLS on port 443 with an ACM certificate. <!-- VERIFY: ACM certificate ARN and DNS validation records live in `neksur-com/infra`. --> Target group health check probes `GET /readyz` (NOT `/healthz` — see [Health-check endpoints](#health-check-endpoints) below). Routes `POST /v1/iceberg/*`, `POST /v1/lineage`, `POST /v1/webhooks/polaris`, plus `/api/*`, `/admin/*`, `/callback`, `/webhooks/workos`, and `/webhooks/stripe` to the gateway target group.
- **`neksur-server` ECS / EC2 replicas** are stateless from the operator's perspective for traffic routing — any replica can serve any commit. The L3 detection dedup map is in-process per replica, but cross-replica dedup is enforced at the database layer by the `detection_runs.snapshot_metadata_location` UNIQUE constraint, so a replica restart is safe. Auto-Scaling Group sized 2 → 4. <!-- VERIFY: ASG launch template, instance type, and capacity bounds live in `neksur-com/infra`. -->
- **Postgres 16 + AGE 1.6 RDS** is the canonical metadata store ("Pool A"). Single-AZ is acceptable for non-prod; **Multi-AZ is required for production** so a single-AZ outage does not stop commit traffic. Each gateway replica opens its own `pgxpool` with the `BeforeAcquire DISCARD ALL` hook applied; do not add a second pool inside the gateway process. <!-- VERIFY: RDS instance class, storage sizing, parameter group, and Multi-AZ flag live in `neksur-com/infra`. -->
- **S3 + SNS + SQS** is optional and only required when the L3 detection trigger needs to catch direct-to-S3 writes that bypass the gateway. When `NEKSUR_S3_EVENTS_QUEUE_URL` is unset, only the 30-second poller and the Polaris webhook fire and the SQS goroutine is not started. The SQS queue is shared across replicas and consumed competitively; the first replica to call `ReceiveMessage` + `DeleteMessage` wins each message.
- **Upstream Iceberg catalog** is your existing Polaris or Nessie deployment. Neksur does not replace it — the gateway proxies commits through to it after policy evaluation. Glue and Unity Catalog adapters are stub-only in Phase 1 and the gateway rejects configurations with `catalog_kind = "glue"` or `"unity"` at startup.
- **Prometheus + AlertManager** scrape each replica's `/metrics` endpoint on port `:9100` and apply severity-tier routing (`severity=page` → PagerDuty; `severity=warn` → Slack). See [Observability](#observability) for the alert definitions.

Production-specific infrastructure details — Terraform module names, VPC subnet layout, security group rules, IAM role bundles, DNS records — live in the private `neksur-com/infra` repository and are not enumerated here. <!-- VERIFY: All `neksur-com/infra` references in this document need re-verification once that repo goes public. -->

## Environment variables

Every variable below is read by `cmd/neksur-server/main.go` (the Phase 1 entry point). Production deployments source these from AWS Secrets Manager or env injection at the orchestrator layer; local dev uses `.env`-style overrides.

```yaml
# Core toggle and observability
NEKSUR_SAAS_AUTH: "1"                       # REQUIRED in prod — enables runWithSaasAuth (gateway + L3)
NEKSUR_OBSERVABILITY: "1"                   # REQUIRED in prod — enables OTLP exporter + Prom /metrics
NEKSUR_METRICS_ADDR: ":9100"                # Optional override; must match prometheus.yml scrape target
NEKSUR_LISTEN_ADDR: ":8080"                 # Optional override for the HTTP listener

# Database (Pool A — Postgres 16 + AGE 1.6)
DATABASE_URL: "postgres://neksur:...@..."   # REQUIRED — pgxpool DSN; BeforeAcquire DISCARD ALL applied

# WorkOS auth (Phase 0.5 stack)
WORKOS_API_KEY: "sk_live_..."               # REQUIRED
WORKOS_CLIENT_ID: "client_..."              # REQUIRED
WORKOS_WEBHOOK_SECRET: "whsec_..."          # REQUIRED — verified BEFORE SCIM_ENABLED check
WORKOS_INTERNAL_ADMIN_ORG_ID: "org_..."     # REQUIRED for /admin/* surface

# L3 detection pool (in-process)
NEKSUR_L3_WORKERS: "4"                      # Optional; default 4. Raise to 8 if scan lag accumulates
NEKSUR_POLARIS_WEBHOOK_ENABLED: "1"         # Optional; "0" returns 410 Gone on /v1/webhooks/polaris
NEKSUR_S3_EVENTS_QUEUE_URL: ""              # Optional; when set, starts the SQS long-poll goroutine
NEKSUR_S3_EVENTS_TENANT_ID: ""              # CONDITIONAL — required iff NEKSUR_S3_EVENTS_QUEUE_URL is set
NEKSUR_SLACK_WEBHOOK_URL: ""                # Optional; when unset, alerts.Slack.Post is a silent no-op

# Billing (only when BILLING_ENABLED=true)
BILLING_ENABLED: "false"                    # Optional toggle
STRIPE_API_KEY: ""                          # CONDITIONAL when BILLING_ENABLED=true
STRIPE_WEBHOOK_SECRET: ""                   # REQUIRED — verified BEFORE BILLING_ENABLED check

# AWS integration
AWS_REGION: "us-east-1"                     # REQUIRED when NEKSUR_S3_EVENTS_QUEUE_URL is set
PAGERDUTY_SERVICE_ID: "P000000"             # Optional; embedded in /admin/incidents UI
```

Per-variable reference:

| Variable | Required | Default | Controls |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Pool A RDS DSN. `pgxpool` config receives `BeforeAcquire DISCARD ALL` — the load-bearing session-bleed prevention. Never spawn a second pool. |
| `NEKSUR_SAAS_AUTH` | yes (prod) | `0` | Master switch for the SaaS auth + gateway stack. Set to `1` to mount `/api/*`, `/v1/iceberg/*`, `/v1/lineage`, `/v1/webhooks/polaris`, `/admin/*`. |
| `NEKSUR_OBSERVABILITY` | yes (prod) | `0` | Enables the OTLP gRPC trace exporter (defaults to `localhost:4317`) and the Prometheus `/metrics` server. Must be `1` for the alert rules in [Observability](#observability) to have data. |
| `NEKSUR_METRICS_ADDR` | no | `:9100` | Listener for `/metrics`. Must match the `neksur-graph` scrape target in `observability/prometheus.yml`. |
| `NEKSUR_LISTEN_ADDR` | no | `:8080` | HTTP listener for the gateway + admin routes. ALB target group forwards to this port. |
| `WORKOS_API_KEY` | yes | — | WorkOS API key (Phase 0.5). Used by `workosauth.NewClient` for session validation in `TenantMiddleware`. |
| `WORKOS_CLIENT_ID` | yes | — | WorkOS OAuth client ID. |
| `WORKOS_WEBHOOK_SECRET` | yes | — | HMAC secret for `POST /webhooks/workos`. Signature is verified BEFORE the SCIM_ENABLED check. |
| `WORKOS_INTERNAL_ADMIN_ORG_ID` | yes | — | WorkOS Org ID for Neksur staff. `/admin/*` returns 403 unless the session's org matches. |
| `NEKSUR_L3_WORKERS` | no | `4` | Goroutine-pool size for the in-process L3 detection workers. Raise to `8` if commit traffic is healthy but the detection trigger queue is backing up. |
| `NEKSUR_POLARIS_WEBHOOK_ENABLED` | no | `1` | Set to `0` to return `410 Gone` on `POST /v1/webhooks/polaris` when the upstream Polaris lacks webhook signing. |
| `NEKSUR_S3_EVENTS_QUEUE_URL` | no | unset | When set, starts the SQS long-poll goroutine that drains S3 ObjectCreated events. Format: `https://sqs.<region>.amazonaws.com/<acct>/<queue>`. Leave unset to rely on the 30-second poller + Polaris webhook only. |
| `NEKSUR_S3_EVENTS_TENANT_ID` | conditional | unset | REQUIRED iff `NEKSUR_S3_EVENTS_QUEUE_URL` is set. Phase 1 simplification: one queue per tenant. |
| `NEKSUR_SLACK_WEBHOOK_URL` | no | unset | When unset, the Slack client is a silent no-op so the gateway can ship before Slack is configured. Set to `https://hooks.slack.com/services/...` to enable L3-finding alerts at confidence ≥ 0.85. |
| `STRIPE_WEBHOOK_SECRET` | yes when `BILLING_ENABLED=true` | — | Phase 0.5 — verified BEFORE the `BILLING_ENABLED` branch so spoofed Stripe webhooks are rejected even when billing is off. |
| `BILLING_ENABLED` | no | `false` | Toggles `billing.NewBilling` between the real Stripe path and a no-op stub. |
| `STRIPE_API_KEY` | conditional | — | Stripe secret key; only consumed when `BILLING_ENABLED=true`. |
| `AWS_REGION` | conditional | — | REQUIRED when `NEKSUR_S3_EVENTS_QUEUE_URL` is set OR when CloudWatch metric posting is enabled. |
| `PAGERDUTY_SERVICE_ID` | no | `P000000` | Embedded into the `/admin/incidents` page as a deep-link to the PagerDuty dashboard. |
| `ICEBERG_REST_BEARER` | conditional | — | OAuth bearer token used by `scripts/ci/phase1-gateway-overhead.sh` for the nightly overhead drill against both the direct-Polaris baseline and the gateway. Production runtime does not read this directly. |

Per-tenant catalog credentials (the upstream Polaris / Nessie URL, OAuth client_id/client_secret, webhook HMAC secret) are stored in the per-tenant `catalog_credentials` table — they are NOT environment variables. See the saas-onboarding runbook below for the provisioning workflow.

## Tenant onboarding workflow

For the local-dev / single-tenant flow — provisioning a tenant, pointing Spark at the gateway, authoring a first policy — see [Getting Started](../getting-started/install-and-first-policy.md).

For the production multi-tenant flow — the 12-step idempotent provisioning script that creates the per-tenant schema, seeds catalog credentials, and registers the tenant in WorkOS — see the source-repo runbook:

- [`runbooks/saas-onboarding.md`](https://github.com/neksur-com/neksur/blob/main/runbooks/saas-onboarding.md) — drives `./scripts/provision-tenant.sh` end-to-end. Validation tests live at `tests/integration/provisioning_test.go::TestProvisioningIdempotent`.

The provisioning script is idempotent at the per-step level: re-running it after a failure resumes from the failed step rather than restarting from scratch.

## Observability

Phase 1 ships two Prometheus alert rules in `observability/rules/phase1-commit-rejected.yml`. Both fire off the `commit_rejected_total{reason}` CounterVec emitted by `internal/observability/metrics.go` and incremented by the gateway on every rejection.

### `PolicyEngineUnavailableAlert` (severity=page)

This is the **most critical alert in Phase 1**. It fires when the L1 Catalog Gateway is rejecting customer Iceberg commits with HTTP 503 fail-closed at a non-zero rate sustained one minute. Per the fail-closed contract, when the policy engine cannot prove a commit is allowed, the commit is REJECTED rather than allowed-by-default — customers writing via Spark / Trino / Snowflake see their commit fail and cannot work around it.

```yaml
groups:
  - name: phase1.commit_rejected
    interval: 30s
    rules:
      - alert: PolicyEngineUnavailableAlert
        expr: sum(rate(commit_rejected_total{reason="policy_engine_unavailable"}[1m])) > 0
        for: 1m
        labels:
          severity: page
          phase: "1"
          component: gateway
          contract: D-1.09
        annotations:
          summary: "Neksur L1 Catalog Gateway is rejecting commits with 503 policy-engine-unavailable (fail-closed)"
          runbook_url: "https://github.com/neksur-com/neksur/blob/main/runbooks/commit-rejected-503-rate.md"
```

Wakes the on-call rotation within one minute of breach. Two fail-closed sub-paths both increment the same label:

1. **Policy fetch failure** — `store.AGEStore.LoadPoliciesForTable` returned a non-nil error. Usually a DB transport error (pool exhausted, RDS failover in flight, RLS GUC unset because `TenantMiddleware` was not in the chain).
2. **Policy evaluation failure** — `cel.Evaluator.Evaluate` returned a non-nil error. Compile error (rare in steady state), eval error, non-bool return, or eval-time panic recovered by the `defer/recover` in `internal/policy/cel/eval.go`.

The runbook distinguishes the sub-paths via slog log messages and routes the page accordingly:

- [`runbooks/commit-rejected-503-rate.md`](https://github.com/neksur-com/neksur/blob/main/runbooks/commit-rejected-503-rate.md) — full incident response procedure with a four-branch diagnosis tree (DB unreachable, CEL compiler uninitialised, customer policy malformed, RLS GUC missing).

### `PolicyDeniedSpikeAlert` (severity=warn)

Trend signal — routes to Slack `#oncall-warn`, does NOT wake on-call. Fires when `commit_rejected_total{reason="policy_denied"}` rate exceeds 10/sec sustained five minutes. Normal `403` denials are business-as-usual traffic (customer policies correctly blocking non-conforming commits); a sustained spike suggests a recent policy push tightened too aggressively, a misconfigured Spark client is hammering the gateway, or a malicious actor is probing.

```yaml
- alert: PolicyDeniedSpikeAlert
  expr: sum(rate(commit_rejected_total{reason="policy_denied"}[5m])) > 10
  for: 5m
  labels:
    severity: warn
    phase: "1"
    component: gateway
```

### Alert routing

Routing is severity-tier-driven in `observability/alertmanager.yml`:

```yaml
route:
  receiver: pagerduty    # default — fail-safe if label match misses
  routes:
    - matchers: [severity = "page"]
      receiver: pagerduty
    - matchers: [severity = "warn"]
      receiver: slack
```

`severity=page` alerts inject `${PAGERDUTY_INTEGRATION_KEY}` (per-deployment Secrets Manager value). `severity=warn` alerts post to `${SLACK_WEBHOOK_URL}` and land in `#oncall-warn`. Phase 0 sibling alerts (`CypherP99LatencyBreach`, `ClockSkewPage`, `ClockSkewWarn`) inherit the same routing tree.

### Other Phase 1 metrics

The same `/metrics` endpoint also exposes:

- `commit_rejected_total{reason="policy_denied"}` — the 403 counter (drives `PolicyDeniedSpikeAlert`).
- `cypher_duration_ms_bucket` — Phase 0 histogram of every AGE Cypher query's duration; drives the Phase 0 `CypherP99LatencyBreach` alert (see [`runbooks/cypher-latency-breach.md`](https://github.com/neksur-com/neksur/blob/main/runbooks/cypher-latency-breach.md)).
- OTel trace spans via the OTLP gRPC exporter (`localhost:4317` by default) — landed into the OTel collector for distributed tracing.

To verify the rule file is mounted into Prometheus after a deploy:

```bash
curl -sS http://prometheus:9090/api/v1/rules \
  | jq '.data.groups[].rules[].name' \
  | grep PolicyEngineUnavailableAlert
# Expected: "PolicyEngineUnavailableAlert"
```

If the rule is not present, `infra/prometheus/prometheus.yml` is not loading `rules/phase1-commit-rejected.yml` — re-mount the file and reload Prometheus.

## The ≤5% gateway overhead invariant

Phase 1 ships with a hard performance contract: **the L1 gateway adds no more than 5% P95 commit latency overhead compared to a direct write to the upstream Polaris catalog** (ADR-003 §3.3). The contract is mechanically verified by `scripts/ci/phase1-gateway-overhead.sh`, which runs nightly via GitHub Actions (`.github/workflows/phase1-overhead-nightly.yml`).

The driver script:

```bash
go run ./tests/load/cmd/gateway_overhead \
    -assert-overhead-under=0.05 \
    -commit-count=1000 \
    -warmup=100 \
    -baseline-url="$POLARIS_BASELINE_URL" \
    -gateway-url="$GATEWAY_URL" \
    -bearer="$ICEBERG_REST_BEARER" \
    -baseline-out=tests/load/gateway-overhead-baseline.json
```

A miss (overhead > 5%) exits non-zero and fires the nightly-cron alert. The wall-clock duration is posted to CloudWatch as `Neksur/Phase1/GatewayOverheadDrillDurationSec` regardless of pass/fail so the dashboard always reflects the latest observed drill duration.

Operators should expect this gate to run on every nightly CI invocation. A regression here is a Phase 1 acceptance contract violation; bumping `iceberg-go` past v0.5.0 invalidates the baseline JSON and requires a fresh nightly baseline before the bump can land. The script is at [`scripts/ci/phase1-gateway-overhead.sh`](https://github.com/neksur-com/neksur/blob/main/scripts/ci/phase1-gateway-overhead.sh) and the baseline JSON at `tests/load/gateway-overhead-baseline.json`.

## HA + scaling

### Topology

Production tenants run **≥ 2 `neksur-server` replicas behind a single ALB**. The HA topology is the operational mitigation for the fail-closed semantics of the policy engine: a single-replica deployment that fail-closes pages on every commit, because there is no sibling replica to absorb traffic while the broken one is replaced. ASG sized 2 → 4.

### Health-check endpoints

Two endpoints — operators MUST wire the ALB target group health check to `/readyz`, not `/healthz`:

| Endpoint | Returns 200 iff … | Use for |
|---|---|---|
| `GET /healthz` | pgxpool reachable AND `SELECT 1` against AGE LOAD succeeds | Liveness probe — ASG instance-replacement trigger |
| `GET /readyz` | `/healthz` AND CEL compiler initialised AND detection pool started | **ALB target group health check** |

The distinction is load-bearing: when the CEL compiler env fails to initialise, the replica's `/healthz` still returns 200 (Postgres is fine) but `/readyz` returns 503. The ALB removes the replica from rotation; ASG eventually replaces it. The sibling replica handles 100% of commit traffic without paging on fail-closed 503s.

ALB target-group health-check config:

```yaml
health_check:
  enabled: true
  path: /readyz          # NOT /healthz
  protocol: HTTP
  matcher: "200"
  interval: 15
  timeout: 5
  healthy_threshold: 2
  unhealthy_threshold: 2
```

### Statefulness caveats

The gateway is **stateless for routing purposes** — any replica can serve any commit — but two pieces of state live in-process per replica:

1. **L3 detection dedup map** — a `sync.Map` keyed by `metadata_location` deduplicates scans within a single replica. A replica restart wipes the map; cross-replica dedup is enforced at the DB layer by the `detection_runs.snapshot_metadata_location` UNIQUE constraint, so a duplicated scan request between two replicas results in one successful insert and one `ON CONFLICT DO NOTHING`.
2. **CEL compiled-program cache** — the `cel.Compiler` LRU cache keys by `(policy_id, policy_text)`. A restart re-warms the cache on first eval of each policy.

Neither piece of state is durable; both are tolerant of restart.

### Pool A vs Pool B

The Phase 1 deployment uses **Pool A** — a single shared Postgres + AGE RDS cluster for tenant metadata. "Pool B" is the planned per-tenant or sharded-pool model introduced in Phase 2+ for tenants whose workload exceeds the Pool A envelope (10M nodes / 50M edges per the Phase 0 capacity contract). Phase 1 deployments are Pool A only; Pool B migration is documented in the source repo at [`runbooks/pool-b-migration.md`](https://github.com/neksur-com/neksur/blob/main/runbooks/pool-b-migration.md) and is not exercised today.

### Scaling triggers

The gateway is I/O bound (most time waiting on upstream Polaris + Postgres); the dominant scaling signal is the rejection rate, NOT CPU:

| Metric | Threshold | ASG action |
|---|---|---|
| `sum(rate(commit_rejected_total{reason="policy_engine_unavailable"}[1m])) > 0` sustained 30s | scale-out 2 → 4 replicas |
| `histogram_quantile(0.95, sum(rate(neksur_gateway_commit_duration_ms_bucket[5m])) by (le)) > 250` | scale-out +1 replica |
| Replica count < 2 for any reason | page — manual investigation |

Auto-scaling rules beyond these basic triggers (predictive scaling, target-tracking on multiple metrics) are a Phase 4+ roadmap item.

### Deploy procedure (rolling blue-green)

The full deploy procedure — AMI bake, ASG instance refresh with `MinHealthyPercentage=50` and `InstanceWarmup=60`, mid-deploy `/readyz` verification, and rollback to the last-known-good AMI — is documented in the source repo at [`runbooks/gateway-deploy.md`](https://github.com/neksur-com/neksur/blob/main/runbooks/gateway-deploy.md). The rolling refresh guarantees ≥ 2 replicas during the entire deploy window.

A successful deploy ends with a smoke test that:

1. Curls `/readyz` across the entire fleet, expecting `200` from every replica.
2. Posts a no-op commit to the seeded health-probe table (`/v1/iceberg/test-polaris/namespaces/health/tables/probe`), expecting `200` (or `403` if a deny-all health-probe policy is in place — both are healthy outcomes; `503` indicates fail-closed).
3. Verifies `commit_rejected_total{reason="policy_engine_unavailable"}` is flat.
4. Verifies the Polaris webhook route is mounted (a signature-less `POST /v1/webhooks/polaris` returns `401`, NOT `410`).

If any smoke step fails, capture `journalctl -u neksur-server -n 200` on the affected replica and either re-resolve or roll back per the runbook's §5.4.

## Backup, recovery, DR

The metadata graph is the only durable state Neksur owns. Backup and disaster-recovery procedures live in the source repo:

- [`runbooks/restore-pitr.md`](https://github.com/neksur-com/neksur/blob/main/runbooks/restore-pitr.md) — pgBackRest point-in-time restore. Contract: RTO 1 hour / RPO 15 minutes (unified across all metadata stores, locking ADR-001 D-001.13). Validation test: `tests/dr/restore_pit.sh` wrapped by `TestRTO_RestorePIT` in `tests/dr/dr_targets_test.go` under build tag `dr`.
- [`runbooks/dr-drill.md`](https://github.com/neksur-com/neksur/blob/main/runbooks/dr-drill.md) — monthly drill that exercises the full restore + chaos-restore RPO arm. Validation test: `tests/dr/run_monthly_restore_drill.sh` wrapped by `TestMonthlyRestoreDrill`. The DR drill is the single attestation that the RTO/RPO contract still holds after any infra change.
- [`runbooks/failover.md`](https://github.com/neksur-com/neksur/blob/main/runbooks/failover.md) — Patroni / RDS failover procedure for the Pool A cluster.

The pgBackRest repository, WAL streaming configuration, and S3 bucket for backup storage live in the private `neksur-com/infra` Terraform. <!-- VERIFY: pgBackRest repo bucket name, retention policy, and KMS key ARN live in `neksur-com/infra`. -->

## Secret rotation

Operators rotate the Phase 0.5 / Phase 1 secrets on a quarterly cadence (or ad-hoc on known compromise). The full rotation procedure for every secret — including the WorkOS API key, the Stripe webhook secret, the database master credential, and per-tenant catalog credentials — is documented in the source repo at [`runbooks/secret-rotation.md`](https://github.com/neksur-com/neksur/blob/main/runbooks/secret-rotation.md).

Specific secrets operators should rotate:

- **Per-tenant `catalog_credentials.client_secret`** — the OAuth client_secret used by the gateway when forwarding commits to the upstream Polaris / Nessie. Rotated per tenant; the rotation procedure issues a new credential, updates the DB row, and verifies a smoke-test commit before invalidating the old credential.
- **Per-tenant Polaris webhook HMAC secret** — `catalog_credentials.config_json[webhook_secret]`. Used by `POST /v1/webhooks/polaris` to verify incoming webhook signatures. Rotated coordinated with the upstream Polaris instance so the signature contract holds.
- **`NEKSUR_SLACK_WEBHOOK_URL`** — the Slack incoming webhook for L3 detection findings. Replace via Slack admin UI and update the Secrets Manager entry; the gateway picks up the new value on next restart.
- **`${PAGERDUTY_INTEGRATION_KEY}`** in `alertmanager.yml` — the PagerDuty service integration key. Rotated via the PagerDuty admin UI.
- **`WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_WEBHOOK_SECRET`** — the auth-layer secrets. Coordinated with WorkOS admin UI; the gateway picks up the new values on next restart.
- **`STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`** — the billing-layer secrets, when `BILLING_ENABLED=true`.

The rotation runbook contains the per-secret step-by-step procedure and the validation commands operators run after each rotation.

## Infrastructure as code (`neksur-infra`)

The production AWS infrastructure lives in the private [`neksur-com/neksur-infra`](https://github.com/neksur-com/neksur-infra) Terraform repository (Terraform ≥ 1.7, AWS provider ~> 5.86). It provisions a single-region (`us-east-1`) topology:

| Module | Provisions |
|--------|------------|
| `vpc` | 10.0.0.0/16 across 3 AZs, public + private subnets, single NAT (cost-optimized), DNS hostnames enabled (required for customer VPC peering). |
| `rds-pool-a` | **Postgres-on-EC2** HA cluster — Patroni-managed (etcd leader election), Graviton instances + EBS, Postgres 16 + Apache AGE + pgaudit, pgBackRest to S3 (7-day full + 35-day WAL → 35-day PITR window). Postgres-on-EC2 rather than managed RDS because AGE is a non-standard extension. |
| `rds-pool-b` | Dedicated standby pool for tenants whose workload exceeds the Pool A envelope; activated when the first dedicated-pool tenant arrives. |
| `ec2-host` | Application Auto Scaling Group (Docker Compose runtime, IMDSv2 enforced) across private subnets. |
| `alb-nlb` | Public ALB (HTTPS 443) + internal NLB (for the `pgwire` 5432 read path); ACM cert pinning the app / admin / sql / lineage / status hostnames. |
| `private-ca` | Self-signed root CA + per-customer subordinate CAs for mTLS; keys in Secrets Manager (KMS). |
| `observability` | CloudWatch Alarms → SNS → PagerDuty bridge (Lambda) → StatusPage. |
| `billing-secrets` | KMS-encrypted Secrets Manager slots (WorkOS, Stripe, PagerDuty, StatusPage, Slack), populated post-apply. |
| `customer-peering` | VPC peering (Neksur side); customers consume a shared peering module on their side. |

State is in S3 (`neksur-tfstate`) with a DynamoDB lock table; secrets are passed via `TF_VAR_*` env vars, never committed to `terraform.tfvars`. Deploy is the standard `terraform init && terraform plan -out && terraform apply`, gated in CI by `terraform-plan.yml` (PR) and `terraform-apply.yml` (protected merge).

> Older revisions of this guide referred to this repository as `neksur-com/infra`; the repository is **`neksur-com/neksur-infra`**.

## Deployment modes

Neksur runs in three modes from the same binary:

- **SaaS (AWS).** The topology documented above — pooled multi-tenancy, WorkOS auth, the `neksur-infra` Terraform. This is the reference deployment.
- **Self-managed.** Operators run `neksur-server` against their own Postgres 16 + AGE and their own Iceberg catalog, behind their own ingress. The HA, health-check, backup/DR, and observability guidance above applies unchanged.
- **Air-gapped / on-prem.** A zero-internet deployment: no CDN dependencies in the web build, an offline **signed license file** (no license-server callout), OIDC-based governance authz (admin role injected from the OIDC `roles` claim), and a self-contained demo/bootstrap path. The build integrity gate ensures the distributed artifact has no outbound network requirements.

## Spark writer-side integration

For the Defense-in-Depth write path, Spark applies Neksur Access transforms *before* writes hit object storage, via the [`neksur-com/neksur-spark-policy`](https://github.com/neksur-com/neksur-spark-policy) library (Scala 2.12 / Spark 3.5 / Iceberg 1.6.x / JDK 17). Two equivalent frontends call the same transform library:

**Silent — Catalyst extension** (intercepts all governed writes):

```bash
spark-submit \
  --conf spark.sql.extensions=com.neksur.spark.policy.NeksurEnforcementExtension \
  --conf spark.neksur.policy.endpoint='https://api.neksur.example.com/v1/policy' \
  --conf spark.neksur.policy.token='<bearer_token>' \
  app.jar
```

**Explicit — SDK** (opt-in per write):

```scala
import com.neksur.spark.policy.NeksurDataFrameWriter
new NeksurDataFrameWriter(df, "sales.orders").append()
```

Both paths are **fail-closed**: any failure fetching the transform plan raises a `SparkException` and aborts the write — no governed write proceeds without a successfully applied policy. A CI parity gate (`ExtensionVsSdkParitySpec`) proves the two paths produce byte-identical Parquet. Iceberg connector version drift matters: a mismatched `iceberg-spark-runtime` silently disables write interception, so pin the runtime jar to the supported version.

## What's planned (roadmap)

Future phases extend the deployment surface in the following directions:

- **Auto-scaling rules** — Phase 4+ ships target-tracking auto-scaling on multiple Prometheus metrics (commit rate, detection-pool depth, per-tenant cardinality), replacing the simple binary scale-out triggers documented above.
- **Multi-region deployment** — Phase 6+ adds a multi-region topology with cross-region RDS replication, a global ALB / Route 53 latency-based routing layer, and per-region detection pools. The Phase 1 deployment is single-region by design.
- **Managed-service offering** — Phase 7+ packages Neksur Core as a hosted managed service ("Neksur Cloud") with operator-side onboarding, multi-tenant quota enforcement at the infrastructure layer, and a published Helm chart for self-managed Kubernetes deployments. See [`neksur-com/neksur`](https://github.com/neksur-com/neksur) BSL → Apache 2.0 license transition (2030-05-10) for the long-term distribution model.

Operators evaluating Neksur today should target a single-region production deployment with the Phase 1 topology and accept that auto-scaling, multi-region, and managed-service capabilities are roadmap items.

## Where to next

- [Architecture](../architecture/overview.md) — the three-layer enforcement model and the per-commit pipeline that runs inside each replica.
- [Getting Started](../getting-started/install-and-first-policy.md) — point Spark at a freshly deployed gateway and author your first policy.
- [REST API Reference](../reference/rest-api.md) — full endpoint surface, request/response shapes, HTTP status codes.

---

*Deployment guide. Updated 2026-06-06 to cover the full Core surface, infrastructure-as-code, deployment modes, and the Spark integration.*
