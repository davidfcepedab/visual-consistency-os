import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createAppsScriptReadClient } from "../src/apps-script-read-client.js";
import { createSafeReadHandlers } from "../src/safe-read-tools.js";

type UnknownRecord = Record<string, unknown>;
type IsolatedHandler = (
  action: string,
  params: Record<string, string>,
  store?: UnknownRecord
) => UnknownRecord;
type AppsScriptOutput = {
  text: string;
  mimeType?: string;
  setMimeType: (mimeType: string) => AppsScriptOutput;
};
type AppsScriptWebHandler = (event: {
  parameter?: Record<string, string>;
}) => AppsScriptOutput;

function normalize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadIsolatedAppsScript(): {
  handle: IsolatedHandler;
  fixtureStore: () => UnknownRecord;
  doGet: AppsScriptWebHandler;
  doPost: AppsScriptWebHandler;
} {
  const scriptSecret = "synthetic-apps-script-secret";
  const context = vm.createContext({
    Array,
    Boolean,
    Date,
    JSON,
    Math,
    Number,
    Object,
    String,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name: string) =>
          name === "VISUAL_OS_SHARED_SECRET" ? scriptSecret : null,
      }),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text: string): AppsScriptOutput => ({
        text,
        setMimeType(mimeType: string) {
          this.mimeType = mimeType;
          return this;
        },
      }),
    },
  });
  const fixtures = readFileSync(
    join(process.cwd(), "apps-script-isolated", "Fixtures.gs"),
    "utf8"
  );
  const code = readFileSync(
    join(process.cwd(), "apps-script-isolated", "Code.gs"),
    "utf8"
  );

  vm.runInContext(`${fixtures}\n${code}`, context, {
    filename: "visual-os-isolated-apps-script.gs",
  });

  return {
    handle: context.handleVisualReadAction_ as IsolatedHandler,
    fixtureStore: context.getSyntheticVisualStore_ as () => UnknownRecord,
    doGet: context.doGet as AppsScriptWebHandler,
    doPost: context.doPost as AppsScriptWebHandler,
  };
}

test("isolated Apps Script capture lookup is exact and read-only", () => {
  const { handle, fixtureStore } = loadIsolatedAppsScript();
  const store = fixtureStore();
  const before = JSON.stringify(store);

  const found = normalize(handle("capture", { id: "CAP-001" }, store));
  assert.equal(found.ok, true);
  assert.equal((found.capture as UnknownRecord).capture_id, "CAP-001");

  const filenameLookup = normalize(
    handle("capture", { id: "image-001" }, store)
  );
  assert.equal(filenameLookup.ok, false);
  assert.equal((filenameLookup.error as UnknownRecord).code, "NOT_FOUND");
  assert.equal(JSON.stringify(store), before);
});

test("isolated Apps Script returns a complete versioned orphan snapshot", () => {
  const { handle, fixtureStore } = loadIsolatedAppsScript();
  const store = fixtureStore();
  const response = normalize(
    handle("orphan_snapshot", { trace_id: "trace-fixture" }, store)
  );

  assert.equal(response.ok, true);
  const snapshot = response.snapshot as UnknownRecord;
  assert.match(snapshot.revision as string, /^fixture-[a-f0-9]{8}$/);
  for (const field of [
    "captures",
    "batches",
    "requests",
    "reviews",
    "result_memory",
    "assets",
  ]) {
    assert.ok(Array.isArray(snapshot[field]), `${field} must be an array`);
  }
});

test("isolated Apps Script batch catalog includes pending and terminal states", () => {
  const { handle, fixtureStore } = loadIsolatedAppsScript();
  const response = normalize(
    handle("batches_catalog", { trace_id: "trace-fixture" }, fixtureStore())
  );

  assert.equal(response.ok, true);
  const batches = response.batches as UnknownRecord[];
  assert.deepEqual(
    batches.map((batch) => batch.status).sort(),
    ["RESOLVED", "REVIEW_READY"]
  );
  assert.ok(batches.some((batch) => batch.project === ""));
});

