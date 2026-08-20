# CANONICAL_AUTHORITY_REPORT — AGENT B findings, Orchestrator-adjudicated

Source: Agent B (read-only Drive/filesystem inspection), adjudicated against
the P0 human-decision policy. No file was moved, renamed, or deleted as a
result of this report — routing changes below are proposals pending the
explicit approvals requested in this session.

## David — HEALTHY, no change

`01. Priority 0` unchanged: 10 files (7 `DAVID_APPROVED_ANCHOR_2026-08-07_0[1-7]`
+ 3 real body masters `2026-07-27`). **Resolver may use as-is.**

## Mambo — HEALTHY, no change

`01. Priority 0` unchanged: 11 real camera-pattern photos. **Resolver may
use as-is.**

## Family — HOLD, no change

`01. Priority 0` empty. Not in scope for the P0 test scene.

## Juan — HUMAN_DECISION_REQUIRED (blocks the 3-subject end-to-end test)

Two candidate sets, neither meets the "unambiguous human approval" bar on
its own:

- **Set A / Tier A1** (`05. Generated Golden Support | Not Identity/JUAN_APPROVED_ANCHOR_2026-08-07_0[1-4]*`):
  strongest evidence available — a documented 2026-08-07 session narrative
  claims score 5.0/5.0 and names these 4 views (front/¾/right/left profile)
  as the approved set — but no named human approver, no literal "PROMOTE"
  decision on record. **Misfiled**: sits in the "Not Identity" support
  folder, not in `01. Priority 0`.
- **Set A / Tier A2** (5 files dated 2026-08-09/08-10, "_CLINICAL_SCORE5"):
  no corroborating document found anywhere in the tree — only the filename
  self-declares approval. Not recommended under any circumstance without
  explicit human sign-off.
- **Set B** (the 11 files physically in `01. Priority 0` today, dated
  2026-08-15): the system's own reconciliation report already concludes
  `NEEDS_REVIEW`, explicitly awaiting a human "PROMOTE [filename]" reply
  that never arrived (checked both the 2026-08-17 report and its identical
  2026-08-18 "UPDATED" copy).

**Orchestrator decision:** neither set is promoted automatically. Per
policy, this is escalated to David as a named decision (see chat) rather
than resolved by inference. The P0 implementation proceeds on every
technical layer that doesn't require this decision; the 3-subject
end-to-end test scene requires Juan and is **held** at
`BLOCKED_REFERENCE_AUTHORITY` until answered.

## Couple — resolved conservatively, does NOT block P0

All 16 `01. Priority 0` files classified **UNVERIFIED** (no named approver +
no score + provenance discrepancy on file `001` + 6 of 16 traced to a
same-minute batch rename from `...Under Review/...Candidate.png` with the
word "Candidate" simply dropped). None reach `VERIFIED HUMAN APPROVED`; none
are `REJECTED/SUPERSEDED` either.

**Why this doesn't block P0:** the required end-to-end test scene uses
`@couple_connection`/`@family_portrait` as *relationship* tags only (pose/
proximity/composition), never as a source of David's or Juan's facial
identity — and the existing test suite already asserts this boundary
("Test B — couple keeps separate identities and does not face-blend from
couple refs"). Per the conservative rule, these 16 files are barred from
ever controlling facial identity; that constraint is already true in code
(the resolver never reads Couple-folder assets as `identity_authority` for
an individual subject) and requires no new code to enforce for this test.

**Recommended follow-up (not P0-blocking):** move the 16 files from
`Couple/01. Priority 0` to `Couple/06. Documentation.../Relationship
anchors | Composition only` (a reversible rename/move, not a delete) —
flagged for David's approval alongside the Juan decision, executed only on
explicit confirmation.

## Decisions requested from David (see chat, not auto-resolved)

1. Confirm or reject Juan Tier A1 (4 files, 2026-08-07 session) as the
   active Priority 0 identity set — enables a same-day routing fix
   (move from "Not Identity" into "01. Priority 0", no status invented).
2. Confirm whether the 16 Couple files should be relabeled as
   Relationship/Composition anchors (recommended) or handled differently.
