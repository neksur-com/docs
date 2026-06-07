---
title: "Enforcement model"
description: "A Data Contract is enforced at several coordinated points in the data path. Each point catches a different class of risk and fails in a different way;…"
---

A [Data Contract](/concepts/data-contract/) is enforced at **several coordinated points** in the data path. Each point catches a different class of risk and fails in a different way; defense-in-depth across all of them is the design point, because no single interception can cover the whole surface.

```
   Spark / Flink ─ writer-side transform ─┐
                                          ▼
                ┌─────────────────────────────────────┐
                │  Catalog Gateway (write path)        │ ─► upstream catalog
                │  commit-time policy + audit          │    (Polaris / Nessie / …)
                └─────────────────────────────────────┘
                                          │
   Trino / Dremio / ─ read-path proxy ────┤      ┌──────────────────────────┐
   BI (pgwire/XMLA)  row filter + mask    │      │  Credential vending      │
                                          │      │  (compute isolation)     │
                                          ▼      └──────────────────────────┘
                ┌─────────────────────────────────────┐
                │  Post-commit detection (backstop)    │
                └─────────────────────────────────────┘
                                          │
                                          ▼
                     Tenant-scoped metadata graph
                     (Contracts · lineage · audit chain)
```

## The enforcement points

### Catalog gateway (write path)

Neksur is an Iceberg REST catalog proxy in front of your real catalog. Every commit is intercepted at commit time and run through the Access (write-ACL), schema, retention, classification, and residency rules of the governing Contract. A valid commit is forwarded to the upstream catalog transparently; a violating commit is rejected with a structured error and an audit record. This is the **strongest** point — a rejected write never lands — but it can only check what the policy author anticipated.

Fail-closed: if the policy engine cannot produce a verdict, the commit is rejected, not allowed.

### Writer-side transform (Spark, pre-write)

Before bytes reach object storage, an optional Spark layer applies column-level transforms — masking, encryption, redaction, tokenization. Two equivalent frontends call the *same* transform library:

- a **Catalyst optimizer extension** that intercepts all writes silently, and
- an explicit **SDK** wrapper (`writeWithNeksur`) for teams that prefer opt-in.

Both paths are proven byte-identical by a CI parity gate, and both are fail-closed: a failed policy fetch aborts the write. This is a Defense-in-Depth edition capability — see [Editions and tiers](/concepts/editions/).

### Read-path SQL proxy

The same declarative Access policy is compiled to each engine's dialect and injected into read traffic, so a row filter or column mask authored once is enforced when Trino, Dremio, or a BI tool reads. BI clients connect through the Postgres wire protocol (`pgwire`) or XMLA (Excel / Power BI). The read path closes the gap the write path can't: data already in the lake that violates current policy is filtered at query time.

### Credential vending (compute isolation)

A vending boundary issues short-lived, scoped storage credentials so an engine cannot reach data outside the Contract's bounds. This makes "the engine just read the files directly" a controllable, not an unbounded, risk.

### Post-commit detection (backstop)

Some writes never pass through any of the above — direct S3 writes, hand-crafted manifests, third-party ingestion. Detection sweeps newly-committed snapshots and classifies their contents:

- a baseline poller, optional catalog webhooks, and optional S3 `ObjectCreated` events trigger scans;
- a classifier (regex in Core; ML in the Intelligence edition) scores findings;
- confident findings raise an alert and a detection record linked to the offending snapshot in the graph.

Detection is **reactive by design** — it catches what slipped through, slightly after the fact. It is a backstop, not the primary control.

## Why defense-in-depth

Each point has a blind spot the others cover:

- A **write-time gate** is fast and clean but cannot see novel data shapes the policy author didn't anticipate.
- A **detector** sees actual content but only after the data has landed.
- A **read-path proxy** stops bad data from being *served* but cannot stop it from being *written*.
- **Credential vending** bounds what compute can reach but doesn't inspect content.

Run alone, each is brittle. Composed, they form a surface where a violation has to evade every layer to cause harm.

## A note on level codes

Internally, the write-path enforcement points carry level codes (the defense model in ADR-003). Those codes are an implementation detail and do not appear in user-facing surfaces; this documentation uses the descriptive names above.

## See also

- [The Data Contract](/concepts/data-contract/)
- [Meaning, Access, State](/concepts/dimensions/)
- [Editions and tiers](/concepts/editions/)
- [Architecture Overview](/architecture/overview/) — how these points are wired in code.
