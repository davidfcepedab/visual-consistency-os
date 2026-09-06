# Visual Identity OS MCP

Remote MCP server for the Visual Identity OS control plane.

Current candidate version: `1.5.1` with 17 registered tools and two focused
agent skills.

This branch is the controlled integration line based on the source that
produced Cloud Run revision `visual-identity-os-mcp-00008-rr2`. Apps Script v13
remains active; the new read contract is deployed separately as Apps Script
v16 for canary validation. Cloud Run changes are validated on tagged revisions
before traffic is promoted, with `00008-rr2` retained as the immediate rollback.

## Exposed tools

The recovered production baseline registers these ten tools:

- `visual_get_system_status`
- `visual_list_pending_batches`
- `visual_get_batch`
- `visual_list_recent_captures`
- `visual_create_session`
- `visual_close_session`
- `visual_create_request`
- `visual_cancel_request`
- `visual_submit_decision`
- `visual_promote_asset`

This branch adds three read-only tools:

- `visual_get_capture`
- `visual_detect_orphan_captures`
- `visual_list_batches_by_project`

Version 1.3.0 adds two library-maintenance tools:

- `visual_list_library_inventory`
- `visual_plan_library_reconciliation`

Version 1.4.1 keeps the native-host generation handoff tool and closes the
readiness gates that made 1.4.0 unsafe to promote:

- `visual_prepare_generation`

This tool resolves identity authority from CONFIG, ASSET_REGISTRY,
`13_Asset_Index`, CAPTURES, and REQUESTS, creates a traceable request when
ready, and returns a generation packet. The MCP never renders images and never
infers host renderer availability from its own tool list. `READY_TO_GENERATE`
and `request_id` are control-plane outputs, not the image. When
`ready_to_generate=true`, the host must invoke its native image generator in
the same turn and return the bitmap. `visual_create_request` does not generate.

Version 1.5.0 adds `visual_apply_library_reconciliation`. Drive inventory now
traverses the configured Inbox and organized-library roots to completion using
a continuation cursor. Sheets are revision-checked at the beginning and end;
partial traversal is an error, never labeled complete. Automatic application
is limited to registering an exact Drive file as `CANDIDATE / NEEDS_REVIEW` or
appending provenance to an exact current human APPROVED/REJECTED decision. It
requires dry-run, idempotency, expected revision, actor, reason and source
evidence, and never moves, renames, deletes, verifies identity or promotes an
asset.

## Agent skills

Only two user-facing skills are maintained in `skills/`:

- `direct-visual-identity`: prompt, generation/edit routing, continuity review,
  and human approval gates.
- `maintain-visual-library`: periodic inventory and dry-run reconciliation of
  Inbox, organized Drive library, Prompt Generator, and Automation Control.

The narrower prompt, audit, gate, and traceability instructions are consolidated
inside these two skills rather than exposed as overlapping agents.

The new tools use these Apps Script GET actions:

- `capture`: exact lookup by `capture_id`
- `orphan_snapshot`: versioned snapshot of captures, batches, requests,
  reviews, result memory, and assets
- `batches_catalog`: versioned batch catalog including pending and terminal
  states
- `library_snapshot`: exhaustive cursor-based Drive and revision-stable Sheets
  snapshot used for deterministic inventory and reconciliation planning
- `apply_library_reconciliation`: allowlisted candidate registration or
  audit-only consolidation with optimistic concurrency and idempotency

Fixture-only reference implementations live in
`apps-script-isolated/`. They are exercised end-to-end over local HTTP but are
not connected, merged, or deployed to the production Apps Script project.

The Apps Script router associated with the MCP deployment was recovered and
integrated without replacing the active v13 deployment. Evidence, baseline
hashes, and the remaining review gate are in
[`apps-script-recovered/`](apps-script-recovered/RECOVERY_REPORT.md).

## Safety contract

- Read tools never mutate state.
- Missing lineage is reported as `UNKNOWN`, not as verified metadata.
- Broken references are distinguished from absent or unknown metadata.
- Pagination cursors are bound to a dataset revision.
- Backend errors are returned as structured errors without response bodies,
  prompts, tokens, or secrets.
- `MCP_API_KEY` is mandatory when `NODE_ENV` is not `development`, `test`, or
  `local`.
