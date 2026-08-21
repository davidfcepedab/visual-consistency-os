import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createLibraryMutationHandlers,
  planSafeLibraryMutations,
} from "../src/library-mutation-tools.js";
import type { LibraryMaintenanceSnapshot } from "../src/library-maintenance-tools.js";

const snapshot: LibraryMaintenanceSnapshot = {
  revision: "library-mutation-rev-1",
  files: [
    {
      file_id: "FILE-CANDIDATE-001",
      name: "candidate.jpg",
      mime_type: "image/jpeg",
      path: "05. Image Library | Organizada/04. Locations/candidate.jpg",
      scope: "LIBRARY",
    },
    {
      file_id: "FILE-DECIDED-001",
      name: "decided.jpg",
      mime_type: "image/jpeg",
      path: "05. Image Library | Organizada/03. Review/decided.jpg",
      scope: "LIBRARY",
    },
  ],
  captures: [
    {
      capture_id: "CAP-DECIDED-001",
      file_id: "FILE-DECIDED-001",
      status: "APPROVED",
    },
  ],
  result_memory: [],
  asset_registry: [
    {
      asset_id: "ASSET-DECIDED-001",
      source_file_id: "FILE-DECIDED-001",
      approval_notes: "Original human record",
    },
  ],
  asset_index: [],
  reference_checks: [],
};

function backendSnapshot() {
  return {
    ok: true,
    scan_id: "scan-mutation",
    revision: snapshot.revision,
    files: snapshot.files,
    complete: true,
    truncated: false,
    coverage: "COMPLETE",
    pages_scanned: 1,
    folders_scanned: 3,
    files_scanned: snapshot.files.length,
    captures: snapshot.captures,
    result_memory: snapshot.result_memory,
    asset_registry: snapshot.asset_registry,
    asset_index: snapshot.asset_index,
    reference_checks: snapshot.reference_checks,
  };
}

const controls = {
  dry_run: true,
  idempotency_key: "idem-library-001",
  expected_revision: snapshot.revision,
  reason: "Synthetic contract test",
  updated_by: "contract-test",
  source_evidence: [
    {
      source_type: "DRIVE_FILE_ID",
      source_id: "FILE-CANDIDATE-001",
      verification_status: "VERIFIED_SOURCE" as const,
    },
  ],
  overwrite: false,
  trace_id: "trace-library-mutation",
};

