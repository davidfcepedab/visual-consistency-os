# RUNTIME_PARITY_REPORT — AGENT A (executed directly by Orchestrator, not delegated)

> **CORRECTION (same session, before any deploy action was taken):** the
> initial version of this report below concluded `visual_prepare_generation`
> was absent from production, based on `git log`/`git show HEAD` — i.e. only
> committed state. That inference was **wrong** for this deployment method.
> `gcloud run deploy --source` tars up the working directory as it exists at
> deploy time, independent of git. Downloading and inspecting the *actual*
> Cloud Build source archive for the live revision
> (`gs://run-sources-.../1787183317.929859-b9be9c4c77864f52a45aac7d31c3a44c.zip`,
> the input to Cloud Build `c52341e3`, which produced revision
> `visual-identity-os-mcp-00015-kif`, tag `native-handoff`, **100% traffic**,
> deployed 2026-08-19T23:49 UTC) shows its `src/index.ts` **does** register
> `visual_prepare_generation` (confirmed by direct string match at the same
> line number as the current working tree). **Corrected conclusion:
> `visual_prepare_generation` was already live in production, deployed
> hours before this session started — most likely by the same prior
> "native-handoff 1.4.0" work referenced in the original audit.** Sections
> 3/4/7/8 below are superseded by this correction; kept for the record of
> how the false negative happened (relying on git alone is not sufficient
> evidence for `--source` deployments).

Determined by direct inspection (`git log/status/diff`, `gcloud run services
describe/revisions list`, `gcloud builds list`, `curl /health`) rather than a
subagent — the answer was reachable in a handful of fast, sequential
commands and delegating it would only have added latency.

## 1. Commit/source corresponding to the active deployment

**Not a clean commit-to-deploy mapping** — Cloud Run revision
`visual-identity-os-mcp-00015-kif` (tag `native-handoff`, **100% traffic**,
created **2026-08-19T23:49:25Z**, i.e. hours before this session) was built
via `gcloud run deploy --source` (Cloud Build `c52341e3`, same timestamp),
which tars up the working directory at deploy time — it does **not**
require a git commit. `/health` on that revision reports
`{"version":"1.4.0"}`.

git state at time of this audit: `HEAD = 72d066d` ("feat: add safe visual
library curator"), `package.json@HEAD = 1.3.0`, working tree (uncommitted)
`package.json = 1.4.1`. Health-endpoint version `1.4.0` matches neither
exactly — most consistent explanation (INFERRED): the source deploy was run
from a working-tree state that existed *between* those two versions (after
bumping to 1.4.0, before the later 1.4.1 bump and before
`prepare-generation-tools.ts` was added).

## 2. Tools registered in source (working tree, pre-fix)

16 (`server.registerTool` calls in `src/index.ts`), including
`visual_prepare_generation`.

## 3. Tools registered at the last commit (`HEAD`)

**15** — confirmed via `git show HEAD:src/index.ts`. `visual_prepare_generation`
is **absent** at HEAD; `git show HEAD:src/index.ts | grep prepare-generation`
returns nothing. `prepare-generation-tools.ts` itself is untracked in git
entirely (`git status` lists it under "Untracked files").

## 4. Tools the deployed Cloud Run service exposes

15 — same set as HEAD (§3), by construction of §1: the live revision was
built without `prepare-generation-tools.ts` ever existing at that point.
**Root cause is not an auth/registration bug — the feature was simply never
shipped.**

## 5. Tools the installed client connector receives

Not independently re-tested in this pass (out of scope for this specific
fix — the prior audit's OAuth failure on the *client connector* is a
separate, unrelated issue per the user's explicit instruction not to
re-litigate OAuth here). Whatever the client currently caches, it cannot
show `visual_prepare_generation` today because the server it talks to
doesn't have it (§4).

## 6. Why the discrepancy exists

`prepare-generation-tools.ts`, the matching `apps-script-production-candidate/
12.GenerationContext.js` Apps Script handler, and the `WebApp.js`
`generation_context` route were all written and wired into `src/index.ts`
locally, tests were added and pass (55/55), but **none of it was committed
or included in the last source deploy**. This is ordinary WIP left
uncommitted, not a deployment-pipeline defect.

## 7. Is `visual_prepare_generation` in production?

**No.**

## 8. If not, what deployment omitted it?

Every deployment to date (`00001` through `00015-kif`) — it has never been
deployed, because it has never been committed. `00015-kif` is simply the
most recent snapshot of a working tree that predates this feature's
addition.

## Corrected root cause of any observed "client sees fewer tools"

Not a deployment gap (production already had all 16 tools including
`visual_prepare_generation` before this session touched anything). The
remaining plausible explanations, in order of likelihood, are outside what
git/Cloud Build inspection can resolve from here:

1. **Client-side tool-list caching** — MCP clients (ChatGPT/Codex connector
   apps) typically cache the tool manifest at connection time and only
   refresh on reconnect. If the client connected before 2026-08-19T23:49
   UTC, it is showing a stale (15-tool) list from before that deploy.
2. The unrelated, previously-flagged client OAuth session issue (out of
   scope here per instruction — not re-investigated).

Neither requires a code change; both require the user to reconnect/refresh
the connector, which only the user can do from their client.

## P0 action actually taken (this session)

The one genuinely new, not-yet-deployed change from this session is the
request-status contract fix (`REQUEST_CREATED` vs `READY_TO_GENERATE`,
`blockerToStatusCode`) — see the parent commit. That was committed, built,
and redeployed via `gcloud run deploy --source` — see `DEPLOYMENT_LOG.md`
for the executed steps and resulting revision.
