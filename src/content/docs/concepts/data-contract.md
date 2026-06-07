---
title: "The Data Contract"
description: "The Data Contract is the central abstraction in Neksur. There is exactly one Contract per dataset, and it is the single thing every engine, catalog, and…"
---

The **Data Contract** is the central abstraction in Neksur. There is exactly one Contract per dataset, and it is the single thing every engine, catalog, and AI agent must honor when it touches that data.

## Why a contract, not a policy

Most governance tools express rules as *policies* attached to a specific enforcement point: a row filter in Snowflake, a masking rule in Unity, an RBAC grant in a catalog. Each rule lives where it is enforced, so it only holds for traffic that passes through that point. In a multi-engine lakehouse — Spark writing, Trino reading, Snowflake consuming, an AI agent on top — the same table is reachable through several points, and a rule defined at one of them is silently absent at the others.

A **Contract** inverts this. It is attached to the *dataset*, not to an enforcement point. Neksur then compiles and projects the Contract to wherever the data is reachable — the catalog gateway, the read-path proxy, the writer-side transform — so the guarantee is a property of the data, not of the path you happened to take to it.

This is also why it is a *contract* in the commercial sense: it is authored, reviewed, signed off, deployed, enforced, and audited as one governed object with accountable owners — not a config flag.

## What a Contract binds

A single Contract binds a dataset to three coupled dimensions:

- **[Meaning](/concepts/dimensions/#meaning)** — what the data *means*: metric and dimension semantics that compile to bit-identical results across every engine.
- **[Access](/concepts/dimensions/#access)** — who may see *what*: row filters, column masks, RBAC, and ABAC, enforced identically on read and write.
- **[State](/concepts/dimensions/#state)** — which *version* of the data everyone sees: snapshot pinning, schema versioning, write-conflict policy, partition-spec evolution, and compaction coordination.

These dimensions are co-equal and coupled — see [Meaning, Access, State](/concepts/dimensions/).

## One governed lifecycle

A Contract is not edited in place on a live system. It moves through a state machine — `draft → review → compile → deploy → active → audit` — with sign-offs at review and rollback paths at every stage. See [The Contract lifecycle](/concepts/lifecycle/).

## The Contract in the metadata graph

A Contract is not a YAML file sitting in a bucket. It is materialized as nodes and edges in a tenant-scoped property graph (Apache AGE on Postgres), alongside the catalog snapshots, columns, lineage, and audit events it governs. Because the Contract and the data it governs live in the same graph, Neksur can answer questions a flat policy store cannot:

- *Which Contracts govern any table downstream of this PII column?* (lineage traversal)
- *Did every engine that read this snapshot do so under an active Contract?* (audit traversal)
- *What does this metric mean, and which upstream tables feed it?* (semantic + lineage)

The same governed graph is what AI agents traverse over MCP — under the Contract's own Access policy, so an agent sees row-filtered, column-masked results, never the raw graph.

## AI agents as Contract consumers

LLM agents are treated as first-class Contract consumers, not a bolt-on. When an agent queries the graph through the MCP server, the Access dimension of every touched Contract is applied to its results — the same row-filter and column-mask compilation used for human read traffic. An agent cannot see data a human in the same role could not.

## See also

- [Meaning, Access, State](/concepts/dimensions/)
- [The Contract lifecycle](/concepts/lifecycle/)
- [Enforcement model](/concepts/enforcement/)
- [Architecture Overview](/architecture/overview/)
