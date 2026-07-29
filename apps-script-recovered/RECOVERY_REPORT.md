# Apps Script router recovery report

Date: 2026-07-28

## Outcome

The exact Apps Script project and immutable version used by the MCP baseline
were recovered successfully.

- Project: `VISUAL OS | Automatic Workflow`
- Script ID fingerprint:
  `3eccee8b2c1380151b0ddead366584d9ecf43549277a9fa984862f7e98bb2e95`
- Deployment fingerprint:
  `ae92cd5222fb26edc67c00e871a6075324a9ca75174fcfaec03a0296dfb31243`
- Deployed version: `10`
- Version description: `VISUAL OS v4.3.0 — simplified routing`
- Recovered files: 9
- Recovered source lines: 2,797

The deployment listed for version 10 matches the Apps Script URL embedded in
the source package that produced the recovered Cloud Run revision.

## Candidate resolution

Two projects with the same visible title were provided:

- The first has one `@HEAD` deployment and does not match the MCP deployment.
- The second has four deployments and twelve immutable versions. Its version
  10 deployment is the exact MCP match.

An older standalone project titled `VISUAL OS` was previously rejected because
it contains only a Drive renaming utility and returns HTML 404 instead of the
router JSON contract.

## Version 10 versus current HEAD

Current Apps Script `HEAD` is not identical to deployed version 10:

- `05. WebApp` differs.
- `09.SchemaDiagnostics` exists only in `HEAD`.

Those post-v10 changes were not merged automatically. The integration baseline
is the immutable deployed version 10.

## Local safety

The source was cloned to `router-source/`. Its `.clasp.json` was renamed to
`clasp-project-metadata.json`, preventing accidental `clasp push`, version, or
deployment commands from targeting the remote project from this directory.

Baseline hashes are preserved in
`router-source/BASELINE_V10_SHA256SUMS.txt`.

## Local integration

The isolated copy adds only:

- `capture`
- `orphan_snapshot`
- `batches_catalog`

The implementation:

- performs exact capture lookup;
- returns structured `NOT_FOUND`, validation, conflict, and safe backend errors;
- reads all required sheets without writing;
- normalizes `source_capture_id` for orphan analysis;
- includes pending and terminal batches;
- derives batch project only when all linked captures contain the same non-empty
  source value;
- marks derived project and subjects as `CANDIDATE`, never as verified;
- preserves explicit empty project values;
- detects duplicate batch identifiers;
- emits stable SHA-256 dataset revisions.

## Verified safety

- No Apps Script project was changed, versioned, or deployed.
- No Script Property was read or modified.
- No production Sheet data was queried.
- No scoring, session, request, review, or image decision was executed.
- The test fixture rejects write attempts.
- The safe-read source contains no mutating, Drive, scoring, or external-fetch
  API calls.
