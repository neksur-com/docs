# Using the web console

**Edition:** Core. Some surfaces are role-gated (admin / DPO) or edition-gated, as noted.

The Neksur web console is organized around the [Data Contract](../concepts/data-contract.md). This is a tour of its screens and the main workflows.

## Navigation

The left sidebar has four top-level destinations, plus a **Recents** list of the contracts and datasets you visited last:

| Nav | Purpose | Maps to |
|-----|---------|---------|
| **Catalog** | Browse and discover Iceberg datasets; the entry point for creating Contracts. | Define |
| **Contracts** | View and manage every Data Contract. The canonical workflow surface. | Meaning / Access / State |
| **Activity** | Cross-Contract event log: reviews, deploys, enforcement. | Prove |
| **Settings** | Profile, tokens, fiscal calendars, compile config, classifier curation, cost. | — |

You can set your default landing screen in **Settings → Profile**.

## Catalog

A three-pane discovery surface:

- **Left** — a namespace tree (multi-select) to drill into the catalog.
- **Center** — a searchable, multi-select dataset list with a **List ⇄ Graph** toggle (graph mode shows lineage as a diagram). Columns include name, owner, classification, and whether a Contract already exists.
- **Right** — a detail panel (when a dataset is selected) with the fully-qualified name, classification, schema, and lineage.

**Primary action:** select datasets → **Promote to Contract** (Independent: one dataset; Composite: several into one envelope). Filters and selection persist in the URL so views are shareable.

## Contracts

**List view** — every Contract in the tenant, with owner, classification, a Defense-in-Depth indicator (catalog · write-path · continuous-scan · compute-isolation, each shown as active / available / outside-tier), and consumers. A lifecycle bar shows how many Contracts sit in each stage.

**Detail view** — a 60/40 layout: editing on the left, a read-only **audit rail** on the right.

- **Identity strip** — dataset URI (links to Catalog), owner, classification, the Defense-in-Depth badge, and downstream consumers.
- **Lifecycle strip** — the six stages (draft → review → compile → deploy → active → audit). The current stage is highlighted; legal transitions are clickable and open an action/approval panel.
- **Dimension tabs** (fixed order):
  - **Meaning** — author metrics/dimensions (YAML + form, compile-on-save). See [Author semantic metrics](./author-semantic-metrics.md).
  - **Access** — author row filters, column masks, and retention rules, with a live compiled-policy preview. See [Author Access policies](./author-access-policies.md).
  - **State** — snapshot pins, owned-table schema, partition spec, a lineage subgraph (2 hops up/down), and a nested **Quality** section (DQ + detection findings).

Deep links work for everything: `/contracts/{slug}/access`, `/contracts/{slug}/lifecycle/review`, `/contracts/{slug}/audit/{event_id}`.

The full walkthrough is in [Author and ship a Data Contract](./author-and-ship-a-contract.md).

## Activity

A time-ordered, filterable feed (All / Review / Deploy / Enforcement) of everything that happened to Contracts. Review cards show the sign-off matrix; deploy cards show rollout status; enforcement cards show actions taken (e.g. a blocked query). Click any Contract name to jump to it. This is the operational face of the **Prove** job.

## Metrics

A standalone registry of semantic models. **Add metric** opens a YAML/form editor with a starter skeleton; saving compiles the model and routes to its detail page, which has **Definition**, **Lineage**, and **History** (version timeline) tabs. Metrics authored here are the **Meaning** building blocks Contracts pin. See [Author semantic metrics](./author-semantic-metrics.md).

## Settings

| Sub-page | What you do | Gating |
|----------|-------------|--------|
| **Profile** | Identity (edited via your IdP), default landing surface, theme, sign out. | all users |
| **Tokens** | Issue machine-to-machine API tokens; the secret is shown once, copy-to-clipboard, never re-shown. | admin |
| **Fiscal calendars** | Connect a standard / 4-4-5 / arbitrary calendar (kind + FY anchor month); delete calendars. | admin |
| **Compile config** | Tune the recursive-hierarchy max depth for metric resolution. | admin |
| **Classifier curation** | Scan a table to pre-label columns with the ML classifier; review/correct labels against the taxonomy; export curated labels. | admin / DPO (Intelligence) |
| **Cost** | FinOps dashboard: cost by engine / user / day, with a per-engine summary. Read-only. | all users (data per edition) |

## A typical first session

1. **Catalog** → find your dataset → **Promote to Contract**.
2. On the new draft, author **Meaning** (a metric), then **Access** (a row filter / mask).
3. Use the **lifecycle strip** → **Review**, pick approvers.
4. Approvers act from **Activity**; once signed off, the Contract compiles, deploys, and goes **active**.
5. Watch enforcement and audit events stream into **Activity** and the Contract's audit rail.

## See also

- [Author and ship a Data Contract](./author-and-ship-a-contract.md)
- [Author Access policies](./author-access-policies.md) · [Author semantic metrics](./author-semantic-metrics.md)
- [Compliance and audit](./compliance-and-audit.md)
