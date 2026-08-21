# Visual Identity OS MCP

Remote MCP server for the Visual Identity OS control plane.

Current candidate version: `1.5.0` with 17 registered tools and two focused
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
