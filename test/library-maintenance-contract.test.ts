import assert from "node:assert/strict";
import test from "node:test";

import {
  createLibraryMaintenanceHandlers,
  planLibraryReconciliation,
  readFullLibrarySnapshot,
  type LibraryMaintenanceSnapshot,
} from "../src/library-maintenance-tools.js";

const snapshot: LibraryMaintenanceSnapshot = {
  revision: "library-rev-1",
  files: [
    { file_id: "FILE-INBOX", name: "new-david-reference.jpg", mime_type: "image/jpeg", path: "00. Inbox/new-david-reference.jpg", scope: "INBOX" },
    { file_id: "FILE-REVIEW", name: "candidate.png", mime_type: "image/png", path: "05. Image Library | Organizada/03. Review/candidate.png", scope: "LIBRARY" },
    { file_id: "FILE-DUP-A", name: "duplicate-name.png", mime_type: "image/png", path: "05. Image Library | Organizada/03. Review/duplicate-name.png", scope: "LIBRARY" },
    { file_id: "FILE-DUP-B", name: "duplicate-name.png", mime_type: "image/png", path: "05. Image Library | Organizada/02. Ready/duplicate-name.png", scope: "LIBRARY" },
  ],
  captures: [
    { capture_id: "CAP-INCOMPLETE", file_id: "FILE-REVIEW", project: "", identity_subjects: "", scene: "", prompt_context: "", request_id: "", session_id: "" },
  ],
  result_memory: [],
  asset_registry: [
    { asset_id: "AST-CONFLICT", source_file_id: "FILE-REVIEW", human_anchor_approval: "APPROVED", identity_clearance: "NOT_CLEARED", provenance_state: "NEEDS_REVIEW" },
  ],
  asset_index: [
    { Asset: "missing.png", Status: "ACTIVE", "Drive Link": "https://drive.google.com/file/d/FILE-MISSING/view" },
  ],
  reference_checks: [
    { file_id: "FILE-MISSING", state: "NOT_FOUND", source: "ASSET_INDEX" },
  ],
};

function completeSnapshotResponse(value: LibraryMaintenanceSnapshot) {
  return {
    ok: true,
    scan_id: "scan-fixture",
    revision: value.revision,
    files: value.files,
    complete: true,
    truncated: false,
    coverage: "COMPLETE",
    pages_scanned: 1,
    folders_scanned: 3,
    files_scanned: value.files.length,
    captures: value.captures,
    result_memory: value.result_memory,
    asset_registry: value.asset_registry,
    asset_index: value.asset_index,
    reference_checks: value.reference_checks,
  };
}

test("library reconciliation covers actionable categories without writing", () => {
  const findings = planLibraryReconciliation(snapshot);
  const categories = new Set<string>(findings.map((finding) => finding.category));

  for (const category of [
    "UNREGISTERED_INBOX_FILE",
    "UNINDEXED_LIBRARY_FILE",
    "BROKEN_DRIVE_REFERENCE",
    "INCOMPLETE_CAPTURE_METADATA",
    "ASSET_STATE_CONFLICT",
    "DUPLICATE_NAME_CANDIDATE",
  ]) {
    assert.ok(categories.has(category), `${category} must be reported`);
  }
  assert.equal(findings.every((finding) => finding.requires_human_approval), true);
  assert.equal(
    findings.some((finding) =>
      finding.verification_status === "VERIFIED_SOURCE" &&
      finding.suggested_category === "IDENTITY_MASTER"
    ),
    false
  );
});

test("unavailable Drive references remain UNKNOWN instead of broken", () => {
  const findings = planLibraryReconciliation({
    ...snapshot,
    reference_checks: [{ file_id: "FILE-MISSING", state: "UNAVAILABLE", source: "ASSET_INDEX" }],
  });
  const reference = findings.find((finding) => finding.record_id === "FILE-MISSING");
  assert.equal(reference?.category, "UNAVAILABLE_DRIVE_REFERENCE");
  assert.equal(reference?.verification_status, "UNKNOWN");
});

test("library inventory filters scope and paginates without duplicates", async () => {
  let backendCalls = 0;
  const handlers = createLibraryMaintenanceHandlers(async () => {
    backendCalls += 1;
    return completeSnapshotResponse(snapshot);
  });
  const ids: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await handlers.listLibraryInventory({ scope: "LIBRARY", limit: 2, cursor, trace_id: "trace-library-inventory" });
    assert.equal(page.ok, true);
    if (!page.ok) break;
    ids.push(...page.items.map((item) => item.file_id));
    cursor = page.next_cursor;
  } while (cursor);

  assert.deepEqual(ids, ["FILE-DUP-A", "FILE-DUP-B", "FILE-REVIEW"]);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(backendCalls, 1, "pagination should reuse one complete snapshot");
});

test("reconciliation tool only accepts dry_run true", async () => {
  let backendCalls = 0;
  const handlers = createLibraryMaintenanceHandlers(async () => {
    backendCalls += 1;
    return completeSnapshotResponse(snapshot);
  });
  const rejected = await handlers.planLibraryReconciliation({ dry_run: false, limit: 50, trace_id: "trace-rejected-write" });
  assert.equal(rejected.ok, false);
  assert.equal(backendCalls, 0);

  const accepted = await handlers.planLibraryReconciliation({ dry_run: true, limit: 50, trace_id: "trace-dry-run" });
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.equal(accepted.dry_run, true);
    assert.equal(accepted.write_count, 0);
    assert.ok(accepted.items.length > 0);
  }
});

test("full traversal has neither duplicates nor omissions across backend pages", async () => {
  const calls: Record<string, string>[] = [];
  const result = await readFullLibrarySnapshot(async (_action, params) => {
    calls.push(params);
    if (!params.cursor) {
      return {
        ok: true,
        scan_id: "scan-multipage",
        revision: snapshot.revision,
        files: snapshot.files.slice(0, 2),
        complete: false,
        next_cursor: "page-2",
        folders_scanned: 1,
        files_scanned: 2,
      };
    }
    return {
      ...completeSnapshotResponse(snapshot),
      scan_id: "scan-multipage",
      files: [snapshot.files[1], ...snapshot.files.slice(2)],
      pages_scanned: 2,
    };
  }, "trace-multipage");

  assert.deepEqual(
    result.files.map((file) => file.file_id),
    ["FILE-DUP-A", "FILE-DUP-B", "FILE-INBOX", "FILE-REVIEW"]
  );
  assert.equal(new Set(result.files.map((file) => file.file_id)).size, 4);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cursor, "page-2");
  assert.equal(result.scan?.coverage, "COMPLETE");
});

test("library protocol errors are safe and do not leak backend data", async () => {
  const handlers = createLibraryMaintenanceHandlers(async () => {
    throw new Error("token=secret prompt=private");
  });
  const result = await handlers.planLibraryReconciliation({ dry_run: true, limit: 50 });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("private"), false);
});
