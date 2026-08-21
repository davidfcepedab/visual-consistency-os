# Visual Identity OS MCP 1.5.0

Release date: 2026-08-20 (America/Bogota)

## Objective

Make periodic library maintenance complete, idempotent and useful without
automating identity authority or physical Drive organization.

## Verified implementation

- 90 contract tests pass and the TypeScript build passes.
- 17 MCP tools are registered, including
  `visual_apply_library_reconciliation`.
- Apps Script deployment v28:
  `AKfycbya2GYOXysIlkp0QpZsRnUBVXqmCXyowCp_gja8OuZncMtJaq1nO-EF_2DjW1P3QlH4`.
- Cloud Build: `1b9d0dca-0fb3-4c31-a85a-3e488c40dfed`.
- Image digest:
  `sha256:3dbd109e704f3bf35c114b9fee9915399669d8409a4819d6140167177bba2f9e`.
- Cloud Run revision: `visual-identity-os-mcp-00035-pas`, promoted to
  100% traffic after canary validation.
- Claude-specific service:
  `visual-identity-os-mcp-claude-00001-pxl`; API-key protected and connected
  to Claude Code without changing the OAuth contract used by ChatGPT.

## Complete inventory evidence

- Coverage: COMPLETE.
- Files: 3,050 unique across seven pages; zero duplicate IDs in traversal.
- Captures: 219.
- Result memory: 200.
- Asset registry before remediation: 24.
- Asset index: 326.
- Direct Drive checks: 303 EXISTS and 44 NOT_FOUND. No reference was labeled
  broken from absence in a partial scan.

## Applied remediation

One bounded batch registered ten exact Drive files already located in Ready,
Locations or Inspiration as `CANDIDATE / NEEDS_REVIEW`. Each row has source
file ID and appended audit evidence. The same idempotency key replayed the
stored result without additional rows. No file was moved, renamed or deleted;
no identity, face, tattoo, ring, Detail Lock, Identity Master or Publication
Ready state was verified or promoted.

## Scoring policy correction

- Hard reject now means any identity, overall or anatomy score below 3.0.
- Scores 3.0–3.9 remain Diagnostic/ADJUST, not REJECT.
- Automatic approval remains strict at the existing approved thresholds.
- ADJUST no longer creates a FAILURE_MEMORY row; hard reject and technical
  failures still do.

Historical rows were not rewritten or deleted. The reported 199 failures are
therefore accumulated history, not the count produced by the corrected policy.

## Human queue

The 44 NOT_FOUND Drive references, files in Inbox/Review/Identity
Masters/Archive/Docs, duplicates, metadata gaps, conflicts and all identity or
continuity authority decisions remain human-reviewed.

## Rollback

- Cloud Run: route traffic back to the previously active revision
  `visual-identity-os-mcp-00028-jef`.
- Apps Script: restore the prior deployment URL in Cloud Run; deployment v27
  is retained.
- Data: the ten new registry rows are non-authoritative candidates and are not
  physically destructive. Do not delete them automatically; mark or reconcile
  them through a separately approved audit action if rollback is required.
