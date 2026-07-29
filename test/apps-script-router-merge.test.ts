import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createAppsScriptReadClient } from "../src/apps-script-read-client.js";
import { createSafeReadHandlers } from "../src/safe-read-tools.js";

type UnknownRecord = Record<string, unknown>;
type AppsScriptOutput = {
  text: string;
  setMimeType: (mimeType: string) => AppsScriptOutput;
};
type AppsScriptGet = (event: {
  parameter?: Record<string, string>;
}) => AppsScriptOutput;

const ROUTER_ROOT = join(
  process.cwd(),
  "apps-script-production-candidate"
);

function fixtureSheets(): Record<string, unknown[][]> {
  return {
    CAPTURES: [
      [
        "capture_id",
        "file_id",
        "batch_id",
        "request_id",
        "session_id",
        "project",
        "identity_subjects",
        "captured_at",
        "status",
      ],
      [
        "CAP-001",
        "FILE-001",
        "BATCH-001",
        "REQ-001",
        "SESSION-001",
        "PROJECT-A",
        "DAVID | JUAN",
        "2026-01-01T10:00:00.000Z",
        "REVIEW_REQUIRED",
      ],
      [
        "CAP-BROKEN",
        "FILE-002",
        "BATCH-MISSING",
        "REQ-MISSING",
        "SESSION-002",
        "PROJECT-A",
        "DAVID",
        "2026-01-02T10:00:00.000Z",
        "CAPTURED",
      ],
      [
        "CAP-UNKNOWN",
        "FILE-003",
        "",
        "",
        "",
        "",
        "",
        "2026-01-03T10:00:00.000Z",
        "CAPTURED",
      ],
    ],
    BATCHES: [
      [
        "batch_id",
        "created_at",
        "session_id",
        "status",
        "human_status",
      ],
      [
        "BATCH-001",
        "2026-01-01T09:00:00.000Z",
        "SESSION-001",
        "REVIEW_READY",
        "PENDING",
      ],
      [
        "BATCH-EMPTY-PROJECT",
        "2026-01-03T09:00:00.000Z",
        "",
        "RESOLVED",
        "APPROVED",
      ],
    ],
    REQUESTS: [
      ["request_id", "session_id", "project", "subjects", "created_at"],
      [
        "REQ-001",
        "SESSION-001",
        "PROJECT-A",
        "DAVID | JUAN",
        "2026-01-01T08:00:00.000Z",
      ],
    ],
    REVIEW_QUEUE: [
      ["review_id", "capture_id", "request_id", "human_decision"],
      ["REVIEW-001", "CAP-001", "REQ-001", "PENDING"],
      ["REVIEW-ORPHAN", "CAP-NOT-PRESENT", "", "PENDING"],
    ],
    RESULT_MEMORY: [
      ["result_id", "capture_id", "request_id", "created_at"],
      ["RESULT-001", "CAP-001", "REQ-001", "2026-01-01T11:00:00.000Z"],
      [
        "RESULT-ORPHAN",
        "CAP-NOT-PRESENT",
        "",
        "2026-01-02T11:00:00.000Z",
      ],
    ],
    ASSET_REGISTRY: [
      ["asset_id", "source_capture_id", "result_id", "status"],
      ["ASSET-001", "CAP-001", "RESULT-001", "ACTIVE"],
      ["ASSET-ORPHAN", "CAP-NOT-PRESENT", "", "ACTIVE"],
    ],
    FAILURE_MEMORY: [["failure_id"], ["FAILURE-001"]],
  };
}

function normalize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadRecoveredRouter() {
  const sheets = fixtureSheets();
  const original = JSON.stringify(sheets);
  let writeAttempts = 0;

  function sheetFor(name: string) {
    const values = sheets[name];
    if (!values) return null;
    return {
      getName: () => name,
      getLastColumn: () => values[0]?.length || 0,
      getLastRow: () => values.length,
      getDataRange: () => ({ getValues: () => normalize(values) }),
      getRange: (
        row: number,
        column: number,
        rowCount: number,
        columnCount: number
      ) => ({
        getValues: () =>
          normalize(
            values
              .slice(row - 1, row - 1 + rowCount)
              .map((record) =>
                record.slice(column - 1, column - 1 + columnCount)
              )
          ),
        setValue: () => {
          writeAttempts += 1;
          throw new Error("Fixture write attempted");
        },
      }),
      appendRow: () => {
        writeAttempts += 1;
        throw new Error("Fixture write attempted");
      },
    };
  }

  const context = vm.createContext({
    Array,
    Boolean,
    Date,
    JSON,
    Math,
    Number,
    Object,
    String,
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (name: string) => sheetFor(name),
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name: string) =>
          name === "VISUAL_OS_SHARED_SECRET" ? "router-fixture-secret" : "",
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" },
      computeDigest: (_algorithm: string, value: string) =>
        [...crypto.createHash("sha256").update(value).digest()].map((byte) =>
          byte > 127 ? byte - 256 : byte
        ),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text: string): AppsScriptOutput => ({
        text,
        setMimeType() {
          return this;
        },
      }),
    },
  });

  for (const file of [
    "01. Config.js",
    "02. Utils.js",
    "10.SafeReads.js",
    "05. WebApp.js",
  ]) {
    vm.runInContext(readFileSync(join(ROUTER_ROOT, file), "utf8"), context, {
      filename: file,
    });
  }

  return {
    doGet: context.doGet as AppsScriptGet,
    sheets,
    original,
    writeAttempts: () => writeAttempts,
  };
}

