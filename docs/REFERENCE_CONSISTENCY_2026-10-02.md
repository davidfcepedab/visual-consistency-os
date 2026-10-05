# Reference consistency — 2026-10-02

The user authorized replacing David and Juan's active references with the
20 approved files selected in the chat, retaining filenames and archiving
previous files without deletion.

## Applied data reconciliation

- Automation Control ASSET_REGISTRY retains 85 records: 20 selected active
  references, with 13 FACIAL_IDENTITY_SUPPORT and 7 BODY_SUPPORT scopes.
- Prompt Generator 13_Asset_Index now mirrors those 20 exact file IDs at
  A332:O351, with structured scope, provenance, approval and use restrictions.
- Twelve historical index rows were marked SUPERSEDED, including seven
  still carrying approval states and five pending-review records.
- Human approval remains APPROVED. Provenance remains UNVERIFIED; these
  facts are deliberately distinct. No score, origin or factual authority
  was invented. No Primary or Master designation was assigned.
- CONFIG pins ACTIVE_DAVID_REFERENCE_VERSION and ACTIVE_JUAN_REFERENCE_VERSION
  to MANUAL_REFERENCE_2026-10-02. The candidate resolver filters facial/body
  defaults to this set, rather than falling back to older approved packs
  while the new set's provenance remains pending. Master and detail-lock
  configuration is retained.
- Existing names, IDs, historical approval notes and Drive files were retained.
- Readback confirmed matching IDs, states, scopes and provenance in both
  registries, with no remaining state conflict for the archived IDs in scope.

## Candidate resolver correction

Declared facial/body/support scope wins over filename and folder keywords.
An explicit UNVERIFIED/UNKNOWN/NEEDS_REVIEW provenance state cannot be labeled
VERIFIED_SOURCE merely because a status or actor records human approval.
Exact-file supersession in either registry excludes stale approved mirrors,
including references requested explicitly by ID. Approved generated body
support remains usable within its declared scope without becoming facial P0.

Tests use isolated fixtures and create no production requests or images.
Live status was previously ok:true with 85 assets. That response does not
establish physical attachment delivery or the deployed resolver revision.

## Release boundary

This source change is a candidate, not a production deployment. Follow
GIT_GOVERNANCE.md: test/build, immutable canary, read-only verification,
rollback evidence, then separately reviewed traffic promotion. Physical
delivery of the selected bitmaps remains a separate acceptance check.
Provenance reconstruction must precede a VERIFIED_SOURCE claim.
