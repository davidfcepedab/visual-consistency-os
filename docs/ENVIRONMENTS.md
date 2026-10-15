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
| Cloud Run revision | `visual-identity-os-mcp-00083-reb` (v1.6.1, 100% since 2026-10-15) | tag `staging` → `00083-reb` (move the tag on each new test deploy) |
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

## Release procedure

1. `gcloud run deploy visual-identity-os-mcp --source . --region us-central1 --env-vars-file <env from current revision> --session-affinity --min-instances 1 --max-instances 1 --timeout 600 --memory 1Gi --no-traffic --tag staging` (never `services update` alone: the service template may hold an old revision's env)
2. Smoke test staging: `/health`, MCP `initialize` → `tools/list` → `visual_get_system_status`.
3. Promote: `gcloud run services update-traffic visual-identity-os-mcp --region us-central1 --to-revisions <revision>=100`
4. Record the release in `DEPLOYMENT_LOG.md`.

**Rollback:** `gcloud run services update-traffic visual-identity-os-mcp --region us-central1 --to-revisions visual-identity-os-mcp-00081-won=100` (v1.6.0 + session affinity). Older: `00074-pon` (v1.6.0), `00049-tc2` (v1.5.3, Apps Script @32).

## Pending

1. **Source of truth for v1.6.0:** resolved 2026-10-14. Branch `release/v1.6.0-production` (from `origin/main`) holds the exact source deployed in revision `00074-pon`; build OK, 116/116 tests. Merge it into `main` and deploy only from `main` from now on.
2. **v1.7.0:** lives on `fix/detector-p0-clearance` (based on older code, lacks `generator-handoff.ts`); Apps Script @33 exists, never deployed to Cloud Run. Rebase onto `release/v1.6.0-production`, then stage → validate → promote.
3. **Grok:** only supports dynamic client registration. Needs an Auth0 post-login Action allowlist plus default third-party grant on the Visual API before connecting. Do not retry Grok until then (each attempt creates an Auth0 app; tenant limit is 10).
4. **Cleanup:** old Cloud Run tags removed 2026-10-14 (only production + `staging` remain; old revisions kept and can be re-tagged). Still pending: archive unused Apps Script deployments (15 listed by `clasp deployments`). Auth0 cleanup done 2026-10-14: tenant now holds only `OWN · Visual · Public PKCE`, `FIT · ChatGPT · DCR 1/2` and the system app; APIs `OWN · Visual · API`, `Braincell FIT`, Management API.
5. **Auth0 hardening:** disable Username-Password on the public client; move `VISUAL_OS_SHARED_SECRET` and `MCP_API_KEY` from plain env vars to Secret Manager and rotate them.
6. ~~`/health` version mismatch~~ fixed in 1.6.1 (still hardcoded; bump both strings on release).
8. **Location anchors for RIC Casa / Ricaurte** (9 Room Anchors) are `human_anchor_approval=PENDING`; approve the ones to use. Location choice is the first match, not semantic (terrace vs living room): pass `required_anchor_ids` for an exact room.
9. **Identity fidelity in ChatGPT:** the native image generator does not reliably condition on images returned by an MCP tool, even with `ATTACHED 2/2`. Workarounds: attach P0 images in the user message, or add server-side rendering with a reference-capable image API (pending decision).
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
