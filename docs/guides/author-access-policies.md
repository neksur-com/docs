# Author Access policies (CEL)

**Job:** Define · **Edition:** Core.

The **Access** dimension of a Contract is expressed as policies in **CEL** (Common Expression Language). A policy is a single boolean expression: it returns `true` to allow and `false` to deny. Policies are compiled once (LRU-cached), evaluated at commit time on the write path and compiled into queries on the read path, and they are **fail-closed** — any compile error, evaluation error, non-boolean result, or panic rejects the operation rather than allowing it.

> Policies are written in **CEL**, not Rego. The evaluation environment and helper functions below are the complete surface available to a policy.

## The evaluation environment

Every policy is evaluated against three bindings:

| Binding | What it is | Key fields |
|---------|-----------|------------|
| `table` | The loaded Iceberg table metadata | `table.name`, `table.namespace`, `table.schema.fields[]` (`{name, type}`), `table.partition_spec.fields[]`, `table.properties`, `table.snapshots` |
| `commit` | The proposed change | `commit.updates[]` (`{action, snapshot{committed_at_ms}, …}`), `commit.requirements[]`, `commit.location_region` |
| `principal` | The authenticated caller | `principal.sub`, `principal.roles[]`, `principal.claims` (OIDC) |

### Helper functions

In addition to standard CEL, these helpers are available:

```cel
manifest.has_column(table, "name")                         // → bool
manifest.has_partition(table, "spec")                      // → bool
manifest.partition_spec(table)                             // → map<string,string>
manifest.classification_satisfied(table, "^pii_.*", tag)  // → bool
principal.role(principal, "role_name")                     // → bool
principal.attribute(principal, "attr")                     // → string  (ABAC: OIDC claim → graph edge → tenant default)
location.region(commit)                                    // → string
```

## Policy kinds

A policy's *kind* determines which graph relationship attaches it to a table and what it governs:

| Kind | Governs | Typical rule |
|------|---------|--------------|
| **schema** | Table schema | "must / must not include a column" |
| **write_acl** | Who may write | principal- or role-based allow |
| **retention** | Snapshot expiry | minimum retention before a snapshot may be removed |
| **row_filter** | Which rows a reader sees | filter by tenant / region / attribute |
| **column_mask** | Which columns are masked | mask / hash / tokenize sensitive columns |
| **residency** | Where data may be written | allowed regions |
| **classification** | Required column tags | every `pii_*` column tagged `sensitive` |

Row filters and column masks are the ones compiled into the **read path** ([Trino / BI](./connect-read-path.md)); the rest gate the **write path** at the gateway.

## Examples

**Require a column is absent (schema):**

```cel
!manifest.has_column(table, "ssn")
```

**Restrict writes to specific principals (write_acl):**

```cel
principal.sub in ["alice", "bob"]
```

**Restrict writes by role (write_acl):**

```cel
principal.role(principal, "data_engineer") || principal.role(principal, "dba")
```

**Minimum retention — deny removing recent snapshots (retention):**

```cel
commit.updates.all(u,
  u.action != "remove-snapshot" ||
  u.snapshot.committed_at_ms < 1672531200000   // cutoff (epoch ms)
)
```

**Data residency (residency):**

```cel
location.region(commit) in ["us-east-1", "us-west-2"]
```

**Require PII columns are classified (classification):**

```cel
manifest.classification_satisfied(table, "^pii_.*", "sensitive")
```

**Row filter — a reader only sees their region (row_filter):**

```cel
principal.attribute(principal, "region") == table.properties["region"]
```

**Column mask — mask a column unless the caller is privileged (column_mask):**

```cel
principal.role(principal, "pii_reader")   // true → unmasked; false → masked
```

## Validate before you ship

Compile a policy offline against the real gateway evaluation environment before pushing it:

```bash
neksur-cli policy compile ./policies/no-ssn.cel
```

Exit code `0` means it compiles cleanly; a non-zero exit reports the CEL syntax error or an undeclared binding. Validating offline keeps a malformed policy from ever reaching the fail-closed runtime (where it would `503` real commits).

## How policies are evaluated at runtime

1. The gateway loads every policy governing the table from the graph.
2. Each policy is compiled (or served from the LRU cache) and evaluated against `{table, commit, principal}`.
3. **First deny wins** — the first policy that returns `false` rejects the commit with `403` and an audit record.
4. Any error on any policy fails closed → `503`, no commit.

On the read path, `row_filter` and `column_mask` policies are compiled into the query's `WHERE` and projection before it reaches the engine.

## Attach policies to a Contract

Policies live in the **Access** dimension of a [Data Contract](../concepts/data-contract.md). Author and attach them in the web console's Access tab, then advance the Contract through its [lifecycle](./author-and-ship-a-contract.md) so they deploy to the gateway and the read path together.

## See also

- [Policy language reference](../reference/policy-language.md) — the full binding/field/function catalog.
- [Author and ship a Data Contract](./author-and-ship-a-contract.md)
- [Connect Trino and BI tools (read path)](./connect-read-path.md)