- OAuth access tokens are verified with RS256 against the configured issuer
  JWKS, issuer, and audience. Static API-key authentication remains available
  only for controlled smoke tests and rollback access.
- Protected-resource metadata is exposed at both standard discovery paths.
- Mutation contracts require dry-run, idempotency, optimistic concurrency,
  evidence, actor, reason, trace ID, audit data and readback. Only the bounded
  library reconciliation mutation above is implemented.
- Physical deletion is not part of the contract.

See [docs/SAFE_REMEDIATION_CONTRACT.md](docs/SAFE_REMEDIATION_CONTRACT.md).

## Required environment variables

```text
NODE_ENV=production
VISUAL_OS_WEB_APP_URL=<Apps Script deployment URL>
VISUAL_OS_SHARED_SECRET=<Apps Script shared secret>
MCP_API_KEY=<MCP client API key>
OAUTH_ISSUER=https://<tenant>.auth0.com/
OAUTH_AUDIENCE=https://visual-identity-os-mcp
OAUTH_RESOURCE=https://visual-identity-os-mcp
MCP_PUBLIC_URL=https://<service-host>/mcp
OAUTH_SCOPES=openid profile email offline_access
```

Do not commit real values or print them in logs.

## Isolated validation

The recovered dependency tree is used as-is; no package installation is
required for the contract tests:

```bash
npm test
npm run build
```

The test suite starts a local HTTP endpoint for the isolated Apps Script
adapter, calls all three actions through the real MCP read client, and closes
the endpoint without external network access.

Local smoke test with fixture-only values:

```bash
NODE_ENV=production \
VISUAL_OS_WEB_APP_URL="http://127.0.0.1:9" \
VISUAL_OS_SHARED_SECRET="fixture-only" \
MCP_API_KEY="fixture-only" \
PORT=18080 \
npm start
```

Health endpoint: `http://localhost:18080/health`

MCP endpoint: `http://localhost:18080/mcp`

## Reference Packs synchronization repair (candidate, not deployed)

The library adapter previously scanned only Inbox and Image Library. Reference
Packs is a separate subtree and was excluded regardless of folder names. This
candidate includes the verified Reference Packs root by ID; renamed descendants
are discovered through parent IDs. Membership remains inventory evidence only.
`REGISTER_CANDIDATE` still cannot approve or promote identity references.

Generation reads both `ASSET_REGISTRY` and `13_Asset_Index`. Moving a Drive file
does not update either registry. Historical `APPROVED_TOP` entries with the
explicit V6 audit result `exact Drive ID returned 404 / NOT_FOUND` are now excluded
from generation packets, including explicit reference requests. A subsequent
structured `physical_status=EXISTS` check can supersede that historical warning;
it does not itself grant approval. Existing human decisions are not rewritten.

After deploying this candidate through the existing canary release gate:

1. Record direct Drive edits as exact file IDs, old/new parent IDs, and the human
   decision source. Preserve the existing primary unless separately authorized.
2. Call `visual_plan_library_reconciliation` with `dry_run=true` and
   `force_refresh=true`, **without a cursor**. The new flag bypasses the five-minute
   in-process cache. It is unavailable on the previous deployment.
3. Confirm `scan.complete=true` and inspect exact IDs through the paginated
   inventory. Continue using returned cursors with `force_refresh=false`.
   Cursors now bind to the Drive scan as well as the Sheets revision; if a scan
   expires, restart explicitly instead of mixing pages across scans.
4. Dry-run candidate registration for missing IDs using the returned Sheets
   `revision`. Apply only the authorized diff with an idempotency key and readback.
   This step does not reconcile authority or change P0 composition.
5. Reconcile the exact human-approved authority changes through an authorized
   authority operation and verify both registries and the governing document.
   The current exposed MCP tools still lack exact-file-ID P0 upsert/demotion:
   `visual_promote_asset` requires an existing approved capture. The internal
   `update_asset_authority` adapter matches names, cannot insert absent rows, and
   is not an adequate substitute for that missing operation. Do not bypass these
   limits by silently editing authority cells.
6. Only after registration and authority reconciliation, validate the generation
   packet's selected IDs and physical attachments. A minimum ECONOMY packet may
   attach just the facial primary; body-sensitive requests must explicitly
   require the approved body references needed for that request.

Deployment, authority reconciliation and physical delivery verification remain
separate release gates. Local tests do not establish production readiness.
