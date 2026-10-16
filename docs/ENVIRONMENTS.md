# OWN · Visual Consistency OS — Environments standard

Last updated: 2026-10-14. Display name: **OWN · Visual Consistency OS** (technical id `visual-identity-os-mcp` is unchanged).

## Naming convention (all OWN domains)

| Layer | Pattern | Visual | Fit (next round) |
|---|---|---|---|
| Connector (Claude, ChatGPT, Gemini, Grok) | `OWN · <Function> OS` | OWN · Visual Consistency OS | OWN · Fit Integration OS |
| Test connector | `OWN · <Function> OS · Staging` | OWN · Visual Consistency OS · Staging | OWN · Fit Integration OS · Staging |
| Auth0 API (display name) | `OWN · <Domain> · API` | OWN · Visual · API | OWN · Fit · API |
| Auth0 public client | `OWN · <Domain> · Public PKCE` | OWN · Visual · Public PKCE | OWN · Fit · Public PKCE |
| Slug | `own-<domain>` | own-visual | own-fit |

## Environments

| | Production | Staging |
|---|---|---|
| MCP URL | `https://visual-identity-os-mcp-4cf7h52zxa-uc.a.run.app/mcp` | `https://staging---visual-identity-os-mcp-4cf7h52zxa-uc.a.run.app/mcp` |
| Cloud Run revision | `visual-identity-os-mcp-00099-fuw` (v1.6.8, 100% since 2026-10-16) | tag `staging` → `00099-fuw` (move the tag on each new test deploy) |
| Scaling | session affinity, min 1 / max 1 instance, timeout 600 s | same |
| Apps Script (script `1Fgf6jzz…`) | deployment `AKfycbwo8sv69…` @34 | same until a new version is staged |
| Auth0 tenant | `dev-s882ypj8vfzv2rob` (US) | same |
| Audience / resource | `https://visual-identity-os-mcp` | same |
| OAuth client (all platforms) | `aBiMBc5y8enwLAGwWDDJ3mMNSJ4cMlIt` (Native, PKCE, no secret) | same |

### Connector settings (identical on every platform)

- URL: production or staging URL above
- OAuth Client ID: `aBiMBc5y8enwLAGwWDDJ3mMNSJ4cMlIt`, client secret empty
- If endpoints are requested manually: authorize `https://visual-identity-os-mcp-322507617141.us-central1.run.app/authorize` (server proxy that injects `audience`), token `https://dev-s882ypj8vfzv2rob.us.auth0.com/oauth/token`, scopes `openid profile email offline_access`
- Registered callbacks: `https://claude.ai/api/mcp/auth_callback`, `https://chatgpt.com/connector/oauth/yBTE7Q0YFqDz`, `https://chatgpt.com/connector/oauth/3G7NPUIUwuua`, `https://grok.com/connectors-oauth-exchange-code/`

## 1.6.1 fixes (2026-10-15)

- Expired/unknown MCP sessions are served statelessly instead of `400 Missing or invalid MCP session` (ChatGPT showed it as `(r.content ?? []).map is not a function`).
- Locations resolve through `alias` notes ("RIC Casa" ↔ "CasaRicaurte" ↔ "Ricaurte").
- One matched Room Anchor is attached even in ECONOMY.

## 1.6.2 (2026-10-15)

- `credit_mode` defaults to **QUALITY**: up to 6 references / 15 MB, extra face angles shared round-robin across subjects, plus one location. Pass `credit_mode: ECONOMY` for a lighter response. Validated on REQ-20261014-183009-7B6960: 6 refs (David 3, Juan 2, RIC Casa 1), 9.2 MB.
- RIC Casa / Piscina location anchors (9) human-approved 2026-10-15 by David Cepeda in ASSET_REGISTRY.
- Juan keeps `P0-01 Primary cuerpo sentado` by owner decision; QUALITY adds his face refs.

## 1.6.8 (2026-10-16)

