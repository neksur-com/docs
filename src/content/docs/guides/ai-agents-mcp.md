---
title: "Connect an AI agent over MCP"
description: "Neksur exposes its governed metadata graph to LLM agents over the Model Context Protocol (MCP). The key property: agents are first-class Contract…"
---

**Job:** Enforce · **Edition:** Core (the read tools). The enforcing write tool is Commercial.

Neksur exposes its governed metadata graph to LLM agents over the **Model Context Protocol (MCP)**. The key property: agents are **first-class Contract consumers**, not an exception. Every traversal runs under the same Access row-filter and column-mask push-down used for human read traffic — an agent cannot see data a human in the same role couldn't.

## Connect

The server hosts an MCP endpoint (an HTTP/streamable transport) authenticated with a bearer token. Point your MCP client at it:

```jsonc
// example MCP client config
{
  "mcpServers": {
    "neksur": {
      "url": "https://neksur.example.com/v1/mcp",
      "headers": { "Authorization": "Bearer ${NEKSUR_TOKEN}" }
    }
  }
}
```

The token resolves to one tenant and one principal; the principal's roles determine what the agent can see. (Check your deployment for the exact MCP path and token issuance — issue M2M tokens from **Settings → Tokens**, admin-gated.)

## Tools

### `graph.traverse`

The generic, parameterized traversal tool. The agent supplies a starting node selector, an edge type (from a whitelist of canonical labels), a direction, and bounded depth/limit:

```jsonc
graph.traverse({
  "selector": "Table{id='...'}",
  "edge_type": "LINEAGE_OF",
  "direction": "out",
  "max_depth": 3,
  "limit": 100
})
```

It returns nodes and edges (with a pagination cursor). Safety is built in: only whitelisted edge labels are allowed, traversal depth is bounded, queries are parameterized (no Cypher injection), and **row-filter / column-mask policy is pushed down** — restricted nodes never appear in results, counts, or the cursor.

### Preset recipes

Four higher-level presets ride on `graph.traverse` for common agent tasks:

| Preset | Answers |
|--------|---------|
| `ai_agent_context` | "What is this dataset's Contract?" — the three-dimension (Meaning / Access / State) view of a Contract. |
| `impact_analysis` | "What breaks if this changes?" — downstream Contract-to-Contract dependencies. |
| `pii_propagation` | "Where does this PII flow, and is it covered?" — PII closure with Access-dimension coverage. |
| `explain_a_number` | "How is this metric computed?" — the metric's calculation chain back to source tables. |

Each returns the same governed, Access-filtered graph data.

### `policy.evaluate_write` (Commercial)

An enforcing write-gate tool that lets an agent check whether a proposed write would be allowed. It is a no-op stub in Core and active in the Commercial edition.

## Why this is safe to point an agent at

- **Same policy as humans.** No separate "agent policy" to drift — the Contract's Access dimension is the one source.
- **Bounded and parameterized.** Whitelisted edges, capped depth, parameter binding, per-query budgets (see ADR-005, the MCP hardening contract).
- **Auditable.** Agent traversals are subject to the same tenant scoping and audit surface as any other access.

## See also

- [The Data Contract → AI agents as Contract consumers](/concepts/data-contract/#ai-agents-as-contract-consumers)
- [Author Access policies](/guides/author-access-policies/) — what the agent's results are filtered by.
- [Architecture → API surface](/architecture/overview/#api-surface)
