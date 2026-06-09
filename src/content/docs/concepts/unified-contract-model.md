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

## State is split — and quality lives inside it

[State](/concepts/dimensions/#state) is the broadest dimension, and the unified model is precise about its structure. State splits in two:

- **Contract-State** — where the *agreement* is: the [lifecycle](/concepts/lifecycle/) stage of the Contract (`draft → review → compile → deploy → active → audit`). It tracks the agreement, not the bytes.
- **Dataset-State** — the condition of the *data*, itself in two halves:
  - **Physical** — files, snapshots, compaction, expiry, schema/partition evolution.
  - **Logical** — quality, classification, conformance, reconciliation.

This is the structural reason **data quality is not a separate contract**: freshness, volume, conformance and reconciliation are the **Logical** half of *one* Contract's Dataset-State — a dimension of the root, not a parallel object. See [Data quality (the Logical dimension of State)](/guides/data-quality/).

## The two State invariants

The pinned snapshot is protected by **two separate guarantees**. They are different mechanisms guarding different things, and the model keeps them apart deliberately — conflating them was a past mistake:

| Invariant | Guards | Mechanism |
|-----------|--------|-----------|
| **Inv-A — pin-aware retention** | *which files survive* | garbage collection (snapshot expiry, compaction) must not remove files reachable from a pinned snapshot |
| **Inv-B — cross-engine reconciliation** | *which numbers agree* | every engine reads the same pinned snapshot identically and agrees on the aggregates |

Inv-A is a *Physical*-state guarantee (retention vs. the pin); Inv-B is a *Logical*-state guarantee (reconciliation against the pin). The [`deploy → active` gate](#the-lifecycle-gate) runs **data-quality checks (Logical) plus cross-engine reconciliation (Inv-B) against the pinned snapshot** before a Contract goes live; Inv-A protects the snapshot those checks ran against from being collected out from under them.

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

## The complete axis set

The three dimensions you author — Meaning, Access, State — are the spine, but the unified model recognises a fuller set of axes, each of which is *a dimension of, a relationship of, or a meta-fact about* the one Contract. Some are ratified core; some are **directional** — a stated direction, not a shipped capability. The table is honest about which is which; nothing here implies a ship date or a metric.

| Axis | Role | What it asks | Where it sits |
|------|------|--------------|---------------|
| **Meaning** | dimension | what the data *means* | core · grounded in ontology + taxonomy (above) |
| **Access** | dimension | *who* may see what | core · tag-scoped, with the declassification boundary (above) |
| **Contract-State** | dimension | where the *agreement* is | core · the lifecycle, which now gates promotion |
| **Dataset-State (Physical ⊕ Logical)** | dimension | which version exists; is it healthy | core · the durable pin, the two invariants, the gate |
| **Guarantees / SLO** | dimension | *how well* | **partial** — freshness & volume ship as Logical-state checks; availability / completeness / latency are **directional** |
| **Parties** | relationship | *between whom* | **mixed** — a single accountable producer and a governance steward are modelled; a **consumer that `SUBSCRIBES`** is **directional** |
| **Lineage** | relationship | derived-from / impacts | table-level lineage ships; **contract-level** lineage is **directional** |
| **Evolution** | meta | breaking? deprecated? | breaking-change *detection* ships (it drives the gate); contract **versioning + notify** is **directional** |
| **Trust** | meta | suggested vs certified | a working pattern (certified groundings, attested declassification); Trust *as first-class data* is **directional** |
| **Compliance** | *reference* | proof to a regulator | **references** the Contract — it is **not a dimension of it** (see below) |

The four core dimensions hang off the root by construction: Meaning by `DEFINES`, Access by `GOVERNS`, Dataset-State by `CURRENT_PIN`, Contract-State by the lifecycle the Contract moves through. The rest of this section walks the relationship and meta axes so none of them floats.

## Evolution, Trust, and the meta axes

These axes are *about* the Contract rather than *parts of* it. They are where the model is most explicitly staged between shipped behaviour and direction.

### Evolution — breaking-change detection today, versioning ahead

When a Contract's schema changes, **breaking-change detection** classifies it: adding a column is additive; removing one, changing a type, or narrowing optional → required is breaking. This detection is *live* and it is what the [lifecycle gate](#the-lifecycle-gate) escalates on — a breaking change routes to human sign-off before it can reach consumers. What is **directional** is lifting that detection into a graph-versioned `ContractVersion` chain (`SUPERSEDES` / `BREAKS`) and a *notification* path to subscribers. Detection exists; the versioned record and the people to notify are the direction — and the notify path depends on the (directional) Parties axis having someone to notify.

### Trust — certified vs suggested

Trust cross-cuts Meaning and classification: a fact is either **suggested** (a candidate, often machine-produced) or **certified** (a human steward has signed off), and certified facts carry confidence. This is already load-bearing in two places above — a `MEANS` grounding is not trusted until certified, and a declassification is not applied until attested — and **AI agents consume only certified facts**. Promoting Trust to a *first-class property on every edge* (a `CERTIFIED_BY` fact with confidence everywhere) is **directional**; today it is a consistent pattern rather than a uniform data model.

### Parties — one producer, many consumers

A Contract is a multilateral agreement with asymmetric cardinality:

- **Producer / owner** — *exactly one* accountable team. Producer-singularity ("one throat to choke") is an invariant; co-ownership is modelled as one owning team, never co-producers.
- **Steward** — governance and certification; usually resolved at domain/tenant level, so it is typically a *reference* rather than a contract-owned party.
- **Approvers** — the three [review-stage sign-offs](/concepts/lifecycle/#sign-offs), which map 1:1 onto the three core dimensions (data owner → Meaning, access owner → Access, governance owner → State).
- **Consumer / subscriber** — *zero or many*. A consumer that `SUBSCRIBES` to a Contract is **directional**: it is what would make breaking-change *notification* meaningful (one producer promises; many rely), and a subscription would need to be its own node because each consumer carries different terms. A party need not be a person — a consumer may be a team, a pipeline, or an AI agent acting under policy.

The producer-one / consumer-many asymmetry is exactly why Evolution's notify path stays directional: the detection is here, the subscribers to notify are not yet modelled.

### Lineage — table-level today, contract-level ahead

Lineage between *tables* ships and powers impact analysis and PII-propagation traversals (see [compliance and audit](/guides/compliance-and-audit/#subject-requests-and-impact-analysis)). Lineage *between Contracts* — which Contract is derived from which, and what a change impacts downstream — is **directional**, and it leans on the Parties/Evolution scaffolding (you need subscribers to notify of an impact).

### Guarantees / SLO — freshness & volume today

Freshness and volume ship as [Logical-state checks](/guides/data-quality/) on the Contract. The broader service-level guarantees — availability, completeness, latency — are **directional**, and likely belong on an observability plane that *references* the Contract rather than as new fields inside the Contract definition.

## Compliance references the Contract — it is not a dimension of it

This distinction is deliberate and load-bearing. **Compliance is a bounded context that *references* Contracts; it is not a dimension *of* them.** Compliance evidence is keyed by framework, control, and tenant — not by a contract identity — and only a couple of edges (a control *checked by*, a Contract *violated*) touch a Contract at all. Forcing Compliance under the Contract root would over-couple two things that are correctly separate: the Contract proves *the data behaved*; the compliance layer maps that proof onto a regulator's controls. See [compliance and audit](/guides/compliance-and-audit/). The same "references, not a dimension" stance applies to the directional SLO observability plane.

## How it ties together

The three dimensions are not three systems bolted together — they are dimensions of one root, and the same three review-stage [sign-offs](/concepts/lifecycle/#sign-offs) map onto them: the data owner attests Meaning, the access owner attests Access, the governance owner attests State. The approval structure already encodes the decomposition.

| Dimension | In the unified model |
|-----------|----------------------|
| **Meaning** | grounded in an ontology (`MEANS` → GlossaryTerm) and the substrate (`COMPUTED_OVER` → Column) |
| **Access** | tag-scoped policy compiled to per-table artifacts — classify once, govern everywhere |
| **State** | Contract-State (the gating lifecycle) ⊕ Dataset-State — Physical (durable, event-sourced pin) ⊕ Logical (quality, the `deploy → active` gate, both invariants) |

Everything else — Guarantees, Parties, Lineage, Evolution, Trust, Compliance — hangs off this same root as a further dimension, a relationship, or (for Compliance) a referencing context. Nothing floats.

## See also

- [The Data Contract](/concepts/data-contract/)
- [Meaning, Access, State](/concepts/dimensions/)
- [Data quality (the Logical dimension of State)](/guides/data-quality/)
- [The Contract lifecycle](/concepts/lifecycle/)
- [Architecture Overview](/architecture/overview/)