test("candidate registration is deterministic and never sets identity or human authority", () => {
  const result = planSafeLibraryMutations(snapshot, [
    { type: "REGISTER_CANDIDATE", file_id: "FILE-CANDIDATE-001" },
  ]);
  assert.equal(result.rejections.length, 0);
  assert.equal(result.plan.length, 1);
  const mutation = result.plan[0];
  assert.equal(mutation.operation, "APPEND_ROW");
  assert.equal(mutation.fields.asset_id, "LIB-FILE-CANDIDATE-001");
  assert.equal(mutation.fields.status, "CANDIDATE");
  assert.equal(mutation.fields.scope, "NEEDS_REVIEW");
  const serialized = JSON.stringify(mutation.fields).toLowerCase();
  for (const forbidden of ["identity", "face", "tattoo", "ring", "approved_by", "human_status"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("consolidation appends provenance only and preserves the human decision", () => {
  const result = planSafeLibraryMutations(snapshot, [
    {
      type: "CONSOLIDATE_DECIDED_FILE",
      file_id: "FILE-DECIDED-001",
      capture_id: "CAP-DECIDED-001",
    },
  ]);
  assert.equal(result.rejections.length, 0);
  assert.equal(result.plan[0].operation, "APPEND_PROVENANCE");
  assert.deepEqual(result.plan[0].fields, {});
  assert.match(result.plan[0].evidence.join(" "), /human_decision=APPROVE/);
});

test("dry run performs zero writes and a real request passes the common controls", async () => {
  let writeCount = 0;
  let writtenPayload: Record<string, unknown> | undefined;
  const handlers = createLibraryMutationHandlers({
    read: async () => backendSnapshot(),
    write: async (payload) => {
      if (payload.replay_only === true) {
        return { ok: false, error: { code: "NOT_FOUND" } };
      }
      writeCount += 1;
      writtenPayload = payload;
      return {
        ok: true,
        write_count: 1,
        revision: "library-mutation-rev-2",
        results: [{ applied: true }],
      };
    },
  });

  const dryRun = await handlers.applyLibraryReconciliation({
    ...controls,
    actions: [{ type: "REGISTER_CANDIDATE", file_id: "FILE-CANDIDATE-001" }],
  });
  assert.equal(dryRun.ok, true);
  assert.equal(writeCount, 0);
  if (dryRun.ok) assert.equal(dryRun.write_count, 0);

  const applied = await handlers.applyLibraryReconciliation({
    ...controls,
    dry_run: false,
    actions: [{ type: "REGISTER_CANDIDATE", file_id: "FILE-CANDIDATE-001" }],
  });
  assert.equal(applied.ok, true);
  assert.equal(writeCount, 1);
  assert.equal(writtenPayload?.idempotency_key, controls.idempotency_key);
  assert.equal(writtenPayload?.expected_revision, snapshot.revision);
  assert.deepEqual(writtenPayload?.actions, [
    { type: "REGISTER_CANDIDATE", file_id: "FILE-CANDIDATE-001" },
  ]);
  assert.deepEqual(writtenPayload?.source_evidence, controls.source_evidence);
});

test("revision conflict blocks the backend write", async () => {
  let writes = 0;
  const handlers = createLibraryMutationHandlers({
    read: async () => backendSnapshot(),
    write: async () => {
      return { ok: false, error: { code: "NOT_FOUND" } };
    },
  });
  const result = await handlers.applyLibraryReconciliation({
    ...controls,
    expected_revision: "stale-revision",
    actions: [{ type: "REGISTER_CANDIDATE", file_id: "FILE-CANDIDATE-001" }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "CONFLICT");
  assert.equal(writes, 0);
});

test("idempotent replay returns before a fresh scan or write", async () => {
  let reads = 0;
  let applyWrites = 0;
  const handlers = createLibraryMutationHandlers({
    read: async () => {
      reads += 1;
      return backendSnapshot();
    },
    write: async (payload) => {
      if (payload.replay_only === true) {
        return {
          ok: true,
          idempotent_replay: true,
          write_count: 1,
          revision: "library-mutation-rev-2",
        };
      }
      applyWrites += 1;
      return { ok: true };
    },
  });
  const result = await handlers.applyLibraryReconciliation({
    ...controls,
    dry_run: false,
    actions: [{ type: "REGISTER_CANDIDATE", file_id: "FILE-CANDIDATE-001" }],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.idempotent_replay, true);
  assert.equal(reads, 0);
  assert.equal(applyWrites, 0);
});

test("duplicate actions are rejected before any backend read or write", async () => {
  let reads = 0;
  let writes = 0;
  const handlers = createLibraryMutationHandlers({
    read: async () => {
      reads += 1;
      return backendSnapshot();
    },
    write: async () => {
      writes += 1;
      return { ok: true };
    },
  });
  const duplicate = { type: "REGISTER_CANDIDATE", file_id: "FILE-CANDIDATE-001" } as const;
  const result = await handlers.applyLibraryReconciliation({
    ...controls,
    actions: [duplicate, duplicate],
  });
  assert.equal(result.ok, false);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test("server-side reconciliation contains no Drive mutation or physical deletion", () => {
  const source = readFileSync(
    "apps-script-production-candidate/15.LibraryReconciliation.js",
    "utf8"
  );
  for (const forbidden of [
    "moveTo(",
    "createFolder(",
    "setTrashed(",
    "deleteRow(",
    "removeFile(",
    "addFile(",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