- `OAUTH_ALLOWED_SUBJECTS` (comma-separated Auth0 user ids) restricts OAuth tokens to the owner: `google-oauth2|117418455041632079055`. Other subjects get 401 `subject_not_allowed`; the API key path is unchanged. Set with `--update-env-vars`; it lives in the service template, so later deploys keep it.
- Purpose: Grok only connects through dynamic client registration (it ignored the manual Client ID and created `tpc_…` apps). With the allowlist, Grok's registered app can be granted access to the Visual API without opening the MCP to every tenant account.
- Validated in production: Claude connector (OAuth) → 200 on `00099-fuw`. Promotion with min/max 1 instance caused ~40 s of 503 while the instance swapped.

## 1.6.7 (2026-10-15)

- Owner decision: `mode: EDIT` without `base_capture_id` / `parent_request_id` / `source_result_id` (an image attached in the host chat) is normalized to GENERATE with `MODE_NORMALIZED` and `auto_resolutions: MODE_EDIT_TO_GENERATE` instead of blocking with `MISSING_EDIT_BASE`. The host passes its attachment as composition input; identity comes only from P0 references. These results are not linked to a registered base.
- An unknown base ID still blocks (`INVALID_BASE_CAPTURE`). Both cases validated in production.

## 1.6.6 (2026-10-15)

- Reference bitmaps are re-encoded with `sharp` to JPEG, max 1536 px long edge, quality 88 (original bytes if re-encoding fails). Root cause of the Work-mode failures: ChatGPT abandoned tool results above ~8 MiB (8.67 MB = three 2 MB PNGs) with `MCP request timed out`; every working response on 2026-10-12/13 (v1.6.0, `00074-pon`) was <= 7.4 MB.
- Validated in production: David + Juan → 2 references, 418 KB total (was ~4 MB); David + Juan + Mambo on staging → 1.1 MB response (was ~8.7 MB).

## 1.6.5 (2026-10-15)

- `credit_mode` defaults to **ECONOMY** for every request; QUALITY only when asked explicitly. A David + Juan QUALITY packet (8.3 MB, 35 s) made ChatGPT Work mode abort with `MCP request timed out`; ECONOMY (5.3 MB, ~30 s, 2 Primaries ATTACHED) held both identities. Validated in production.
- `Couple` must not be passed in `subjects` (no facial authority → `MISSING_IDENTITY_ANCHOR`); pass `["David", "Juan"]` and describe the interaction in `scene`.
- Promoting a revision closes open MCP sessions once (ChatGPT shows `Transport closed`); retry the turn.

## 1.6.4 (2026-10-15)

- `ambiguous_identity` is true only when distinct verified identities exist and no canonical Primary resolves deterministically. Several approved P0 angles no longer flag it (ChatGPT read the old flag as an authority conflict and refused to generate). Competing unresolved Primaries still block. Validated in production: David, Juan, Mambo → `ambiguous_identity=false`, same Primary and references.
- `identity_clearance=NOT_CLEARED` on P0 references is left as is: it is the publish gate for generated results, not a reference gate.

## 1.6.3 (2026-10-15)

- Without `credit_mode`, the delivery mode is chosen per request: 1 subject → ECONOMY, 2+ subjects → QUALITY. An explicit `credit_mode` always wins.
- Why: a single-subject QUALITY packet was 17.7 MB / 70 s (risk of host timeouts and context bloat). Validated in production: David alone → ECONOMY, 1 ref, 2.0 MB, ATTACHED.
- Claude Code no longer uses the legacy `visual-identity-os-mcp-claude` service (v1.5.0, no bitmap delivery); its local `~/.claude.json` entry was removed (backup `~/.claude.json.bak-20261015-visual`). Decommissioning that Cloud Run service is pending owner approval.

## Release procedure

