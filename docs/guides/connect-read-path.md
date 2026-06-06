# Connect Trino and BI tools (read path)

**Job:** Enforce · **Edition:** Core (read-path proxy + transports). Cross-engine coordination across additional engines is Multi-Engine.

The **read-path SQL proxy** compiles a Contract's Access policy — row filters and column masks — into query traffic, so a policy authored once is enforced when an engine *reads*, not just when it writes. This guide connects the three read clients Neksur speaks to: a SQL/Trino reader, a Postgres-wire BI tool, and an XMLA BI tool (Excel / Power BI).

All three apply the **same** Access compilation: restricted rows never appear in results, counts, or pagination; masked columns are masked before they leave the proxy. Enforcement is fail-closed — if policy can't be resolved, the query errors rather than returning unfiltered data.

> **Ports below are defaults and are configurable.** The SQL proxy / `pgwire` / XMLA listeners are set via the server's environment (e.g. `NEKSUR_SQLPROXY_ADDR`, the pgwire and XMLA listen addresses). Check your deployment's configuration for the exact host/port; ask your operator or see the [CLI / server reference](../reference/cli.md#neksur-server).

## Trino (SQL reader)

Reads are routed through the proxy, which compiles the Access policy and dispatches to Trino via the engine dispatcher. Your deployment configures the upstream Trino coordinator (server URI, catalog, schema, and an optional access token) on the Neksur side; clients then issue ordinary SQL.

A query like:

```sql
SELECT customer_id, email, total_usd
FROM sales.orders
WHERE created_at >= DATE '2026-01-01';
```

is rewritten before execution to inject the governing Contract's row filter (e.g. `WHERE region = 'us-east-1'` for a regionally-scoped principal) and to mask columns (e.g. `email` → a masked projection) per the caller's roles. The caller cannot opt out of the rewrite.

## BI tools over the Postgres wire protocol (`pgwire`)

Any Postgres-compatible BI tool or driver — Tableau, Looker, Metabase, `psql`, a JDBC app — can connect to Neksur's `pgwire` listener and get policy-compiled results.

```bash
# psql against the pgwire listener (host/port/db per your deployment)
psql "host=neksur.example.com port=5433 user=<org-or-principal> dbname=<catalog> sslmode=require"
```

JDBC (Tableau / Looker / generic):

```
jdbc:postgresql://neksur.example.com:5433/<catalog>?user=<principal>&sslmode=require
```

Authentication is a shared secret over TLS in production (an insecure, localhost-only anonymous mode exists for local dev). The connection resolves to exactly one tenant, and every query is row-filtered and column-masked for the connecting principal's roles.

## Excel and Power BI over XMLA

Neksur exposes an XMLA (XML for Analysis) endpoint — the SOAP-over-HTTP protocol that Excel and Power BI open as an Analysis Services / OLAP connection. Point the client's "Analysis Services" connection at the XMLA listener:

```
Data Source = https://neksur.example.com:<xmla-port>
Initial Catalog = <tenant-catalog>
User ID = <principal>
Password = <shared-secret>
```

The server answers `Discover` (metadata: the metrics and dimensions the principal may see) and `Execute` (query) requests. Metric/dimension semantics come from the Contract's [Meaning dimension](./author-semantic-metrics.md), and Access row filters / column masks are applied to results. Per-tenant rate and concurrency limits guard the compiler and engine.

## How enforcement is guaranteed on read

- **One policy source.** The same Contract Access definition compiled at the gateway (write) is compiled here (read) — there is no separate read policy to drift.
- **Push-down.** Row filters become `WHERE` predicates and column masks become projection rewrites *before* the query reaches the engine, so the engine never returns ungoverned rows.
- **Fail-closed.** If the policy can't be compiled or fetched, the query fails; it does not fall back to unfiltered results.
- **Same for AI agents.** The MCP `graph.traverse` path uses the identical row-filter / column-mask push-down — see [Connect an AI agent over MCP](./ai-agents-mcp.md).

## See also

- [Author Access policies (CEL)](./author-access-policies.md) — write the row filters and column masks this guide enforces.
- [Author semantic metrics (Meaning)](./author-semantic-metrics.md) — the metric definitions the BI transports expose.
- [Connect Spark to the catalog gateway (write path)](./connect-spark-write-path.md).
