---
title: "The unified contract model"
description: "How the Data Contract becomes the single authoritative root of a dataset's governance — grounded Meaning, tag-scoped Access, and a durable pinned snapshot that anchors every attestation as-of one version of the data."
---

The [Data Contract](/concepts/data-contract/) is the central abstraction, and the [three dimensions](/concepts/dimensions/) and the [lifecycle](/concepts/lifecycle/) describe what it binds and how it moves. This page describes the **unified contract model**: the architecture that makes the Contract the *single authoritative root* of everything Neksur knows about a dataset, grounds its Meaning in shared vocabularies, scopes its Access over those vocabularies, and anchors every attestation to a durable, as-of pinned snapshot.

This is the *spine* the rest of the control plane hangs from. It is described by ADR-017 (*The Unified Contract Model — DataContract as the Authoritative Root*). This page explains the **model and its capabilities**; for where each capability sits today, the [architecture overview](/architecture/overview/) and the [status section](/intro/what-is-neksur/#status) are the source of truth.

## The Contract as authoritative root

A Contract is [materialized in the metadata graph](/concepts/data-contract/#the-contract-in-the-metadata-graph), not as a YAML file in a bucket. The unified model makes a stronger claim than "materialized": the Contract and its connecting edges in the graph are the **source of truth**, and the relational tables the read path serves are a **derived read-model** — a projection, not an independently-authored copy.

"Authoritative root" is precise about where the truth lives:

- **Authoring writes the graph first.** A Contract's Meaning, Access, and State are written into the tenant-scoped graph (Apache AGE on Postgres) inside one transaction; the same transaction appends a durable outbox record.
- **The relational read-model is a projection.** An asynchronous projector consumes the outbox and idempotently upserts the relational tables that serve the fast read path. The hot aggregate read stays a fast relational read — it is not a live graph traversal.
- **Drift is a breach, not a silent divergence.** A periodic reconciliation sweep (hourly) diffs the graph against the projection; any difference is raised as a breach on the same path data-quality breaches take. The projection is *reconciled* against the authoritative graph, never authored on its own.

```
   Author (graph-first)
         │
         ▼
   ┌─────────────────┐    same transaction    ┌──────────┐
   │  DataContract   │ ──────────────────────▶│  outbox  │
   │  + edges (AGE)  │   authoritative write   └────┬─────┘
   └─────────────────┘                              │ async
         │                                          ▼
         │  fast read path                    ┌───────────┐
         ▼                                    │ projector │
   ┌─────────────────┐   idempotent upsert    └─────┬─────┘
   │  relational     │ ◀────────────────────────────┘
   │  read-model     │
   └─────────────────┘
         ▲
         │  hourly reconciliation sweep diffs graph ⇄ projection;
         └─ any drift is raised as a breach.
```

This is a CQRS shape. A unified model does *not* mean a graph traversal on every read — it means one root the projection is provably derived from, so the three dimensions can no longer drift apart by being authored independently.

## Grounded Meaning

The [Meaning dimension](/concepts/dimensions/#meaning) — the metrics and dimensions of the semantic layer — is, in the unified model, **grounded** rather than free-floating. Grounding connects a metric to two shared, tenant-level vocabularies:

- **An ontology of concepts.** A metric or dimension connects to a **GlossaryTerm** through a `MEANS` edge. A GlossaryTerm is the *single* definition of a concept: two metrics that mean the same term must be reconcilable, or that is semantic drift. Concept identity, enforced — this is the point of having an ontology.
- **The physical substrate.** A metric connects to the **columns** it is computed over (a `COMPUTED_OVER` edge), so Meaning is anchored to real data, and sensitivity can flow from columns up to the metrics derived from them (see [declassification](#declassification) below).

A grounding edge is only load-bearing once the term it points to is **certified** by a human steward — a suggested grounding is a candidate, a certified one is trusted. AI agents (which consume the graph over MCP) read only certified semantics.

## Tag-scoped Access — classify once, govern everywhere

The [Access dimension](/concepts/dimensions/#access) is policy. In the unified model, policy is scoped over the **taxonomy** rather than over raw column names. A column is classified once — a **Tag** from a closed set of classifications is attached to it by detection — and policy is written against the Tag. The compiler expands a tag-scoped policy back down to per-table artifacts by following which columns carry the tag.

This is the **classify once → govern everywhere** principle. You classify a column as PII in one place, and every policy that governs PII applies to it automatically, across every table that carries the tag — instead of re-listing column names in every policy.

## The durable pinned snapshot

A Contract's attestations — its quality results, its cross-engine reconciliation, its compliance evidence — are only meaningful "as of" a specific version of the data. The [State dimension](/concepts/dimensions/#state) already pins snapshots for reproducible reads; the unified model adds a **durable contract pin**: the agreed Iceberg snapshot is a durable, as-of anchor for *every attestation*, not "whatever is latest right now."

The pin is **event-sourced**. Each time the agreed snapshot changes, a **PinEvent** — `{contract, table, snapshot, at, actor, reason}` — is appended; nothing is mutated. The event stream *is* the history, which directly answers the question every audit asks: *as of which pin did this attestation hold?* The "current pin" is a projection of the latest event.

A re-pin is a **data-time** event — the agreed data changed. It is deliberately *not* a lifecycle step and *not* a contract-version change. Three clocks are kept distinct:

| Clock | What changes | Mechanism |
|-------|--------------|-----------|
| **Data-time** | which snapshot is agreed | a re-pin → a new PinEvent |
| **Process-time** | where the agreement is | the lifecycle stage |
| **Spec-time** | the Contract definition itself | a contract version / breaking change |

The durable contract pin is also what the retention guarantee protects: snapshot expiry must not remove files reachable from a pinned snapshot, and the pin is what cross-engine reconciliation reads against.

## The lifecycle gate

In the unified model, the [lifecycle](/concepts/lifecycle/) **actually gates promotion** — moving forward is not a free metadata flip. The load-bearing gate is the **`deploy → active`** transition:

- **The data gate at `deploy → active`** runs **data-quality checks plus cross-engine reconciliation against the pinned snapshot** before a Contract goes live. Reconciliation confirms the pinned snapshot reads identically across engines.
- **Posture: block, breach, and escalate-breaking.** A failed gate **blocks the transition and raises a breach** — both. A verified **non-breaking** change flows through automatically (machine-gated). A **breaking** schema change — caught by breaking-change detection — **escalates to human sign-off** at the review stage before it can proceed.

The principle: *the machine protects consumers by default, and humans engage only on breaking changes.* A re-pin runs through the same gate — a non-breaking re-pin that passes the checks auto-advances the pin; a breaking re-pin escalates to sign-off, and the pin stays put until approved.

## Declassification

When a metric is computed over columns, what is its sensitivity? In the unified model a metric **inherits the sensitivity tags (e.g. PII) of its `COMPUTED_OVER` columns by default**. A metric computed over a PII column is itself PII — safe-by-default.

Declassifying an aggregate — deciding that a metric over sensitive columns is itself *not* sensitive — is genuinely hard, because it does **not compose**: a sequence of individually-"safe" aggregates can re-identify individuals through differencing. For a product whose purpose is governance evidence, a per-query threshold is not a sufficient rule. So the model is conservative:

- **Declassification requires an explicit governance-steward attestation.** A human steward — exercising the feature on their own Contract — decides a metric is safe to expose and attests it. The attestation is recorded as a trust fact; it is never automatic.
- **A mechanical layer suggests, it does not apply.** A heuristic (a k-threshold, an aggregate-type check) may *propose* declassification candidates for steward review; it never auto-applies.
- **Exact numbers are preserved.** No differential-privacy noise is injected — the metric's value stays exact. The control is *who may see it*, attested by a human, not *what the number is*.

This fits the trust model cleanly: because AI grounding consumes only *certified* facts, a declassification a steward has attested is automatically respected downstream, and one that is merely *suggested* is not.

## How it ties together

The three dimensions are not three systems bolted together — they are dimensions of one root, and the same three review-stage [sign-offs](/concepts/lifecycle/#sign-offs) map onto them: the data owner attests Meaning, the access owner attests Access, the governance owner attests State. The approval structure already encodes the decomposition.

| Dimension | In the unified model |
|-----------|----------------------|
| **Meaning** | grounded in an ontology (`MEANS` → GlossaryTerm) and the substrate (`COMPUTED_OVER` → Column) |
| **Access** | tag-scoped policy compiled to per-table artifacts — classify once, govern everywhere |
| **State** | a durable, event-sourced pinned snapshot, gated by the `deploy → active` data gate |

## See also

- [The Data Contract](/concepts/data-contract/)
- [Meaning, Access, State](/concepts/dimensions/)
- [The Contract lifecycle](/concepts/lifecycle/)
- [Architecture Overview](/architecture/overview/)
