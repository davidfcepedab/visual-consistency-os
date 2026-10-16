# VIOS | Authority reconciliation — technical proposal (2026-10-15)

Status: **DRAFT / DESIGN ONLY / NOT DEPLOYED / NO CANON WRITES**  
Scope: Juan Primary discrepancy, Family HOLD/UNKNOWN, Couple geometry.

## Verified inputs and unresolved conflicts

- The live VIOS MCP `visual_get_canon_summary` reports **Couple** as `RELATIONSHIP_GEOMETRY_ONLY`, `facial_authority=false`; its P0-01 and additional relationship anchors are verified. **No Couple changes are needed.**
- The same MCP reports **Family** as `state=UNKNOWN`, `verification_status=NOT_VERIFIED`. The current-state pointer `VIOS_CURRENT_STATE_LIVE_2026-10-09.md` says `Family: HOLD`. **Family must stay non-executable; UNKNOWN cannot be interpreted as APPROVED.**
- VIOS MCP reports **Juan** `PRIORITY_0_PRIMARY` with `file_name=Juan | P0-01 | Primary cuerpo sentado tank negra | 011.png`; the October 9 pointer says Juan P0-01 original `006` (white shirt). The pointer also describes a generated `011` as non-facial authority. These are **conflicting evidence**, not grounds to automatically select either. Exact physical Drive file IDs, origin and human approval record are required.
- The GitHub `main` source examined on 2026-10-15 does not expose `visual_get_canon_summary` in `src/index.ts`, while the live connected MCP does. **SOURCE/RUNTIME PARITY IS NOT VERIFIED.** Do not merge/deploy this proposal or implement backend mutations until parity is established.
- Reported diagnostics from the live service are not authority decisions. Existing orphan/lineage findings must not be conflated with Primary approvals.

## Proposed read-only MCP contract

Tool: `visual_plan_authority_reconciliation` (NOT IMPLEMENTED).

Inputs:
- `subjects`: subset of `Juan`, `Couple`, `Family` (explicit).
- `trace_id`: optional; generated if absent.
- `expected_revision`: optional source-revision guard; stale revision yields `CONFLICT`.
- All evidence must be **loaded on the backend from the live authority resolver and immutable human decisions**; do not trust a caller-provided filename, pointer text, or Drive folder as identity authority.

Processing:
1. Read authoritative current MCP resolver data in one coherent revision. Read the current canonical pointer and exact provenance/human-decision rows, if supported by the backend.
2. For Juan, compare **exact asset/file IDs, states, roles, provenance, and human approval**. Never equate `011` or `006` labels with file IDs, infer approval from folder placement, or silently accept a generated asset as factual facial Primary.
3. For Couple, assert `RELATIONSHIP_GEOMETRY_ONLY`, no facial authority; only flag a discrepancy when those invariants fail.
4. For Family, require independently verified David/Juan/Mambo sources, documented Family composition governance, human approval and explicit operational state. Until then `HOLD / NOT_READY`. A Couple reference cannot substitute an individual identity or grant Family authority.
5. Return a deterministic read-only plan: `current`, `proposed`, `evidence` (exact source IDs and revisions), `discrepancies`, `risk`, `blockers`, `human_decision_required`, `trace_id`, `write_count=0`. If a source is inaccessible, return `MCP_BLOCKED`, not a guess.

**No automatic APPLY tool is authorized.** Any later mutation needs separate human approval with exact target IDs, before/after diff, dry-run, expected revision, idempotency key, bounded scope, audit trail, post-write readback and rollback plan. Historical evidence must never be deleted.

## Expected current read-only result

| Subject | Current | Proposed | Action |
|---|---|---|---|
| Couple | Verified geometry only | Same | NO_CHANGE |
| Juan | MCP Primary `011` vs pointer original `006` | NEEDS_REVIEW | Human/provenance reconciliation; no asset mutation |
| Family | MCP UNKNOWN; pointer HOLD | HOLD / NOT_READY | Define and explicitly approve composition authority later |

## Acceptance-test matrix (before any merge)

1. Couple with geometry-only verified anchors: `NO_CHANGE`, no facial reconstruction, `write_count=0`.
2. Juan exact-ID conflict: `NEEDS_REVIEW`, no selected winner and no automatic Primary replacement.
3. Juan generated-support Primary vs documented real-photo Primary: block facial authority until human provenance is proven.
4. Family UNKNOWN + pointer HOLD: `HOLD / NOT_READY`; no executable production prompt.
5. Family with all three individual Primary references verified but without human Family approval: still `HOLD`.
6. A missing or contradictory source: `MCP_BLOCKED` and no retries or writes.
7. A stale `expected_revision`: `CONFLICT` and no writes.
8. Duplicate source labels with distinct file IDs: never match by filename.
9. Successful repeated read: same ordered plan and zero writes.

## Release gates / manual decisions

- [ ] **P0** Recover/identify the deployed Cloud Run revision, container digest, Apps Script deployment/version, and source commit; reconcile GitHub with live runtime **without touching production**.
- [ ] **P1** Produce the exact Juan Primary evidence comparison and show the human approver the before/after proposed decision; do not auto-replace.
- [ ] **P1** Specify the Family composition-only governance and the exact human approval required to leave HOLD. No P0 promotion by implication.
- [ ] Implement and test the read-only planning tool on an isolated branch after source parity is restored.
- [ ] Run unit tests and `npm run build`, then no-traffic canary; verify tool discovery, zero writes and the full acceptance matrix.
- [ ] Obtain **separate, specific authorization** for any Canon/Primary/Family state change and for any deployment or traffic promotion.

This document is a proposal and does not change the live Visual Identity OS, existing primary references, Family status, or connection configuration.
