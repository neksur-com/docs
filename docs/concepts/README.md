# Concepts

In-depth explanations of the ideas Neksur is built on — what a **Data Contract** is, why it has three coupled dimensions, how its lifecycle works, and where the Contract is enforced in the data path. Read these before the architecture deep-dive if you want the *why* behind the design.

## Concept pages

- **[The Data Contract](./data-contract.md)** — the central abstraction: one Contract per dataset, what it binds, and why a *contract* rather than a *policy*.
- **[Meaning, Access, State](./dimensions.md)** — the three coupled dimensions of every Contract, what each guarantees, and why they are co-equal rather than layered.
- **[The Contract lifecycle](./lifecycle.md)** — the `draft → review → compile → deploy → active → audit` state machine, sign-offs, and the three buyer jobs (Define / Enforce / Prove).
- **[Enforcement model](./enforcement.md)** — the coordinated points where the Contract is enforced (catalog gateway, writer-side transform, read-path proxy, credential vending, post-commit detection) and why defense-in-depth across them is the design point.
- **[Editions and tiers](./editions.md)** — the four additive product tiers (Core / Multi-Engine / Defense-in-Depth / Intelligence), how a single binary gates them, and how the repositories map.

## See also

- [What is Neksur?](../intro/what-is-neksur.md) — the one-page overview these concepts expand on.
- [Architecture Overview](../architecture/overview.md) — how the concepts are realized in code.
- [Getting Started](../getting-started/install-and-first-policy.md) — what a Contract looks like in practice.

Have a concept you'd like documented? Open an issue.
