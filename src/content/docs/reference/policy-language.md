---
title: "Policy language reference"
description: "Neksur Access policies are written in CEL (Common Expression Language, cel-go). This page is the complete reference for the evaluation environment, helper…"
---

Neksur Access policies are written in **CEL** (Common Expression Language, `cel-go`). This page is the complete reference for the evaluation environment, helper functions, and policy kinds. For a task-oriented walkthrough with examples, see the guide [Author Access policies](/guides/author-access-policies/).

## Policy contract

- A policy is a single **boolean** CEL expression.
- `true` → allow; `false` → deny.
- Policies are compiled once and cached by `(policy_id, policy_text)`.
- Evaluation is **fail-closed**: a compile error, evaluation error, non-boolean result, or panic rejects the operation (`503` on the write path) — it never allows-by-default.
- On the write path, **first deny wins** across all policies governing a table.

## Bindings

Three variables are in scope. All are map-shaped; access fields with dot or index notation.

### `table`

The loaded Iceberg table metadata.

| Field | Type | Notes |
|-------|------|-------|
| `table.name` | string | Table name. |
| `table.namespace` | string | Namespace. |
| `table.schema.fields` | list | Each `{name, type}`. |
| `table.partition_spec.fields` | list | Partition spec fields. |
| `table.properties` | map | Table properties. |
| `table.snapshots` | list | Snapshot history. |

### `commit`

The proposed change (an Iceberg `UpdateTableRequest`).

| Field | Type | Notes |
|-------|------|-------|
| `commit.updates` | list | Each has `action` (e.g. `add-column`, `remove-snapshot`) and, where relevant, `snapshot.committed_at_ms` (int64). |
| `commit.requirements` | list | Iceberg table requirements asserted by the commit. |
| `commit.location_region` | string | From the request region header (used by residency/partition rules). |

### `principal`

The authenticated caller.

| Field | Type | Notes |
|-------|------|-------|
| `principal.sub` | string | Subject / user ID. |
| `principal.roles` | list&lt;string&gt; | Roles. |
| `principal.claims` | map | OIDC token claims. |

## Helper functions

| Function | Returns | Purpose |
|----------|---------|---------|
| `manifest.has_column(table, "name")` | bool | Whether the schema contains a column. |
| `manifest.has_partition(table, "spec")` | bool | Whether a partition spec is present. |
| `manifest.partition_spec(table)` | map&lt;string,string&gt; | The active partition spec. |
| `manifest.classification_satisfied(table, "^pattern$", "tag")` | bool | Whether every column matching the regex carries the required classification tag. |
| `principal.role(principal, "role")` | bool | Role membership check. |
| `principal.attribute(principal, "attr")` | string | ABAC attribute, resolved in three layers: OIDC claim → graph `HAS_ATTRIBUTE` edge → tenant default. |
| `location.region(commit)` | string | The commit's region. |

## Policy kinds

The kind selects the graph relationship that attaches a policy to a table and where it is enforced:

| Kind | Relationship | Enforced at | Purpose |
|------|--------------|-------------|---------|
| `schema` | `SCHEMA_GOVERNS` | write (gateway) | Schema constraints (required/forbidden columns). |
| `write_acl` | `WRITE_GOVERNS` | write (gateway) | Who may write. |
| `retention` | `RETAINS` | write (gateway) | Minimum retention before snapshot removal. |
| `residency` | `RESIDENCY_GOVERNS` | write (gateway) | Allowed write regions. |
| `classification` | `CLASSIFICATION_GOVERNS` | write (gateway) | Required column classification. |
| `row_filter` | — | read (proxy / BI / MCP) | Restrict which rows a reader sees. |
| `column_mask` | — | read (proxy / BI / MCP) | Mask/redact/tokenize columns. |

## Example expressions

```cel
// schema: forbid a column
!manifest.has_column(table, "ssn")

// write_acl: by subject
principal.sub in ["alice", "bob"]

// write_acl: by role
principal.role(principal, "data_engineer") || principal.role(principal, "dba")

// retention: no removal of snapshots newer than a cutoff (epoch ms)
commit.updates.all(u,
  u.action != "remove-snapshot" || u.snapshot.committed_at_ms < 1672531200000)

// residency: allowed regions only
location.region(commit) in ["us-east-1", "us-west-2"]

// classification: every pii_* column must be tagged sensitive
manifest.classification_satisfied(table, "^pii_.*", "sensitive")

// row_filter: reader's region must match the table's
principal.attribute(principal, "region") == table.properties["region"]

// column_mask: privileged role sees unmasked
principal.role(principal, "pii_reader")
```

## Validate offline

```bash
neksur-cli policy compile ./policy.cel
```

`0` = clean; `1` = CEL/binding error; `2` = file/usage error.

## See also

- [Author Access policies](/guides/author-access-policies/) — the guide.
- [Meaning, Access, State](/concepts/dimensions/)
- [Architecture → policy engine](/architecture/overview/)
