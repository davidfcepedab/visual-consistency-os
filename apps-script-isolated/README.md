# Isolated Apps Script read adapter

This directory is a fixture-only contract implementation for:

- `capture`
- `orphan_snapshot`
- `batches_catalog`

It is intentionally disconnected from `SpreadsheetApp`, Drive, external URLs,
and production data. `getVisualReadStore_()` always returns the synthetic store
from `Fixtures.gs`; `doPost` always rejects the request.

Do not deploy this directory over the existing production Apps Script project.
The three handlers and their dispatch cases must first be adapted to an
isolated copy of the real router once that source becomes available.

The web entry point requires the isolated project's
`VISUAL_OS_SHARED_SECRET` Script Property. No secret belongs in these files.
