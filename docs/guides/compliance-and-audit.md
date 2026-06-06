# Compliance and audit

**Job:** Prove · **Edition:** Core (audit chain, detection, FinOps); ML detection is Intelligence; offline chain verification is a Commercial build.

The **Prove** job is about defensible evidence: that every Contract was honored, who did what, and that the record hasn't been tampered with. Neksur produces that evidence as a by-product of enforcement — you don't assemble it after the fact.

## The tamper-evident audit chain

Every governance decision — a commit allowed or denied, a lifecycle transition, a sign-off — is written to an append-only audit log whose rows are linked into a **hash chain**: each row's hash incorporates the previous row's, so any insertion, deletion, or edit breaks the chain downstream. The audit row and its graph emission land in the **same transaction**, so a half-written audit trail is not a reachable state.

### Verify the chain offline

The `neksur-verify-chain` tool re-checks the chain independently of the running server — useful for an auditor who wants to confirm integrity without trusting the live system:

```bash
neksur-verify-chain \
  --tenant-uuid <tenant-uuid> \
  --database-url "$DATABASE_URL" \
  --kms-key-arn arn:aws:kms:us-east-1:...:key/... \
  --table audit_log \
  --output json
```

Exit `0` = chain intact and all signatures valid; non-zero = a break or invalid signature, with the offending row identified. You can scope a range with `--from-id` / `--to-id`, verify `audit_log` or `audit_events`, and verify with either a KMS key or an exported ECDSA public key (`--public-key-pem`). See the [CLI reference](../reference/cli.md#neksur-verify-chain).

## Detection findings

The post-commit detector records what slipped past the write path. Each finding is a node in the graph linked to the offending snapshot, with a classification and confidence:

- **Core** ships a regex classifier (SSN, email, credit card, phone, IBAN) with confidence scoring tuned to avoid false positives (a column *named* `email` carrying integers doesn't alert; name + matching values does).
- **Intelligence** adds an ML classifier and a **training-data curation** workflow (admin/DPO-gated): scan a table to pre-label columns, review/correct labels against a taxonomy, and export curated labels for training. Confident findings can drive Defense-in-Depth quarantine / rollback workers.

Findings appear in the Contract's **State → Quality** view and in **Activity**.

## Subject requests and impact analysis

Because Contracts, lineage, and detection findings live in one graph, compliance questions become traversals:

- *Where does this PII propagate, and is every downstream Contract covering it?* — the `pii_propagation` view (also available [to AI agents over MCP](./ai-agents-mcp.md)).
- *What is affected if we change/delete this dataset?* — `impact_analysis`.

These underpin data-subject-request and DPIA workflows.

## FinOps cost attribution

Read traffic through the proxy is metered, so cost can be attributed per engine, user, and day. The **Settings → Cost** dashboard shows the breakdown (read-only), with a per-engine summary for multi-engine tenants. This ties spend back to the Contracts and principals that incurred it.

## Putting it together for an audit

1. **Lineage** shows which engines touched which snapshots.
2. The **audit chain** shows every decision and transition, provably unaltered.
3. **Detection** shows what was caught and when.
4. **DQ breaches** ([data quality](./data-quality.md)) show whether quality guarantees held.
5. **Sign-offs** in the Contract lifecycle show who approved each change.

That bundle is what you hand an auditor — generated continuously, not reconstructed.

## See also

- [Data quality contracts](./data-quality.md)
- [The Contract lifecycle → Prove](../concepts/lifecycle.md#the-three-buyer-jobs)
- [CLI reference → neksur-verify-chain](../reference/cli.md#neksur-verify-chain)
