# RUNTIME_PARITY_REPORT — AGENT A (executed directly by Orchestrator, not delegated)

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

## P0 action taken

Commit the working tree (this session's status-contract fix included),
build, and redeploy via `gcloud run deploy --source` from the fixed working
tree — see `DEPLOYMENT_LOG.md` for the executed steps and resulting revision.
