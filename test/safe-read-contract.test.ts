import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FieldVerificationStatusSchema,
  MutationControlSchema,
  assertRuntimeSecurity,
} from "../src/contracts.js";
import {
  classifyOrphans,
  createSafeReadHandlers,
  type BackendReader,
  type OrphanSnapshot,
} from "../src/safe-read-tools.js";

const completeSnapshot: OrphanSnapshot = {
  revision: "rev-1",
  captures: [
    {
      capture_id: "CAP-001",
      batch_id: "BAT-001",
      request_id: "REQ-001",
      session_id: "SES-001",
    },
  ],
  batches: [{ batch_id: "BAT-001" }],
  requests: [{ request_id: "REQ-001" }],
  reviews: [{ review_id: "REV-001", capture_id: "CAP-001" }],
  result_memory: [{ result_id: "MEM-001", capture_id: "CAP-001" }],
  assets: [{ asset_id: "AST-001", capture_id: "CAP-001" }],
};

test("visual_get_capture returns one exact capture", async () => {
  const calls: Array<{ action: string; params: Record<string, string> }> = [];
  const backend: BackendReader = async (action, params) => {
    calls.push({ action, params });
    return {
      ok: true,
      capture: { capture_id: "CAP-001", original_filename: "exact.png" },
    };
  };

  const result = await createSafeReadHandlers(backend).getCapture({
    capture_id: "CAP-001",
    trace_id: "trace-capture",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.ok ? result.capture : undefined,
    { capture_id: "CAP-001", original_filename: "exact.png" }
  );
  assert.deepEqual(calls, [
    {
      action: "capture",
      params: { id: "CAP-001", trace_id: "trace-capture" },
    },
  ]);
});

test("visual_get_capture returns NOT_FOUND without ambiguous fallback", async () => {
  let callCount = 0;
  const backend: BackendReader = async () => {
    callCount += 1;
    return { ok: true, capture: null };
  };

  const result = await createSafeReadHandlers(backend).getCapture({
    capture_id: "CAP-404",
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.error.code, "NOT_FOUND");
  assert.equal(callCount, 1);
});

test("visual_get_capture rejects invalid IDs before calling the backend", async () => {
  let called = false;
  const backend: BackendReader = async () => {
    called = true;
    return {};
  };

  const result = await createSafeReadHandlers(backend).getCapture({
    capture_id: "../ambiguous filename.png",
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.error.code, "INVALID_ARGUMENT");
  assert.equal(called, false);
});

test("orphan classification covers every required category", () => {
  const snapshot: OrphanSnapshot = {
    revision: "rev-orphans",
    captures: [
      {
        capture_id: "CAP-NO-BATCH",
        batch_id: "",
        request_id: "",
        session_id: "",
      },
      {
        capture_id: "CAP-BROKEN-REFS",
        batch_id: "BAT-404",
        request_id: "REQ-404",
        session_id: "SES-001",
      },
      {
        capture_id: "CAP-UNKNOWN-LINEAGE",
        batch_id: "BAT-001",
        request_id: "",
        session_id: "",
      },
    ],
    batches: [{ batch_id: "BAT-001" }],
    requests: [],
    reviews: [{ review_id: "REV-404", capture_id: "CAP-404" }],
    result_memory: [{ result_id: "MEM-404", capture_id: "CAP-404" }],
    assets: [{ asset_id: "AST-404", capture_id: "CAP-404" }],
  };

  const categories = new Set(
    classifyOrphans(snapshot).map((orphan) => orphan.category)
  );

  assert.deepEqual(categories, new Set([
    "CAPTURE_WITHOUT_BATCH",
    "MISSING_BATCH",
    "MISSING_REQUEST_OR_SESSION",
    "MISSING_REQUEST",
    "ORPHAN_REVIEW",
    "ORPHAN_RESULT_MEMORY",
    "ORPHAN_ASSET",
  ]));
});

test("orphan classification distinguishes UNKNOWN from broken references", () => {
  const results = classifyOrphans({
    revision: "rev-reference-state",
    captures: [
      {
        capture_id: "CAP-UNKNOWN",
        batch_id: "",
        request_id: "",
        session_id: "",
      },
      {
        capture_id: "CAP-BROKEN",
        batch_id: "BAT-404",
        request_id: "REQ-404",
        session_id: "SES-001",
      },
    ],
    batches: [],
    requests: [],
    reviews: [],
    result_memory: [],
    assets: [],
  });

  assert.equal(
    results.find((item) => item.category === "CAPTURE_WITHOUT_BATCH")
      ?.reference_state,
    "UNKNOWN"
  );
  assert.equal(
    results.find((item) => item.category === "MISSING_BATCH")
      ?.reference_state,
    "BROKEN_REFERENCE"
  );
});

test("dataset without orphans returns an empty result", () => {
  assert.deepEqual(classifyOrphans(completeSnapshot), []);
});

test("orphan pagination has no duplicates or omissions", async () => {
  const orphanSnapshot: OrphanSnapshot = {
    revision: "rev-pagination",
    captures: Array.from({ length: 7 }, (_, index) => ({
      capture_id: `CAP-${index + 1}`,
      batch_id: "",
      request_id: "",
      session_id: "",
    })),
    batches: [],
    requests: [],
    reviews: [],
    result_memory: [],
    assets: [],
  };
  const backend: BackendReader = async () => ({
    ok: true,
    snapshot: orphanSnapshot,
  });
  const handler = createSafeReadHandlers(backend);
  const ids: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await handler.detectOrphanCaptures({
      limit: 3,
      cursor,
    });
    assert.equal(page.ok, true);
    if (!page.ok) break;
    ids.push(
      ...page.items.map((item) => `${item.category}:${item.record_id}`)
    );
    cursor = page.next_cursor;
  } while (cursor);

  assert.equal(ids.length, new Set(ids).size);
  assert.deepEqual(
    new Set(ids),
    new Set(
      orphanSnapshot.captures.flatMap((capture) => [
        `CAPTURE_WITHOUT_BATCH:${capture.capture_id}`,
        `MISSING_REQUEST_OR_SESSION:${capture.capture_id}`,
      ])
    )
  );
});

test("batch listing supports known and explicitly empty projects", async () => {
  const backend: BackendReader = async () => ({
    ok: true,
    revision: "rev-batches",
    batches: [
      {
        batch_id: "BAT-A1",
        project: "Alpha",
        status: "REVIEW_READY",
        human_status: "PENDING",
        created_at: "2026-07-20T12:00:00Z",
        subjects: ["David"],
      },
      {
        batch_id: "BAT-A2",
        project: "Alpha",
        status: "RESOLVED",
        human_status: "APPROVED",
        created_at: "2026-07-21T12:00:00Z",
        subjects: ["Mambo"],
      },
      {
        batch_id: "BAT-EMPTY",
        project: "",
        status: "REVIEW_READY",
        human_status: "PENDING",
        created_at: "2026-07-22T12:00:00Z",
        subjects: [],
      },
    ],
  });
  const handler = createSafeReadHandlers(backend);

  const known = await handler.listBatchesByProject({
    project: "Alpha",
    limit: 50,
  });
  const empty = await handler.listBatchesByProject({
    project: "",
    limit: 50,
  });

  assert.equal(known.ok, true);
  assert.deepEqual(
    known.ok ? known.items.map((item) => item.batch_id) : [],
    ["BAT-A1", "BAT-A2"]
  );
  assert.equal(empty.ok, true);
  assert.deepEqual(
    empty.ok ? empty.items.map((item) => item.batch_id) : [],
    ["BAT-EMPTY"]
  );
});

test("batch listing filters pending, terminal, dates, statuses and subjects", async () => {
  const backend: BackendReader = async () => ({
    ok: true,
    revision: "rev-filtered-batches",
    batches: [
      {
        batch_id: "BAT-PENDING",
        project: "Alpha",
        status: "REVIEW_READY",
        human_status: "PENDING",
        created_at: "2026-07-20T12:00:00Z",
        subjects: ["David"],
      },
      {
        batch_id: "BAT-TERMINAL",
        project: "Alpha",
        status: "RESOLVED",
        human_status: "APPROVED",
        created_at: "2026-07-21T12:00:00Z",
        subjects: ["Mambo"],
      },
    ],
  });
  const handler = createSafeReadHandlers(backend);

  const pending = await handler.listBatchesByProject({
    project: "Alpha",
    statuses: ["REVIEW_READY"],
    human_statuses: ["PENDING"],
    subjects: ["David"],
    date_from: "2026-07-20T00:00:00Z",
    date_to: "2026-07-20T23:59:59Z",
    limit: 50,
  });
  const terminal = await handler.listBatchesByProject({
    project: "Alpha",
    statuses: ["RESOLVED"],
    limit: 50,
  });

  assert.deepEqual(
    pending.ok ? pending.items.map((item) => item.batch_id) : [],
    ["BAT-PENDING"]
  );
  assert.deepEqual(
    terminal.ok ? terminal.items.map((item) => item.batch_id) : [],
    ["BAT-TERMINAL"]
  );
});

test("batch pagination has no duplicates or omissions", async () => {
  const expected = Array.from({ length: 8 }, (_, index) => ({
    batch_id: `BAT-${String(index + 1).padStart(2, "0")}`,
    project: "Alpha",
    status: index % 2 === 0 ? "REVIEW_READY" : "RESOLVED",
    human_status: index % 2 === 0 ? "PENDING" : "APPROVED",
    created_at: `2026-07-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
    subjects: [],
  }));
  const backend: BackendReader = async () => ({
    ok: true,
    revision: "rev-batch-pagination",
    batches: [...expected, expected[2]],
  });
  const handler = createSafeReadHandlers(backend);
  const ids: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await handler.listBatchesByProject({
      project: "Alpha",
      limit: 3,
      cursor,
    });
    assert.equal(page.ok, true);
    if (!page.ok) break;
    ids.push(...page.items.map((item) => item.batch_id));
    cursor = page.next_cursor;
  } while (cursor);

  assert.equal(ids.length, new Set(ids).size);
  assert.deepEqual(ids, expected.map((batch) => batch.batch_id));
});

test("non-local runtime refuses to start without MCP_API_KEY", () => {
  assert.throws(
    () => assertRuntimeSecurity({ nodeEnv: "production", mcpApiKey: "" }),
    /MCP_API_KEY/
  );
  assert.doesNotThrow(() =>
    assertRuntimeSecurity({ nodeEnv: "development", mcpApiKey: "" })
  );
  assert.doesNotThrow(() =>
    assertRuntimeSecurity({ nodeEnv: "production", mcpApiKey: "configured" })
  );
});

test("common mutation contract is fail-safe and verification is explicit", () => {
  const control = MutationControlSchema.parse({
    dry_run: true,
    idempotency_key: "idem-001",
    expected_revision: "rev-1",
    reason: "Synthetic contract test",
    updated_by: "test-suite",
    source_evidence: [{ source_type: "FIXTURE", source_id: "fixture-1" }],
    overwrite: false,
    trace_id: "trace-001",
  });

  assert.equal(control.dry_run, true);
  assert.equal(control.overwrite, false);
  assert.equal(
    FieldVerificationStatusSchema.parse("CANDIDATE"),
    "CANDIDATE"
  );
  assert.throws(() =>
    FieldVerificationStatusSchema.parse("VERIFIED_INFERENCE")
  );
  assert.throws(() =>
    MutationControlSchema.parse({
      ...control,
      source_evidence: [
        {
          source_type: "FILENAME_HEURISTIC",
          source_id: "filename.png",
          verification_status: "VERIFIED_SOURCE",
        },
      ],
    })
  );
});

test("Apps Script errors are returned safely without leaking details", async () => {
  const backend: BackendReader = async () => {
    throw new Error("secret=top-secret prompt=private prompt token=abc");
  };

  const result = await createSafeReadHandlers(backend).getCapture({
    capture_id: "CAP-001",
  });

  assert.equal(result.ok, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("top-secret"), false);
  assert.equal(serialized.includes("private prompt"), false);
  assert.equal(serialized.includes("token=abc"), false);
  assert.equal(result.ok ? undefined : result.error.code, "BACKEND_ERROR");
});

test("the ten production tools remain registered", async () => {
  const source = await readFile(
    "src/index.ts",
    "utf8"
  );
  const registered = Array.from(
    source.matchAll(/server\.registerTool\(\s*"([^"]+)"/g),
    (match) => match[1]
  );
  const productionTools = [
    "visual_get_system_status",
    "visual_list_pending_batches",
    "visual_get_batch",
    "visual_list_recent_captures",
    "visual_create_session",
    "visual_close_session",
    "visual_create_request",
    "visual_cancel_request",
    "visual_submit_decision",
    "visual_promote_asset",
  ];

  for (const tool of productionTools) {
    assert.equal(registered.includes(tool), true, `${tool} must remain registered`);
  }
  assert.equal(registered.length, 13);
});
