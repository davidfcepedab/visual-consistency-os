import assert from "node:assert/strict";
import test from "node:test";

import {
  createLibraryMaintenanceHandlers,
  classifyBackendError,
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

test("explicit refresh observes new Drive files and invalidates an older scan cursor", async () => {
  let calls = 0;
  const handlers = createLibraryMaintenanceHandlers(async () => {
    calls += 1;
    const current = structuredClone(snapshot);
    if (calls > 1) current.files.push({
      file_id: "FILE-NEW-P0", name: "reference.png", mime_type: "image/png",
      path: "01. Reference Packs/Renamed/reference.png", scope: "LIBRARY",
    });
    // Direct Drive edits leave the Sheets revision unchanged.
    return { ...completeSnapshotResponse(current), scan_id: `scan-${calls}` };
  });
  const old = await handlers.listLibraryInventory({ limit: 1 });
  assert.equal(old.ok, true);
  if (!old.ok) return;
  await handlers.planLibraryReconciliation({ dry_run: true });
  assert.equal(calls, 1, "ordinary reads reuse the cached scan");
  const refreshed = await handlers.planLibraryReconciliation({ dry_run: true, force_refresh: true });
  assert.equal(refreshed.ok, true);
  if (!refreshed.ok) return;
  assert.equal(calls, 2);
  assert.equal(refreshed.write_count, 0);
  assert.ok(refreshed.items.some((item) => item.record_id === "FILE-NEW-P0"));
  const stale = await handlers.listLibraryInventory({ cursor: old.next_cursor });
  assert.equal(stale.ok, false, "must not mix pages from different Drive scans");
  const invalid = await handlers.listLibraryInventory({ cursor: old.next_cursor, force_refresh: true });
  assert.equal(invalid.ok, false);
  assert.equal(calls, 2, "invalid refresh must not start another scan");
});

test("failed explicit refresh does not serve the previous cached snapshot", async () => {
  let calls = 0;
  const handlers = createLibraryMaintenanceHandlers(async () => {
    if (++calls === 2) throw new Error("temporary backend failure");
    return completeSnapshotResponse(snapshot);
  });
  assert.equal((await handlers.listLibraryInventory({})).ok, true);
  assert.equal((await handlers.listLibraryInventory({ force_refresh: true })).ok, false);
  assert.equal((await handlers.listLibraryInventory({})).ok, true);
  assert.equal(calls, 3);
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

test("traceable P0 references with NOT_CLEARED are not publication conflicts", () => {
  const base = { human_anchor_approval: "APPROVED", identity_clearance: "NOT_CLEARED" };
  const findings = planLibraryReconciliation({
    ...snapshot,
    asset_registry: [
      { ...base, asset_id: "AST-P0-PRIMARY", status: "PRIORITY_0_PRIMARY", provenance_state: "APPROVAL_TRACEABLE" },
      { ...base, asset_id: "AST-P0-APPROVED", status: "PRIORITY_0_APPROVED", provenance_state: "APPROVAL_TRACEABLE" },
      { ...base, asset_id: "AST-P0-OPEN", status: "PRIORITY_0_APPROVED", provenance_state: "NEEDS_REVIEW" },
      { ...base, asset_id: "AST-SUPPORT", status: "SUPPORT", provenance_state: "APPROVAL_TRACEABLE" },
      { ...base, asset_id: "AST-LEGACY", status: "", provenance_state: "UNVERIFIED" },
    ],
  });
  const conflicts = new Set(
    findings.filter((f) => f.category === "ASSET_STATE_CONFLICT").map((f) => f.record_id)
  );
  assert.equal(conflicts.has("AST-P0-PRIMARY"), false);
  assert.equal(conflicts.has("AST-P0-APPROVED"), false);
  assert.equal(conflicts.has("AST-P0-OPEN"), true, "P0 with open provenance must still conflict");
  assert.equal(conflicts.has("AST-SUPPORT"), true, "non-P0 approved assets keep the rule");
  assert.equal(conflicts.has("AST-LEGACY"), true);
});

test("backend errors are classified for diagnosis", () => {
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";
  assert.equal(classifyBackendError(timeout), "BACKEND_TIMEOUT");
  assert.equal(classifyBackendError(new Error("LIBRARY_SCAN_REVISION_CHANGED_MID_TRAVERSAL")), "LIBRARY_SCAN_REVISION_CHANGED_MID_TRAVERSAL");
  assert.equal(classifyBackendError(new Error("Apps Script returned an invalid JSON response (500)")), "APPS_SCRIPT_INVALID_RESPONSE");
  assert.equal(classifyBackendError(new Error("boom")), "UPSTREAM_ERROR");
});

test("scan restarts once when the library changes mid-traversal", async () => {
  let calls = 0;
  const handlers = createLibraryMaintenanceHandlers(async () => {
    calls += 1;
    if (calls === 1) {
      return { ...completeSnapshotResponse(snapshot), complete: false, next_cursor: "page-2" };
    }
    if (calls === 2) {
      return { ...completeSnapshotResponse(snapshot), revision: "library-rev-2" };
    }
    return completeSnapshotResponse(snapshot);
  });
  const result = await handlers.planLibraryReconciliation({ dry_run: true, limit: 50, trace_id: "trace-restart" });
  assert.equal(result.ok, true);
  assert.equal(calls, 3, "one aborted traversal plus one clean restart");
});

test("findings are bucketed into ACTION and HISTORICAL and metadata drift is auto-applicable", () => {
  const findings = planLibraryReconciliation({
    ...snapshot,
    files: [
      ...snapshot.files,
      { file_id: "FILE-ARCHIVED", name: "old.png", mime_type: "image/png", path: "99. Archive/2026-10 Limpieza/old.png", scope: "LIBRARY" },
    ],
    asset_registry: [
      ...snapshot.asset_registry,
      { asset_id: "AST-P0", source_file_id: "FILE-REVIEW", final_filename: "renamed-elsewhere.png", status: "PRIORITY_0_APPROVED" },
      { asset_id: "AST-OLD", source_file_id: "FILE-GONE", status: "SUPERSEDED" },
    ],
    reference_checks: [
      ...snapshot.reference_checks,
      { file_id: "FILE-GONE", state: "NOT_FOUND", source: "ASSET_REGISTRY" },
    ],
  });
  const byKey = new Map(findings.map((f) => [`${f.category}|${f.record_id}`, f]));
  assert.equal(byKey.get("UNINDEXED_LIBRARY_FILE|FILE-ARCHIVED")?.bucket, "HISTORICAL");
  assert.equal(byKey.get("BROKEN_DRIVE_REFERENCE|FILE-GONE")?.bucket, "HISTORICAL");
  const drift = byKey.get("METADATA_DRIFT|AST-P0");
  assert.equal(drift?.bucket, "ACTION");
  assert.equal(drift?.auto_applicable, true);
  assert.equal(drift?.requires_human_approval, false);
});

test("reconciliation hides historical findings unless requested", async () => {
  const fixture = {
    ...snapshot,
    asset_registry: [...snapshot.asset_registry, { asset_id: "AST-OLD", source_file_id: "FILE-GONE", status: "SUPERSEDED" }],
    reference_checks: [...snapshot.reference_checks, { file_id: "FILE-GONE", state: "NOT_FOUND" as const, source: "ASSET_REGISTRY" as const }],
  };
  const handlers = createLibraryMaintenanceHandlers(async () => completeSnapshotResponse(fixture));
  const lean = await handlers.planLibraryReconciliation({ dry_run: true, limit: 200 });
  const all = await handlers.planLibraryReconciliation({ dry_run: true, limit: 200, include_historical: true });
  assert.equal(lean.ok && all.ok, true);
  if (lean.ok && all.ok) {
    assert.ok(all.total > lean.total);
    assert.equal(lean.items.some((f) => f.bucket === "HISTORICAL"), false);
    assert.equal(lean.counts.historical, all.total - lean.total);
  }
});
