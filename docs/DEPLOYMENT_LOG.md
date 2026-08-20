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

## Round 2 (this session, continued): Juan authority fix + resolver bug found via zero-cost acceptance test

1. Added `update_asset_authority` Apps Script action (`14.AssetAuthority.js`, dry_run=true by default, mirrors `visual_plan_library_reconciliation`'s safety convention). Canary-validated (deployment @20), promoted to pinned id (@21).
2. Real (non-dry-run) write executed for Juan's 4 files: `Status` → `PRIORITY_0_PRIMARY`/`PRIORITY_0_APPROVED`, `Folder` → corrected path, `Notes` → provenance line (`approved_by: David Cepeda`, citing `Juan | Chat consolidation 2026-08-07.md` score 5.0). Independently re-verified by re-reading `generation_context`.
3. Ran the zero-cost acceptance test (`tools/call visual_prepare_generation`, David+Juan+Mambo+@loc_bog_salatv, **no image generated**) directly against the live MCP over the real protocol (initialize → notifications/initialized → tools/call), authenticated with the static `MCP_API_KEY`. This also **independently confirmed the server exposes all 16 tools**, including `visual_list_library_inventory`, `visual_plan_library_reconciliation`, and `visual_prepare_generation` — the "connector shows fewer tools" issue is proven to be client-side (ChatGPT's connector cache), not a server/deployment gap.
4. First acceptance-test run: `ready_to_generate: false` for all three subjects — root cause found: `isUsableStatus()`/`isVerifiedApproval()` only matched a schema (`human_anchor_approval` column, bare `"PRIORITY_0"`) the real `13_Asset_Index` sheet never uses, so nothing — including David's already-healthy anchors — was ever verified, and the resolver silently fell back to a deprecated/broken duplicate row.
5. Fixed in code (`src/prepare-generation-tools.ts`): split into `USABLE_STATUS_VALUES` (broad) vs. `VERIFIED_APPROVAL_STATUS_VALUES` (narrow: `APPROVED`, `PRIORITY_0_PRIMARY`, `PRIORITY_0_APPROVED`, `APPROVED_TOP`, `APPROVED_GOOD`). 56/56 tests pass (new regression test added). Built, canary-deployed (`00021-jan`, tag `p0-status-vocab-fix`), smoke-tested with the same zero-cost `tools/call`, promoted to 100%.
6. Second acceptance-test run (post-fix): David and Mambo now resolve correctly (`VERIFIED_SOURCE`, real files, real p0_refs count). **Two new, real, previously-hidden problems surfaced** (only visible now that verification isn't uniformly failing):
   - **David: `AMBIGUOUS_IDENTITY_AUTHORITY` / `PROVENANCE_CONFLICT`** — David has verified candidates in *two* parallel registries (Automation Control's own `asset_registry` tab and the Prompt Generator's `asset_index`), and the resolver correctly refuses to auto-pick one. This is the audit's "duplicate source of truth" finding manifesting concretely.
   - **Juan: resolves, but to the wrong file** — `JUAN_SOLO_CORE_TEST_02.png`, one of the 13 rows Agent C flagged `ACTIVE_BROKEN` (404 in Drive), not the 4 files fixed in step 2. The resolver checks governance status, never physical file existence, so a broken-but-"approved" duplicate outranks the real fixed one.
   - **Location (`@loc_bog_salatv`) resolves to a David face photo**, not the SalaTV room lock file — a separate, unfixed bug in scene-anchor matching.
7. **Not fixed in this round** (real new scope, not covered by the user's "close Juan + reconcile connector, no more images" instruction — flagged for a decision, not fixed unilaterally): deduplicating/deprecating the conflicting David registry rows, marking Juan's broken `ACTIVE_BROKEN` duplicates as superseded so they stop outranking the real fixed files, and the location-anchor matching bug.

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
