# Isolated merge status

## Completed locally

1. Recovered the immutable Apps Script v10 router.
2. Recorded all baseline source hashes.
3. Disabled the local `clasp` project link.
4. Preserved every existing GET and POST dispatch action.
5. Added three GET dispatch cases to `05. WebApp.js`.
6. Added read-only handlers in `09. SafeReads.js`.
7. Added synthetic sheet fixtures and router regression tests.
8. Validated the MCP client against the recovered router over local HTTP.

## Integration diff

Existing production file changed:

- `05. WebApp.js`: three GET cases route to the safe-read handler.

New production candidate file:

- `09. SafeReads.js`: exact capture, orphan snapshot, batch catalog, stable
  revision, normalization, and structured errors.

No scoring, workflow, setup, configuration, mutation, or manifest file was
changed.

## Remaining review gate

Before any remote Apps Script action:

1. Review the complete v10-to-candidate diff.
2. Decide whether post-v10 `HEAD` diagnostics must be rebased separately.
3. If authorized, create a new isolated Apps Script project or immutable
   version; never overwrite version 10.
4. Run the fixture suite against that isolated deployment.
5. Verify the three actions with copied non-production sheet data.
6. Prepare a new deployment and rollback pointer.

## Explicitly outside this merge

- `visual_update_capture_metadata`
- `visual_update_batch_metadata`
- scoring retry
- review decisions
- batch resolution
- asset promotion
- production deployment or traffic changes
