import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { gunzipSync, gzipSync } from "node:zlib";
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
type AppsScriptPost = (event: {
  parameter?: Record<string, string>;
  postData?: { contents: string };
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
      [
        "asset_id",
        "source_capture_id",
        "result_id",
        "status",
        "subjects",
        "scope",
        "source_file_id",
        "drive_url",
        "allowed_use",
        "prohibited_use",
      ],
      [
        "ASSET-001",
        "CAP-001",
        "RESULT-001",
        "ACTIVE",
        "DAVID",
        "Identity Anchor",
        "FILE-DAVID-P0",
        "https://drive.google.com/file/d/FILE-DAVID-P0/view",
        "identity",
        "face blending",
      ],
      ["ASSET-ORPHAN", "CAP-NOT-PRESENT", "", "ACTIVE", "", "", "", "", "", ""],
    ],
    CONFIG: [
      ["key", "value"],
      ["ACTIVE_DAVID_MASTER_PACK_ID", "PACK-DAVID-V5"],
      ["ACTIVE_COUPLE_P0_REGISTER_ID", "AST-COUPLE-P0"],
      ["AUTO_IDENTITY_PROMOTION", "FALSE"],
      ["HUMAN_APPROVAL_REQUIRED", "TRUE"],
      ["SERIES_OUTPUT_POLICY", "ONE_IMAGE_PER_GENERATION"],
    ],
    "13_Asset_Index": [
      ["Asset", "Character / Area", "Status", "Drive Link", "Folder", "Notes"],
      [
        "missing.png",
        "David",
        "NEEDS_REVIEW",
        "https://drive.google.com/file/d/FILE-MISSING/view",
        "03. Review",
        "Synthetic missing reference",
      ],
    ],
    FAILURE_MEMORY: [["failure_id"], ["FAILURE-001"]],
  };
}

function normalize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createSyntheticDriveApp() {
  type FixtureFile = {
    id: string;
    name: string;
    mimeType: string;
    modifiedAt: string;
    size: number;
  };
  const files: Record<string, FixtureFile> = {
    "FILE-INBOX": {
      id: "FILE-INBOX",
      name: "new-reference.jpg",
      mimeType: "image/jpeg",
      modifiedAt: "2026-08-18T10:00:00.000Z",
      size: 100,
    },
    "FILE-LIBRARY": {
      id: "FILE-LIBRARY",
      name: "candidate.png",
      mimeType: "image/png",
      modifiedAt: "2026-08-18T11:00:00.000Z",
      size: 200,
    },
  };
  const iterator = <T>(items: T[]) => {
    let index = 0;
    return { hasNext: () => index < items.length, next: () => items[index++] };
  };
  const makeFile = (record: FixtureFile) => ({
    getId: () => record.id,
    getName: () => record.name,
    getMimeType: () => record.mimeType,
    getLastUpdated: () => new Date(record.modifiedAt),
    getSize: () => record.size,
  });
  type FixtureFolder = {
    getId: () => string;
    getName: () => string;
    getFiles: () => { hasNext: () => boolean; next: () => ReturnType<typeof makeFile> };
    getFolders: () => { hasNext: () => boolean; next: () => FixtureFolder };
  };
  function makeFolder(
    id: string,
    name: string,
    childFiles: FixtureFile[],
    childFolders: FixtureFolder[] = []
  ) {
    return {
      getId: () => id,
      getName: () => name,
      getFiles: () => iterator(childFiles.map(makeFile)),
      getFolders: () => iterator(childFolders),
    };
  }
  const review = makeFolder("FOLDER-REVIEW", "03. Review", [files["FILE-LIBRARY"]]);
  const folders: Record<string, FixtureFolder> = {
    "1yDdDAVD8NpoLFDu-lhJpwqe3P60AjwkA": makeFolder(
      "1yDdDAVD8NpoLFDu-lhJpwqe3P60AjwkA",
      "00. Inbox",
      [files["FILE-INBOX"]]
    ),
    "1WCjfFllc76t7X9BEM63AFQleFeuNRD3b": makeFolder(
      "1WCjfFllc76t7X9BEM63AFQleFeuNRD3b",
      "05. Image Library | Organizada",
      [],
      [review]
    ),
  };

  return {
    getFolderById: (id: string) => {
      if (!folders[id]) throw new Error("Folder not found");
      return folders[id];
    },
    getFileById: (id: string) => {
      if (!files[id]) throw new Error("File not found");
      return makeFile(files[id]);
    },
  };
}

