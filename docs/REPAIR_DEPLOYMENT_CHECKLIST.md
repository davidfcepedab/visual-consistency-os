# MCP repair deployment checklist

This source change is a candidate, not a production release record. It requires both Apps Script and Cloud Run deployment. GitHub commits alone do not deploy this service.

## Changes

- Exact batch lookups return NOT_FOUND, CONFLICT or INVALID_ARGUMENT without converting missing records into generic backend failures. The MCP preserves structured errors and adds a trace ID.
- Native bitmap delivery includes a manifest; the host inspection adapter rejects malformed envelopes, text-only delivery, missing Primary images and manifest mismatches.
- Body-only catalog restrictions no longer become global facial prompt restrictions.
- `visual_get_canon_summary` uses the generation authority resolver without creating requests, rendering or writing records. It returns exact source approval, clearance and provenance fields independently. Family is UNKNOWN when no explicit FAMILY_STATUS config exists.
- `visual_get_system_status(include_diagnostics=true)` returns source revision, broken/unknown lineage counts, session-only counts and canonical resolution counts. Default status stays a minimal read.
- Orphan detection treats request and session as alternative lineage routes. A session's presence is reported separately; its target is not claimed verified.
- Library reconciliation summaries group the full scan by category, severity and unique record. Identical names remain candidates, not proven duplicate content.
- `visual_get_library_scan_page` performs one backend page per host call so a client can continue a large scan across calls. Accumulate pages only with matching source revision and scan ID. PARTIAL pages are never complete audits.
- Apps Script directory traversal yields after 30 Drive list steps or 45 seconds between calls. Direct existence probes reuse a file's result across registries without losing source rows. The final direct reference-check phase still needs production timing validation.

## Deployment prerequisites

1. Obtain authenticated access to the existing Google Cloud project and Apps Script project. Do not copy credentials into this repository.
2. Capture the current live Cloud Run revision, traffic, Apps Script deployment version and actual deployed source. Repository history may lag production. Compare the candidate with live source before applying it.
3. Merge only the reviewed delta into the current Apps Script HEAD. Do not overwrite unrelated live changes. Syntax-check all script files and run the contract suite and TypeScript build.
4. Deploy Apps Script to a temporary canary deployment first. Deploy Cloud Run at zero production traffic and point the canary to the matching Apps Script candidate. Preserve authentication and existing environment variables.

## Read-only smoke checks

- MCP authentication, initialize and tools/list.
- Minimal status; diagnostic status; exact existing batch.
- Missing batch must return NOT_FOUND with a trace ID. Duplicate fixtures must return CONFLICT, not an arbitrary match.
- Canon summary must match the already approved Primary roles. Couple remains relationship geometry only; no facial authority.
- Paginate the source library route, checking revision, scan ID and exact coverage. Measure the final direct reference-check phase before enabling it for large scans.
- Inspect bitmap manifests locally using test fixtures. Do not create a second real generation request solely for deployment smoke.

## Promotion and rollback

Promote only the validated candidate after read-only smoke passes. Refresh the connector tool catalog to expose the new read tools. Record the actual versions/revisions; never substitute the historical IDs in older deployment logs. Keep the previous Cloud Run revision and Apps Script deployment version for rollback. Perform the same minimal reads after promotion.

No historical records, approval decisions, Primary assignments, folders or reference files are modified by this code repair.
