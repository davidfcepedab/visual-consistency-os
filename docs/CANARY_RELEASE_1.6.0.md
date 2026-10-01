# Visual Identity OS MCP 1.6.2 Canary

Release date: 2026-08-21 (America/Bogota)

## Objective

Allow a normal ChatGPT chat to execute an existing Visual Identity OS request
by exact `request_id`, resolve its persisted prompt and authority, and hand the
result to ChatGPT native image generation in the same turn.

## Change

- Add read-only `visual_execute_request(request_id)`.
- Recover the persisted project, subjects, scene, prompt, mode, and lineage.
- Reuse the existing request ID; never create a duplicate request.
- Resolve Priority 0, anchors, locks, blockers, and the final prompt through the
  same generation preflight used for new prompts.
- Add MCP server instructions that require the host to invoke native image
  generation when `ready_to_generate=true` and return exactly one bitmap.
- Update the bundled `direct-visual-identity` skill with the existing-request
  route.
- Advertise the OpenAI-supported MCP skills extension and serve the complete
  `direct-visual-identity` skill resources from the deployed server, so the
  workflow applies in normal ChatGPT chats rather than relying on a local
  workspace instruction.
- Physically download up to six verified image references from their canonical
  Drive file IDs and return them as MCP image content. If a primary identity
  reference cannot be attached, change the packet to `ready_to_generate=false`
  and block URL-only generation.
- Default all chat generation to `credit_mode=ECONOMY`: one MCP call,
  only the minimum primary identity anchors, compact tool output,
  one native generation, and no automatic retry. `QUALITY` is explicit opt-in.
- Treat IDs mentioned only as historical/contextual text, a redundant Priority
  0 request, and unavailable optional scene anchors as warnings. Keep hard
  blocks for missing verified identity, explicit required references, unsafe
  authority conflicts, and missing edit lineage.

## Non-goals

- The MCP does not render images itself.
- `visual_create_request` remains bookkeeping only.
- No asset is approved, promoted, moved, or published automatically.

## Canary gate

1. Deploy without promoting production traffic.
2. Re-scan or refresh the ChatGPT plugin so it discovers 18 tools and the
   updated server instructions/skill.
3. In a new normal ChatGPT chat, call `visual_execute_request` with a known
   request ID.
4. Confirm the result preserves the same request ID and persisted scene.
5. Confirm `reference_delivery.status=ATTACHED` and that MCP image content is
   present for every primary identity anchor.
6. When `ready_to_generate=true`, confirm ChatGPT invokes native image
   generation in the same turn and displays exactly one bitmap.

## Deployed canary

- Cloud Run revision: `visual-identity-os-mcp-00053-kuw`
- Tag: `balanced-generation-v162`
- Traffic: `0%` (production remains on `visual-identity-os-mcp-00050-naj`)
- MCP endpoint:
  `https://balanced-generation-v162---visual-identity-os-mcp-4cf7h52zxa-uc.a.run.app/mcp`

## Verified

- Test suite: `103/103` passing.
- TypeScript build: passing.
- Live server version: `1.6.2`.
- Live MCP discovery: 18 tools, including `visual_execute_request`.
- Live skills discovery: `direct-visual-identity` plus three SHA-256-bound
  resources.
- Exact-request smoke test: `REQ-20260821-180702-4FFB2C` returned the same
  request ID with `ready_to_generate=true`, one attached primary identity reference in
  `ECONOMY` mode, `generation_limit=1`, `automatic_retry=false`,
  `reference_delivery.status=ATTACHED`, and no blockers.
- The exact-request MCP response was `589,818` bytes, down from the roughly
  4–6 MB generation responses observed on the prior canary path.
- Compatibility comparison: production exposes 17 tools and canary exposes 18;
  no production tool is missing and no existing input schema changed. The only
  added tool is `visual_execute_request`.
- Production isolation: revision `visual-identity-os-mcp-00050-naj` remains at
  100% traffic. The canary remains at 0%.

## Pending host acceptance

Install or refresh the canary MCP in ChatGPT, then run the final normal-chat
acceptance test. Completion requires a visible single bitmap produced by the
native image generator in the same turn; a successful MCP response alone is
not sufficient evidence.
