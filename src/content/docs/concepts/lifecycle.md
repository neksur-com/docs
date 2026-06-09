---
title: "The Contract lifecycle"
description: "A Data Contract is a governed object, not a config flag. It moves through a single state machine, and the three dimensions (Meaning, Access, State)…"
---

A [Data Contract](/concepts/data-contract/) is a governed object, not a config flag. It moves through a single state machine, and the three dimensions ([Meaning, Access, State](/concepts/dimensions/)) advance together through it.

## The state machine

```
draft → review → compile → deploy → active → audit
```

| Stage | Meaning | Legal next stages |
|-------|---------|-------------------|
| **draft** | Authored, not yet submitted. | review |
| **review** | Submitted for sign-off by the accountable owners. | compile · draft *(revisions requested)* |
| **compile** | Sign-offs collected; the compiler materializes per-engine artifacts. | deploy · draft *(compile failed → re-author)* |
| **deploy** | Compiled artifacts roll out to the engines (Trino, the SQL proxy, the catalog gateway). | active · compile *(deploy failed → re-compile)* |
| **active** | The Contract is live and enforced everywhere. | audit · deploy *(rollback)* |
| **audit** | Post-active review against audit evidence. | active *(clean audit)* · draft *(re-author)* |

Transitions not listed are **illegal by construction** — you cannot jump `draft → compile` and skip review, and you cannot edit a live Contract in place. Progress always moves forward through review; problems move backward to the stage that can fix them.

> The terminal enforcement stage is named **active**. Earlier material may call it *enforce*; the state machine uses `active`.

## The `deploy → active` data gate

Promotion is not a free metadata flip. The load-bearing gate is the **`deploy → active`** transition: data-quality checks plus cross-engine reconciliation against the Contract's [durable pinned snapshot](/concepts/unified-contract-model/#the-durable-pinned-snapshot) must pass before the Contract goes live.

The gate's posture is **block, breach, and escalate-breaking**: a failed gate both blocks the transition and raises a breach. A verified **non-breaking** change flows through automatically (machine-gated), while a **breaking** schema change — caught by breaking-change detection — escalates to human sign-off at the review stage before it can proceed. The machine protects consumers by default; humans engage only on breaking changes. See [the lifecycle gate](/concepts/unified-contract-model/#the-lifecycle-gate).

## Sign-offs

Moving from **review** to **compile** requires sign-off from the accountable owners — typically the data owner (Meaning), the access owner (Access), and the governance owner. The review queue records who approved what and when; those approvals become part of the audit evidence the Contract later proves.

## The three buyer jobs

The lifecycle exists to serve three jobs, in order:

1. **Define** — author the Contract (Meaning, Access, State) once, in draft, and shepherd it through review and compile.
2. **Enforce** — once active, the Contract is enforced at every point in the data path (see [Enforcement model](/concepts/enforcement/)): write-time at the catalog gateway, read-time at the SQL proxy, pre-write at the Spark transform, and as a post-commit detection backstop.
3. **Prove** — produce audit-grade evidence that the Contract was honored: a tamper-evident hash-chain audit log, lineage showing which engines touched which snapshots, and detection records for anything that slipped through.

Define is the authoring loop; Enforce is the runtime; Prove is what you hand an auditor.

## Why a lifecycle rather than live editing

Governance that lets you edit a live policy in place has no defensible story for *who changed what, when, and with whose approval*. By forcing every change through draft → review → compile → deploy, Neksur makes every active Contract the output of a recorded, signed-off process — and makes rollback a first-class transition rather than a panic.

## See also

- [The Data Contract](/concepts/data-contract/)
- [The unified contract model](/concepts/unified-contract-model/)
- [Meaning, Access, State](/concepts/dimensions/)
- [Enforcement model](/concepts/enforcement/)
