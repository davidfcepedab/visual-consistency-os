# DEPLOYMENT_LOG — P0 status-contract fix

## Snapshot before any change (Phase 1)
- Branch created: `feat/visual-os-p0-reference-handoff` off `feat/visual-library-curator-v1-3` @ `72d066d`.
- Cloud Run (before): revision `visual-identity-os-mcp-00015-kif` (tag `native-handoff`), 100% traffic, `/health` → `1.4.0`.
- Apps Script (before): pinned deployment id `AKfycbwYxC_J-3JLkrx97R5WIn3IbtTIT_z4mitSnS8ZL-7xiM9EINKHb6PYyyzx2kosId90` @ version 17 ("VISUAL OS — native generation handoff 1.4.0").

## Code changes (this session)
- Commit `03ffc6b` on `feat/visual-os-p0-reference-handoff`: status-contract fix
  (`REQUEST_CREATED` default, `READY_TO_GENERATE` only asserted by the
  verified `visual_prepare_generation` path), `blockerToStatusCode` mapping,
  regression test, docs (`RUNTIME_PARITY_REPORT.md`,
  `CANONICAL_AUTHORITY_REPORT.md`, `GENERATOR_HANDOFF_ADAPTER.md`).
- 55/55 tests pass (`npm test`).

## Apps Script deployment (user-authorized)
1. `clasp push -f` → pushed 16 files to script HEAD.
2. `clasp deploy` (new, isolated) → `AKfycby-tNaQIcYDTQVsH88zmoMLkPompC5pFRSiNKL4EzHbyuIYlRGuI8myI3Y_mMv9jwl6 @18`.
3. Canary validation against the new deployment's own `/exec` URL:
   `action=status` → matched production output (`captures:219, batches:56, review_queue:19, result_memory:200, assets:24, failures:199`).
   `action=generation_context` → returned a valid snapshot (new route, confirms `12.GenerationContext.js` is wired).
4. Promoted: `clasp deploy -i AKfycbwYxC_J-3JLkrx97R5WIn3IbtTIT_z4mitSnS8ZL-7xiM9EINKHb6PYyyzx2kosId90 -d "..."` → same pinned ID/URL now serves version 19 (the fixed code).
   **Rollback:** `clasp deploy -i AKfycbwYxC_J-3JLkrx97R5WIn3IbtTIT_z4mitSnS8ZL-7xiM9EINKHb6PYyyzx2kosId90 -V 17`.

## Cloud Run deployment (user-authorized)
1. `gcloud run deploy visual-identity-os-mcp --source . --no-traffic --tag p0-status-fix` → revision `visual-identity-os-mcp-00019-xec`, 0% traffic.
2. Smoke test: `curl https://p0-status-fix---visual-identity-os-mcp-4cf7h52zxa-uc.a.run.app/health` → `{"ok":true,"service":"visual-identity-os-mcp","version":"1.4.1"}`.
3. Promoted: `gcloud run services update-traffic --to-latest` → `visual-identity-os-mcp-00019-xec` now serves 100% of traffic.
   **Rollback:** `gcloud run services update-traffic visual-identity-os-mcp --to-revisions visual-identity-os-mcp-00015-kif=100 --project gen-lang-client-0945916493 --region us-central1` (or any other tagged revision — `native-handoff`, `safe-remediation`, `oauth-remediation` all remain intact at 0%).

## Drive corrections (user-authorized, reversible moves only — nothing deleted)
- Juan: 4 files moved `Juan/05. Generated Golden Support | Not Identity/` → `Juan/01. Priority 0 | Approved Identity Anchors/`
  (`JUAN_APPROVED_ANCHOR_2026-08-07_01/02/03_RIGHT_PROFILE/04_LEFT_PROFILE.jpeg`).
- Couple: 16 files moved `Couple/01. Priority 0 | Approved Identity Anchors/` → `Couple/06. Documentation.../Relationship anchors | Composition only/`
  (001, 005–019 — full list in `CANONICAL_AUTHORITY_REPORT.md`).
- **Not changed** (requires Sheets write access this session does not have): the
  `13_Asset_Index`/Automation Control `status`/`approval_state` fields for
  these same assets. The Reference Resolver reads sheet-recorded status, not
  folder location — so this Drive move alone does not yet make the MCP's
  automated resolver treat Juan's 4 files as `APPROVED`. See "Known
  limitation" in the final report.