function createSyntheticDriveV3() {
  const folders: Record<string, { id: string; name: string; parent: string }> = {
    "FOLDER-REVIEW": {
      id: "FOLDER-REVIEW",
      name: "03. Review",
      parent: "1WCjfFllc76t7X9BEM63AFQleFeuNRD3b",
    },
  };
  const files = [
    {
      id: "FILE-INBOX",
      name: "new-reference.jpg",
      mimeType: "image/jpeg",
      modifiedTime: "2026-08-18T10:00:00.000Z",
      size: "100",
      parent: "1yDdDAVD8NpoLFDu-lhJpwqe3P60AjwkA",
    },
    {
      id: "FILE-LIBRARY",
      name: "candidate.png",
      mimeType: "image/png",
      modifiedTime: "2026-08-18T11:00:00.000Z",
      size: "200",
      parent: "FOLDER-REVIEW",
    },
  ];
  return {
    Files: {
      list: (options: { q?: string }) => {
        const parent = String(options.q || "").match(/'([^']+)' in parents/)?.[1] || "";
        const wantsFolders = String(options.q || "").includes("mimeType = 'application/vnd.google-apps.folder'");
        return {
          files: wantsFolders
            ? Object.values(folders)
                .filter((folder) => folder.parent === parent)
                .map(({ id, name }) => ({ id, name }))
            : files
                .filter((file) => file.parent === parent)
                .map(({ parent: _parent, ...file }) => file),
        };
      },
      get: (id: string) => {
        if (files.some((file) => file.id === id)) return { id, trashed: false };
        throw new Error("404 not found");
      },
    },
  };
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
    DriveApp: createSyntheticDriveApp(),
    Drive: createSyntheticDriveV3(),
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
      getUuid: () => "00000000-0000-4000-8000-000000000001",
      newBlob: (value: string | number[]) => {
        const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
        return {
          getBytes: () => [...bytes],
          getDataAsString: () => bytes.toString("utf8"),
        };
      },
      gzip: (blob: { getBytes: () => number[] }) => {
        const bytes = gzipSync(Buffer.from(blob.getBytes()));
        return { getBytes: () => [...bytes] };
      },
      ungzip: (blob: { getBytes: () => number[] }) => {
        const bytes = gunzipSync(Buffer.from(blob.getBytes()));
        return {
          getBytes: () => [...bytes],
          getDataAsString: () => bytes.toString("utf8"),
        };
      },
      base64EncodeWebSafe: (value: number[]) => Buffer.from(value).toString("base64url"),
      base64DecodeWebSafe: (value: string) => [...Buffer.from(value, "base64url")],
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
    "11.LibraryReads.js",
    "12.GenerationContext.js",
    "15.LibraryReconciliation.js",
    "05. WebApp.js",
  ]) {
    vm.runInContext(readFileSync(join(ROUTER_ROOT, file), "utf8"), context, {
      filename: file,
    });
  }

  return {
    doGet: context.doGet as AppsScriptGet,
    doPost: context.doPost as AppsScriptPost,
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

test("production router preserves HEAD actions and adds safe maintenance reads", () => {
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
    "library_snapshot",
    "generation_context",
    "apply_library_reconciliation",
  ]) {
    assert.match(source, new RegExp(`case ['"]${action}['"]`));
  }
  assert.match(source, /function createFormalRequest_\(payload\)/);
  assert.match(source, /return withLock_\(\(\) => \{/);
  assert.match(source, /function findRequestByTraceId_\(sheet, traceId\)/);
});

test("library snapshot accepts a read-only POST cursor without writing", () => {
  const runtime = loadRecoveredRouter();
  const first = JSON.parse(runtime.doPost({
    parameter: { secret: "router-fixture-secret" },
    postData: { contents: JSON.stringify({ action: "library_snapshot", page_size: 1 }) },
  }).text) as UnknownRecord;
  assert.equal(first.ok, true);
  assert.equal(first.complete, false);
  const second = JSON.parse(runtime.doPost({
    parameter: { secret: "router-fixture-secret" },
    postData: {
      contents: JSON.stringify({
        action: "library_snapshot",
        page_size: 1,
        cursor: first.next_cursor,
      }),
    },
  }).text) as UnknownRecord;
  assert.equal(second.ok, true);
  assert.equal(runtime.writeAttempts(), 0);
  assert.equal(JSON.stringify(runtime.sheets), runtime.original);
});

test("library snapshot is versioned, read-only, and includes both registries", () => {
  const runtime = loadRecoveredRouter();
  let response = callGet(runtime.doGet, "library_snapshot", { page_size: "1" });
  const files: UnknownRecord[] = [];
  while (true) {
    assert.equal(response.ok, true);
    files.push(...(response.files as UnknownRecord[]));
    if (response.complete === true) break;
    response = callGet(runtime.doGet, "library_snapshot", {
      page_size: "1",
      cursor: response.next_cursor as string,
    });
  }
  assert.match(response.revision as string, /^library-[a-f0-9]{64}$/);
  assert.equal(files.length, 2);
  assert.equal(new Set(files.map((file) => file.file_id)).size, 2);
  assert.ok(Array.isArray(response.asset_registry));
  assert.ok(Array.isArray(response.asset_index));
  assert.equal(runtime.writeAttempts(), 0);
  assert.equal(JSON.stringify(runtime.sheets), runtime.original);
});

test("generation context is versioned, read-only, and exposes CONFIG plus registries", () => {
  const runtime = loadRecoveredRouter();
  const response = callGet(runtime.doGet, "generation_context");
  assert.equal(response.ok, true);
  const snapshot = response.snapshot as UnknownRecord;
  assert.match(snapshot.revision as string, /^generation-[a-f0-9]{64}$/);
  const config = snapshot.config as Record<string, unknown>;
  assert.equal(config.ACTIVE_DAVID_MASTER_PACK_ID, "PACK-DAVID-V5");
  assert.equal(config.AUTO_IDENTITY_PROMOTION, "FALSE");
  assert.equal(config.SERIES_OUTPUT_POLICY, "ONE_IMAGE_PER_GENERATION");
  assert.ok(Array.isArray(snapshot.asset_registry));
  assert.ok(Array.isArray(snapshot.asset_index));
  assert.ok(Array.isArray(snapshot.captures));
  assert.ok(Array.isArray(snapshot.requests));
  assert.equal(runtime.writeAttempts(), 0);
  assert.equal(JSON.stringify(runtime.sheets), runtime.original);
});

test("generation-context source contains no write or render operations", () => {
  const source = readFileSync(join(ROUTER_ROOT, "12.GenerationContext.js"), "utf8");
  for (const forbidden of [
    "appendRow",
    "setValue",
    "setValues",
    "setName",
    "moveTo",
    "createFile",
    "createFolder",
    "setTrashed",
    "UrlFetchApp",
    "LockService",
    "generateContent",
  ]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not appear`);
  }
});

test("library-read source contains no write operations", () => {
  const source = readFileSync(join(ROUTER_ROOT, "11.LibraryReads.js"), "utf8");
  for (const forbidden of [
    "appendRow",
    "setValue",
    "setValues",
    "setName",
    "moveTo",
    "createFile",
    "createFolder",
    "setTrashed",
    "UrlFetchApp",
    "LockService",
  ]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not appear`);
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
