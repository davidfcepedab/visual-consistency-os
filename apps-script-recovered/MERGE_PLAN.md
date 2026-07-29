# Isolated merge plan

This plan must be applied only after the real router source is recovered into
an isolated copy.

## Phase 1: preserve the router

1. Hash every recovered Apps Script source file.
2. Record available versions and deployments.
3. Create a fixture-only copy without Script Properties or spreadsheet IDs.
4. Add regression tests for every existing GET and POST action.

## Phase 2: add the safe reads

Port the tested handlers from `apps-script-isolated/Code.gs` into the existing
router without replacing its current dispatch logic:

- `capture`
- `orphan_snapshot`
- `batches_catalog`

Replace `getSyntheticVisualStore_()` with read-only adapters for the real sheet
schemas. The adapters must:

- resolve columns by exact header rather than position;
- return normalized records without writing or repairing rows;
- distinguish missing values from broken references;
- include pending and terminal batches;
- preserve empty project values;
- compute a revision from stable source metadata;
- reject duplicate exact identifiers as a protocol conflict.

## Phase 3: contract tests

Add isolated cases for:

- exact capture and `NOT_FOUND`;
- invalid and duplicate capture IDs;
- every orphan category;
- absent sheets and required columns;
- unknown metadata versus broken references;
- pending and terminal batches;
- empty project;
- stable revision and pagination;
- missing or invalid shared secret;
- safe internal errors;
- regression of all existing actions;
- proof that GET actions do not call mutating Apps Script APIs.

## Phase 4: review gate

Before any deployment, deliver:

- source hashes before and after;
- complete diff;
- fixture test results;
- an isolated deployment URL, if separately authorized;
- rollback version and deployment instructions;
- confirmation that no production spreadsheet or Script Property was changed.

The metadata mutation tools remain outside this merge.
