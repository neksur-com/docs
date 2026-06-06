# Connect Spark to the catalog gateway (write path)

**Job:** Enforce · **Edition:** Core (the gateway) — the optional writer-side transform is Defense-in-Depth.

This guide points Apache Spark at the Neksur **catalog gateway** so that every Iceberg commit is policy-checked at commit time. You change one URL in your Spark config; your upstream catalog (Polaris / Nessie) is unchanged.

There are two layers you can adopt, independently or together:

1. **Catalog gateway (Core)** — Spark talks to Neksur's Iceberg REST endpoint instead of the real catalog. Commits are evaluated against the Contract's Access (write-ACL), schema, retention, residency, and classification rules and either forwarded or rejected. *This is the one to start with.*
2. **Writer-side transform (Defense-in-Depth)** — a Spark library that applies column masks / encryption / redaction / tokenization to the data *before* it is written. See [the writer-side section](#optional-writer-side-transform-defense-in-depth) below.

## Prerequisites

- A tenant provisioned in Neksur (see the [CLI reference](../reference/cli.md#tenant-create)).
- A registered **catalog credential** — the row that maps a URL prefix to your upstream catalog.
- A bearer token (or mTLS client cert) for the writing principal.

## 1. Register the upstream catalog

The gateway resolves a URL `{prefix}` to a concrete upstream catalog via the tenant's `catalog_credentials`. Register one and let Neksur discover the tables in one step with the CLI:

```bash
# Preferred: the catalog credential is already stored; discover its tables.
neksur-cli catalog discover \
  --tenant-uuid <tenant-uuid> \
  --nickname meridian \
  --namespaces catalog,crm,sales,marketing
```

For local/dev you can pass Polaris connection details directly instead of a stored credential:

```bash
neksur-cli catalog discover \
  --tenant-uuid <tenant-uuid> \
  --polaris-endpoint http://localhost:8181/api/catalog \
  --warehouse my-warehouse \
  --client-id "$POLARIS_CLIENT_ID" \
  --client-secret "$POLARIS_CLIENT_SECRET"
```

The `nickname` becomes the `{prefix}` in the gateway URL. Supported `catalog_kind`s are `polaris`, `nessie`, `glue`, and `unity` (Polaris and Nessie have live adapters today).

## 2. Point Spark's Iceberg REST catalog at the gateway

Neksur exposes a standard Iceberg REST catalog surface at:

```
https://<neksur-host>/v1/iceberg/{prefix}/...
```

Configure Spark's Iceberg REST catalog to use that URI. With `{prefix}` = `meridian`:

```bash
spark-sql \
  --conf spark.sql.catalog.lakehouse=org.apache.iceberg.spark.SparkCatalog \
  --conf spark.sql.catalog.lakehouse.type=rest \
  --conf spark.sql.catalog.lakehouse.uri=https://neksur.example.com/v1/iceberg/meridian \
  --conf spark.sql.catalog.lakehouse.token="$NEKSUR_TOKEN"
```

That is the **only** change from a direct-to-catalog setup — the `uri` now points at Neksur, which forwards to your real catalog after policy evaluation.

> The three path segments after the prefix (`namespace`, `table`) must match `^[a-zA-Z0-9_-]+$`. Use simple namespace/table names.

## 3. Write — and watch policy apply

A normal Iceberg write now flows through the gateway:

```sql
INSERT INTO lakehouse.sales.orders VALUES (1, 'widget', 19.99);
```

Under the hood this is a commit to `POST /v1/iceberg/meridian/namespaces/sales/tables/orders`. The gateway runs the full commit pipeline (validate → load → policy fetch → evaluate → forward → audit → ingest) and returns:

- **`200`** — allowed; the upstream catalog's commit response is echoed back, and an approved `WriteEvent` is recorded.
- **`403`** — a policy denied the commit; the rejection and its reason are written to the audit log. Your Spark write fails with the reason.
- **`503`** — the policy engine could not produce a verdict (**fail-closed**): the commit is rejected rather than allowed-by-default. This is by design — see [Architecture](../architecture/overview.md).
- **`409`** — an upstream Iceberg commit conflict; rebase and retry.

To author the policies that drive these decisions, see [Author Access policies](./author-access-policies.md).

## 4. Multi-table commits

If your job commits several tables atomically, Spark's transaction hits `POST /v1/iceberg/{prefix}/transactions/commit`. Neksur applies **reject-all** semantics: if any table's commit would be denied, the whole transaction is rejected and nothing is forwarded — you cannot smuggle a denied write inside a permitted batch.

## 5. Capture lineage (optional but recommended)

Enable Spark's OpenLineage integration and point it at Neksur so writes land as lineage edges in the graph:

```bash
--conf spark.extraListeners=io.openlineage.spark.agent.OpenLineageSparkListener \
--conf spark.openlineage.transport.type=http \
--conf spark.openlineage.transport.url=https://neksur.example.com \
--conf spark.openlineage.transport.endpoint=/v1/lineage
```

Lineage ingestion is at-least-once and cycle-safe; see the [REST API reference](../reference/rest-api.md#post-v1lineage).

## Optional: writer-side transform (Defense-in-Depth)

For the Defense-in-Depth tier, the [`neksur-spark-policy`](https://github.com/neksur-com/neksur-spark-policy) library applies column transforms *before* bytes hit object storage — so masked/encrypted values are what actually get written, not just what gets read back.

Supported stack: **Scala 2.12 · Spark 3.5 · Iceberg `iceberg-spark-runtime-3.5_2.12` 1.6.x · JDK 17**. Pin the Iceberg runtime jar to the supported version — a mismatch silently disables write interception.

**Silent — Catalyst extension** (intercepts all governed writes):

```bash
spark-submit \
  --jars /path/to/neksur-spark-policy.jar \
  --conf spark.sql.extensions=com.neksur.spark.policy.NeksurEnforcementExtension \
  --conf spark.neksur.endpoint=https://neksur.example.com \
  --conf spark.neksur.token="$NEKSUR_TOKEN" \
  job.py
```

**Explicit — SDK** (opt-in per write):

```scala
import com.neksur.spark.policy.NeksurDataFrameWriter
new NeksurDataFrameWriter(df, "sales.orders").append()   // or overwrite / overwritePartitions / merge
```

Both frontends call the same transform library and are proven byte-identical by a CI parity gate. Both are **fail-closed**: if the transform plan can't be fetched, the write aborts with a `SparkException` — no governed write proceeds without a successfully applied policy.

See [Deployment → Spark integration](../operations/deploy.md#spark-writer-side-integration) for the operational details.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `404` on commit | No `catalog_credentials` row for `{prefix}` in this tenant. Re-run `catalog discover` / register the credential. |
| `400` on commit | A namespace/table name doesn't match `^[a-zA-Z0-9_-]+$`. |
| `401` | No principal — missing/empty bearer token or mTLS SAN. |
| `503` (sustained) | Policy engine unavailable (fail-closed). Check the gateway's `commit_rejected_total{reason="policy_engine_unavailable"}` metric and the [deploy runbook](../operations/deploy.md#observability). |
| Writer-side `SparkException` | Transform-plan fetch failed (fail-closed), or an Iceberg runtime version mismatch. |

## See also

- [Author Access policies (CEL)](./author-access-policies.md)
- [Connect Trino and BI tools (read path)](./connect-read-path.md)
- [REST API reference](../reference/rest-api.md)