test("isolated Apps Script rejects unsupported actions without leaking data", () => {
  const { handle, fixtureStore } = loadIsolatedAppsScript();
  const response = normalize(
    handle("delete_everything", {}, fixtureStore())
  );

  assert.deepEqual(response, {
    ok: false,
    error: {
      code: "INVALID_ARGUMENT",
      message: "Unsupported read action",
      retryable: false,
    },
  });
});

test("isolated Apps Script web entry point requires its secret and rejects POST", () => {
  const { doGet, doPost } = loadIsolatedAppsScript();

  const unauthorized = JSON.parse(
    doGet({
      parameter: {
        action: "capture",
        id: "CAP-001",
      },
    }).text
  ) as UnknownRecord;
  assert.equal(unauthorized.ok, false);
  assert.equal((unauthorized.error as UnknownRecord).code, "UNAUTHORIZED");

  const authorized = JSON.parse(
    doGet({
      parameter: {
        action: "capture",
        id: "CAP-001",
        secret: "synthetic-apps-script-secret",
      },
    }).text
  ) as UnknownRecord;
  assert.equal(authorized.ok, true);

  const rejectedWrite = JSON.parse(doPost({}).text) as UnknownRecord;
  assert.equal(rejectedWrite.ok, false);
  assert.equal(
    (rejectedWrite.error as UnknownRecord).code,
    "METHOD_NOT_ALLOWED"
  );
});

test("MCP safe-read handlers integrate with isolated Apps Script fixtures", async () => {
  const { handle, fixtureStore } = loadIsolatedAppsScript();
  const store = fixtureStore();
  const backend = async (
    action: string,
    params: Record<string, string>
  ): Promise<unknown> => normalize(handle(action, params, store));
  const handlers = createSafeReadHandlers(backend);

  const capture = await handlers.getCapture({
    capture_id: "CAP-001",
    trace_id: "trace-capture",
  });
  assert.equal(capture.ok, true);

  const orphans = await handlers.detectOrphanCaptures({
    limit: 200,
    trace_id: "trace-orphans",
  });
  assert.equal(orphans.ok, true);
  if (orphans.ok) {
    assert.ok(orphans.items.length > 0);
    assert.ok(
      orphans.items.some((item) => item.category === "MISSING_BATCH")
    );
    assert.ok(
      orphans.items.some((item) => item.category === "ORPHAN_ASSET")
    );
  }

  const emptyProject = await handlers.listBatchesByProject({
    project: "",
    limit: 50,
    trace_id: "trace-batches",
  });
  assert.equal(emptyProject.ok, true);
  if (emptyProject.ok) {
    assert.equal(emptyProject.items.length, 1);
    assert.equal(emptyProject.items[0].status, "RESOLVED");
  }
});

test("MCP read client completes all three actions over isolated HTTP", async () => {
  const { doGet } = loadIsolatedAppsScript();
  const httpServer = createServer((request, response) => {
    const requestUrl = new URL(
      request.url || "/",
      "http://127.0.0.1"
    );
    const output = doGet({
      parameter: Object.fromEntries(requestUrl.searchParams.entries()),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(output.text);
  });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");

  try {
    const address = httpServer.address();
    assert.ok(address && typeof address === "object");
    const backend = createAppsScriptReadClient({
      webAppUrl: `http://127.0.0.1:${address.port}/exec`,
      sharedSecret: "synthetic-apps-script-secret",
      timeoutMs: 2_000,
    });
    const handlers = createSafeReadHandlers(backend);

    const capture = await handlers.getCapture({
      capture_id: "CAP-001",
      trace_id: "trace-http-capture",
    });
    assert.equal(capture.ok, true);

    const orphans = await handlers.detectOrphanCaptures({
      limit: 200,
      trace_id: "trace-http-orphans",
    });
    assert.equal(orphans.ok, true);

    const batches = await handlers.listBatchesByProject({
      project: "SYNTHETIC-WEDDING",
      limit: 50,
      trace_id: "trace-http-batches",
    });
    assert.equal(batches.ok, true);
    if (batches.ok) {
      assert.equal(batches.items.length, 1);
      assert.equal(batches.items[0].batch_id, "BATCH-001");
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