1. `gcloud run deploy visual-identity-os-mcp --source . --region us-central1 --env-vars-file <env from current revision> --session-affinity --min-instances 1 --max-instances 1 --timeout 600 --memory 1Gi --no-traffic --tag staging` (never `services update` alone: the service template may hold an old revision's env)
2. Smoke test staging: `/health`, MCP `initialize` → `tools/list` → `visual_get_system_status`.
3. Promote: `gcloud run services update-traffic visual-identity-os-mcp --region us-central1 --to-revisions <revision>=100`
4. Record the release in `DEPLOYMENT_LOG.md`.

**Rollback:** `gcloud run services update-traffic visual-identity-os-mcp --region us-central1 --to-revisions visual-identity-os-mcp-00097-rik=100` (v1.6.7, no allowlist). Then `00095-bax` (v1.6.6), `00093-vuf` (v1.6.5). Then `00081-won` (v1.6.0 + session affinity). Older: `00074-pon` (v1.6.0), `00049-tc2` (v1.5.3, Apps Script @32).

## Pending

1. **Source of truth for v1.6.0:** resolved 2026-10-14. Branch `release/v1.6.0-production` (from `origin/main`) holds the exact source deployed in revision `00074-pon`; build OK, 116/116 tests. Merge it into `main` and deploy only from `main` from now on.
2. **v1.7.0:** lives on `fix/detector-p0-clearance` (based on older code, lacks `generator-handoff.ts`); Apps Script @33 exists, never deployed to Cloud Run. Rebase onto `release/v1.6.0-production`, then stage → validate → promote.
3. **Grok:** only supports dynamic client registration. Needs an Auth0 post-login Action allowlist plus default third-party grant on the Visual API before connecting. Do not retry Grok until then (each attempt creates an Auth0 app; tenant limit is 10).
4. **Cleanup:** old Cloud Run tags removed 2026-10-14 (only production + `staging` remain; old revisions kept and can be re-tagged). Still pending: archive unused Apps Script deployments (15 listed by `clasp deployments`). Auth0 cleanup done 2026-10-14: tenant now holds only `OWN · Visual · Public PKCE`, `FIT · ChatGPT · DCR 1/2` and the system app; APIs `OWN · Visual · API`, `Braincell FIT`, Management API.
5. **Auth0 hardening:** disable Username-Password on the public client; move `VISUAL_OS_SHARED_SECRET` and `MCP_API_KEY` from plain env vars to Secret Manager and rotate them.
6. ~~`/health` version mismatch~~ fixed in 1.6.1 (still hardcoded; bump both strings on release).
8. Location choice is the first match, not semantic (terrace vs living room): pass `required_anchor_ids` for an exact room.
9. **Identity fidelity in ChatGPT (root cause found 2026-10-15):** generate in ChatGPT **Work** mode (calls arrive as `openai-mcp/1.0.0 (Codex)`, run for minutes and pass the attached P0 bitmaps to the image generator; verified on v1.6.3 with David + Juan). **Chat** mode (`openai-mcp/1.0.0`, ~8 s) does not feed MCP images to its generator and loses identity. Previous note: the native image generator does not reliably condition on images returned by an MCP tool, even with `ATTACHED 2/2`. Workarounds: attach P0 images in the user message, or add server-side rendering with a reference-capable image API (pending decision).
7. **Fit domain:** apply the same standard (next round).

## Connected platforms (verified 2026-10-14 via Cloud Run logs)

| Platform | Connector | Status |
|---|---|---|
| ChatGPT | OWN · Visual Consistency OS → production | ✔ |
| Claude | OWN · Visual Consistency OS → production | ✔ |
| Codex | production URL | ✔ |
| Grok | — | blocked until allowlist (pending #3) |
| Gemini | — | not configured |

## Data backlog (pre-existing, found by read-only audit 2026-10-14)

1. 8 broken references pointing to non-existent batches — high.
2. `ambiguous_identity=true` / `identity_clearance=NOT_CLEARED` for David and Juan (duplicate identity registries, see `DEPLOYMENT_LOG.md`) — high.
3. 4 batches with Gemini 401 errors (Aug–Sep, disabled service account) — medium.
4. 604 unknown-traceability findings (219 request/session, 185 assets, 200 result memories) — low.
5. 60 pending batches (54 ready for human review, 2 evaluating, 4 error) — operational.
