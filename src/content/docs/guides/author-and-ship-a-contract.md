---
title: "Author and ship a Data Contract"
description: "This guide walks a Data Contract from an empty draft to live enforcement, using the web console. A Contract binds one dataset to three dimensions —…"
---

**Job:** Define → Enforce · **Edition:** Core.

This guide walks a [Data Contract](/concepts/data-contract/) from an empty draft to live enforcement, using the web console. A Contract binds one dataset to three dimensions — [Meaning, Access, State](/concepts/dimensions/) — and moves through one [lifecycle](/concepts/lifecycle/):

```
draft → review → compile → deploy → active → audit
```

## 1. Create the Contract from the catalog

1. Open **Catalog** in the sidebar.
2. Browse or search for the dataset(s) to govern. Toggle **List** / **Graph** to see lineage; click a row to inspect schema, classification, and ownership in the detail panel.
3. Select one or more datasets (checkboxes) and click **Promote to Contract** in the bottom bar.
4. Choose a mode:
   - **Independent** — a new Contract from a single dataset.
   - **Composite** — combine several datasets into one Contract envelope.
5. Name the Contract and set ownership. It is created in **draft** and you land on its Meaning tab.

## 2. Author the dimensions

The Contract detail screen has three dimension tabs (in fixed order) and a lifecycle strip across the top. An audit rail on the right records everything that happens to the Contract.

### Meaning

Define the metrics and dimensions for the dataset. Use **Add metric** to author a semantic model (YAML or visual form, compile-on-save). See [Author semantic metrics](/guides/author-semantic-metrics/).

### Access

Author the row filters, column masks, write-ACLs, and retention/residency/classification rules. A live preview shows the compiled policy. See [Author Access policies](/guides/author-access-policies/).

### State

Pin snapshots, review the owned tables' schema and partition spec, and see the lineage subgraph (2 hops up/down). This is the **State** dimension — which version of the data everyone sees.

## 3. Submit for review

1. In the lifecycle strip, click **Review**. A panel lets you request review and select approvers.
2. The Contract moves to **review**. Approvers find it in **Activity** (filter: *review*) and in the Contract itself.
3. Sign-offs are tracked per dimension and persona (data / access / governance owners). A dimension that hasn't changed since the last approval is marked *no-change* and doesn't need re-signing.
4. If a reviewer requests changes, the Contract returns to **draft**.

## 4. Compile and deploy

Once sign-offs are collected:

- **compile** — Neksur materializes the per-engine artifacts (the compiled Access policies, the semantic SQL). A compile failure returns the Contract to **draft** with the error shown.
- **deploy** — the compiled artifacts roll out to the enforcement points (the catalog gateway, the read-path proxy, the engines). A deploy failure returns to **compile**.

These transitions can be automatic on success or driven from the lifecycle strip, depending on your configuration.

## 5. Active

The Contract is now **active** — enforced everywhere:

- writes are policy-checked at the [catalog gateway](/guides/connect-spark-write-path/);
- reads are row-filtered and column-masked at the [read path](/guides/connect-read-path/);
- AI agents see the same enforcement [over MCP](/guides/ai-agents-mcp/);
- every decision is recorded in the [audit chain](/guides/compliance-and-audit/).

You can **roll back** to deploy from the lifecycle strip if you spot a problem.

## 6. Audit

Move an active Contract to **audit** for a post-active review against its audit evidence. A clean audit returns it to **active**; if drift is found, return it to **draft** to re-author. This is the **Prove** job — see [Compliance and audit](/guides/compliance-and-audit/).

## Lifecycle at a glance

| Stage | You can | On failure |
|-------|---------|-----------|
| draft | edit all three dimensions | — |
| review | collect sign-offs | → draft (revisions) |
| compile | materialize artifacts | → draft |
| deploy | roll out to engines | → compile |
| active | enforce; roll back | → deploy |
| audit | review evidence | → draft (re-author) |

Illegal jumps (e.g. draft → compile) are blocked by construction.

## Track progress in Activity

The **Activity** feed is the cross-Contract event stream — review approvals, deployments, and enforcement events — and is the operational view of the Prove job. Filter by event type and click through to any Contract.

## See also

- [The Contract lifecycle](/concepts/lifecycle/) — the concept behind this walkthrough.
- [Using the web console](/guides/using-the-web-console/) — full tour of the screens.
- [Author Access policies](/guides/author-access-policies/) · [Author semantic metrics](/guides/author-semantic-metrics/)
