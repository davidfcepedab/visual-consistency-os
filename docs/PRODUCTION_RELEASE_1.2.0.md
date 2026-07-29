# Visual Identity OS MCP 1.2.0 production release record

Date: 2026-07-28 (America/Bogota)

## Outcome

- Apps Script version 13 is deployed on the existing production deployment.
- Cloud Run revision `visual-identity-os-mcp-00009-pig` was built and validated at 0% traffic.
- Production traffic was temporarily promoted to revision `00009-pig`.
- The installed Visual Identity OS connector returned HTTP 401 because it is configured without authentication and does not send `MCP_API_KEY`.
- Traffic was immediately rolled back to revision `visual-identity-os-mcp-00008-rr2`.
- The installed connector was verified healthy again after rollback.

This is a controlled partial release. The Apps Script backend is on v13, while
the public MCP endpoint remains on the previous Cloud Run revision until the
connector authentication contract is reconciled.

## Apps Script

- Script ID: `1Fgf6jzzjVWBN7zH-hsTFuTbD4LdC4UDgjEnDtoR3UeScdk1b8KnmLpRS`
- Existing deployment ID:
  `AKfycbwYxC_J-3JLkrx97R5WIn3IbtTIT_z4mitSnS8ZL-7xiM9EINKHb6PYyyzx2kosId90`
- Active version: 13
- Description: `VISUAL OS v4.5.0 — safe read remediation`
- Rollback version: 10
- Production writes performed by the release smoke tests: 0

Version 13 preserves the prior routes and adds:

- `get_capture`
- `detect_orphan_captures`
- `list_batches_by_project`

## Cloud Run candidate

- Project: `gen-lang-client-0945916493`
- Region: `us-central1`
- Service: `visual-identity-os-mcp`
- Candidate revision: `visual-identity-os-mcp-00009-pig`
- Candidate image digest:
  `sha256:8623b003071ba11c16263db072338b7d7a3ddcda87df83decffa1c2b0a030ed6`
- Candidate tag: `safe-remediation`
- Candidate traffic after rollback: 0%
- Active rollback revision: `visual-identity-os-mcp-00008-rr2`
- Active production traffic: 100%
- Previous image digest:
  `sha256:e9c0f1148ccd78c2052470554a7faa0c33e9b36518eca73a3368535f25e03431`

## Validation

- TypeScript build: PASS
- Contract tests: 26/26 PASS
- Apps Script syntax checks: PASS
- Candidate health endpoint reports version 1.2.0: PASS
- MCP initialize: PASS
- MCP tool listing: PASS, 13 tools
- Existing system status read: PASS
- Recent capture read: PASS
- Exact capture read: PASS
- Orphan detection read: PASS
- Empty-project batch listing: PASS
- Production record writes during smoke: 0
- Installed connector against candidate: FAIL, HTTP 401
- Installed connector after rollback: PASS

## Blocking contract mismatch

The 1.2.0 server enforces the required non-local startup and request
authentication contract through `MCP_API_KEY`. The currently installed
ChatGPT/Codex app is configured without authentication. The supported custom
app mechanisms are OAuth, no authentication, or mixed OAuth/no authentication;
the existing app cannot inject the static API key used for the isolated smoke.

Do not remove the production authentication requirement merely to make the old
connector work. Complete an OAuth or mixed-authentication implementation and
refresh/recreate the app before promoting revision `00009-pig`.

## Rollback commands

Cloud Run:

```sh
gcloud run services update-traffic visual-identity-os-mcp \
  --project gen-lang-client-0945916493 \
  --region us-central1 \
  --to-revisions visual-identity-os-mcp-00008-rr2=100
```

Apps Script:

```sh
clasp redeploy \
  AKfycbwYxC_J-3JLkrx97R5WIn3IbtTIT_z4mitSnS8ZL-7xiM9EINKHb6PYyyzx2kosId90 \
  -V 10
```

## Next release gate

1. Select and configure an OAuth issuer for the Visual Identity OS app.
2. Implement OAuth resource-server validation and MCP security metadata.
3. Recreate or refresh the Visual Identity OS app and enable the three new
   read-only actions.
4. Repeat tagged smoke tests.
5. Promote `00009-pig` or a successor revision only after the installed app
   succeeds with authentication.
