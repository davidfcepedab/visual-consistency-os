# Safe Remediation Contract

## Scope of this block

This block adds only:

1. `visual_get_capture`
2. `visual_detect_orphan_captures`
3. `visual_list_batches_by_project`

It does not implement metadata mutation, review registration, state
reconciliation, scoring retries, asset promotion, deletion, deployment, or
traffic changes.

## Common contracts

The reusable schemas in `src/contracts.ts` define:

- `dry_run`
- `idempotency_key`
- `expected_revision`
- `reason`
- `updated_by`
- `source_evidence`
- `overwrite`
- request `trace_id`
- audit records
- structured error responses
- revision-bound pagination cursors
- `VERIFIED_SOURCE`, `CANDIDATE`, and `UNKNOWN`

Inferred evidence, including filename, folder, heuristic, AI, and generated
summary sources, cannot be marked `VERIFIED_SOURCE`. Original identifiers,
timestamps, and human decisions are listed as immutable fields.

No mutation handler exists in this block. Consequently, tests exercise the
contract but produce zero writes and no audit ledger entries.

## Required Apps Script read actions

### `capture`

Input:

- `id`: exact `capture_id`
- `trace_id`

Success:

```json
{
  "ok": true,
  "capture": {
    "capture_id": "CAP-001"
  }
}
```

Missing capture:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND"
  }
}
```

The action must not search by filename, fuzzy name, or any alternate field.

### `orphan_snapshot`

Input:

- `trace_id`

Success:

```json
{
  "ok": true,
  "snapshot": {
    "revision": "opaque-revision",
    "captures": [],
    "batches": [],
    "requests": [],
    "reviews": [],
    "result_memory": [],
    "assets": []
  }
}
```

The revision must change when any participating dataset changes. The action is
read-only and must not repair records.

### `batches_catalog`

Input:

- `trace_id`

Success:

```json
{
  "ok": true,
  "revision": "opaque-revision",
  "batches": []
}
```

The catalog must include pending and terminal states, preserve explicit empty
project values, and return each `batch_id` only once.

## Pagination

The MCP sorts results deterministically, deduplicates them, and encodes the
offset with the source revision. A cursor from a different revision returns
`CONFLICT`; malformed cursors return `INVALID_CURSOR`.

## Error and log policy

Responses use a trace ID and a bounded structured error code. Logs do not
include secrets, authorization headers, full prompts, tokens, Apps Script
response bodies, or raw exception payloads.

## Rollback

The recovered production baseline is preserved by:

- commit `0e82a9350df3e01a36a6401536f92dba81773223`
- tag `production-baseline-2026-07-28`

Because no deployment or backend modification is part of this block, rollback
is a local branch selection operation. Production remains unchanged.