function callGet(
  doGet: AppsScriptGet,
  action: string,
  params: Record<string, string> = {}
): UnknownRecord {
  return JSON.parse(
    doGet({
      parameter: {
        action,
        secret: "router-fixture-secret",
        ...params,
      },
    }).text
  ) as UnknownRecord;
}

test("production router preserves HEAD actions and adds three reads", () => {
  const source = readFileSync(join(ROUTER_ROOT, "05. WebApp.js"), "utf8");
  for (const action of [
    "status",
    "batches",
    "batch",
    "captures",
    "active_session",
    "validate_schema",
    "create_session",
    "close_session",
    "create_request",
    "cancel_request",
    "submit_decision",
    "promote_asset",
    "capture",
    "orphan_snapshot",
    "batches_catalog",
  ]) {
    assert.match(source, new RegExp(`case ['"]${action}['"]`));
  }
});

test("safe-read Apps Script source contains no mutating or external APIs", () => {
  const source = readFileSync(join(ROUTER_ROOT, "10.SafeReads.js"), "utf8");
  for (const forbidden of [
    "appendRow",
    "setValue",
    "setValues",
    "setProperty",
    "deleteProperty",
    "deleteRow",
    "DriveApp",
    "UrlFetchApp",
    "LockService",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `${forbidden} must not appear in safe reads`
    );
  }
});

test("recovered router capture lookup is exact, unique, and structured", () => {
  const { doGet } = loadRecoveredRouter();
  const found = callGet(doGet, "capture", { id: "CAP-001" });
  assert.equal(found.ok, true);
  assert.equal((found.capture as UnknownRecord).capture_id, "CAP-001");

  const missing = callGet(doGet, "capture", { id: "image-001" });
  assert.equal(missing.ok, false);
  assert.equal((missing.error as UnknownRecord).code, "NOT_FOUND");

  const invalid = callGet(doGet, "capture", { id: "../CAP-001" });
  assert.equal(invalid.ok, false);
  assert.equal((invalid.error as UnknownRecord).code, "INVALID_ARGUMENT");
});

test("recovered router snapshot and catalog are versioned and read-only", () => {
  const runtime = loadRecoveredRouter();
  const snapshotResponse = callGet(runtime.doGet, "orphan_snapshot");
  assert.equal(snapshotResponse.ok, true);
  const snapshot = snapshotResponse.snapshot as UnknownRecord;
  assert.match(snapshot.revision as string, /^sheet-[a-f0-9]{64}$/);
  assert.ok(Array.isArray(snapshot.captures));
  assert.ok(Array.isArray(snapshot.assets));

  const catalog = callGet(runtime.doGet, "batches_catalog");
  assert.equal(catalog.ok, true);
  assert.match(catalog.revision as string, /^sheet-[a-f0-9]{64}$/);
  const batches = catalog.batches as UnknownRecord[];
  assert.deepEqual(
    batches.map((batch) => batch.status).sort(),
    ["RESOLVED", "REVIEW_READY"]
  );
  assert.equal(
    batches.find((batch) => batch.batch_id === "BATCH-001")?.project,
    "PROJECT-A"
  );
  assert.equal(
    batches.find((batch) => batch.batch_id === "BATCH-001")
      ?.project_verification_status,
    "CANDIDATE"
  );
  assert.equal(
    batches.find((batch) => batch.batch_id === "BATCH-EMPTY-PROJECT")
      ?.project,
    ""
  );
  assert.equal(
    batches.find((batch) => batch.batch_id === "BATCH-EMPTY-PROJECT")
      ?.project_verification_status,
    "UNKNOWN"
  );

  assert.equal(runtime.writeAttempts(), 0);
  assert.equal(JSON.stringify(runtime.sheets), runtime.original);
});

test("MCP completes all three reads through the recovered router over HTTP", async () => {
  const runtime = loadRecoveredRouter();
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const output = runtime.doGet({
      parameter: Object.fromEntries(url.searchParams.entries()),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(output.text);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const backend = createAppsScriptReadClient({
      webAppUrl: `http://127.0.0.1:${address.port}/exec`,
      sharedSecret: "router-fixture-secret",
      timeoutMs: 2_000,
    });
    const handlers = createSafeReadHandlers(backend);

    assert.equal(
      (await handlers.getCapture({ capture_id: "CAP-001" })).ok,
      true
    );

    const orphans = await handlers.detectOrphanCaptures({ limit: 200 });
    assert.equal(orphans.ok, true);
    if (orphans.ok) {
      assert.ok(
        orphans.items.some((item) => item.category === "MISSING_BATCH")
      );
      assert.ok(
        orphans.items.some((item) => item.category === "ORPHAN_ASSET")
      );
    }

    const batches = await handlers.listBatchesByProject({
      project: "PROJECT-A",
      limit: 50,
    });
    assert.equal(batches.ok, true);
    if (batches.ok) {
      assert.equal(batches.items.length, 1);
      assert.equal(batches.items[0].batch_id, "BATCH-001");
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
