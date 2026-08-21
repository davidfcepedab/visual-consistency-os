import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

type UnknownRecord = Record<string, unknown>;

const ROOT = join(process.cwd(), "apps-script-production-candidate");

function loadFiles(context: vm.Context, files: string[]): void {
  for (const file of files) {
    vm.runInContext(readFileSync(join(ROOT, file), "utf8"), context, {
      filename: file,
    });
  }
}

// ---------------------------------------------------------------------------
// Single-image scoring policy (03. Scoring.js: computeAutoDecision_)
// ---------------------------------------------------------------------------

function loadComputeAutoDecision(): (score: UnknownRecord) => string {
  const context = vm.createContext({ Number, String });
  loadFiles(context, ["01. Config.js", "03. Scoring.js"]);
  return context.computeAutoDecision_ as (score: UnknownRecord) => string;
}

test("single-image: identity_fidelity of exactly 3.0 (Diagnostic floor) is not hard-rejected", () => {
  const computeAutoDecision_ = loadComputeAutoDecision();
  const decision = computeAutoDecision_({
    identity_fidelity: 3.0,
    overall_score: 3.0,
    anatomy: 4.0,
  });
  assert.notEqual(decision, "REJECT");
});

test("single-image: identity_fidelity of 2.99 (Rejected band) is hard-rejected", () => {
  const computeAutoDecision_ = loadComputeAutoDecision();
  const decision = computeAutoDecision_({
    identity_fidelity: 2.99,
    overall_score: 4.5,
    anatomy: 4.5,
  });
  assert.equal(decision, "REJECT");
});

test("single-image: overall_score of 2.99 is hard-rejected even with strong identity/anatomy", () => {
  const computeAutoDecision_ = loadComputeAutoDecision();
  const decision = computeAutoDecision_({
    identity_fidelity: 4.8,
    overall_score: 2.99,
    anatomy: 4.8,
  });
  assert.equal(decision, "REJECT");
});

test("single-image: anatomy of 2.99 is hard-rejected", () => {
  const computeAutoDecision_ = loadComputeAutoDecision();
  const decision = computeAutoDecision_({
    identity_fidelity: 4.8,
    overall_score: 4.8,
    anatomy: 2.99,
  });
  assert.equal(decision, "REJECT");
});

test("single-image: anatomy of exactly 3.0 no longer triggers the old 3.5 hard-reject drift", () => {
  const computeAutoDecision_ = loadComputeAutoDecision();
  const decision = computeAutoDecision_({
    identity_fidelity: 4.0,
    overall_score: 4.0,
    anatomy: 3.0,
  });
  assert.equal(decision, "ADJUST");
});

test("single-image: a mid-band Diagnostic score resolves to ADJUST, not REJECT", () => {
  const computeAutoDecision_ = loadComputeAutoDecision();
  const decision = computeAutoDecision_({
    identity_fidelity: 3.5,
    overall_score: 3.5,
    anatomy: 3.8,
  });
  assert.equal(decision, "ADJUST");
});

test("single-image: automatic approval stays strict at the documented Approved thresholds", () => {
  const computeAutoDecision_ = loadComputeAutoDecision();

  const justBelow = computeAutoDecision_({
    identity_fidelity: 4.49,
    overall_score: 5,
    anatomy: 5,
  });
  assert.equal(justBelow, "ADJUST");

  const atThreshold = computeAutoDecision_({
    identity_fidelity: 4.5,
    overall_score: 4.5,
    anatomy: 4.2,
  });
  assert.equal(atThreshold, "APPROVE");
});

// ---------------------------------------------------------------------------
// Batch scoring policy (07. BatchWorkflow.js: computeBatchAutoDecision_)
// ---------------------------------------------------------------------------

function loadComputeBatchAutoDecision(): (
  score: UnknownRecord,
  cfg: UnknownRecord
) => string {
  const context = vm.createContext({ Number, String });
  loadFiles(context, ["01. Config.js", "07. BatchWorkflow.js"]);
  return context.computeBatchAutoDecision_ as (
    score: UnknownRecord,
    cfg: UnknownRecord
  ) => string;
}

const BATCH_CFG = {
  archiveThreshold: 3.0,
  reviewThreshold: 4.4,
  identityThreshold: 4.3,
};

test("batch: overall_score of exactly 3.0 (Diagnostic floor) is not hard-rejected", () => {
  const computeBatchAutoDecision_ = loadComputeBatchAutoDecision();
  const decision = computeBatchAutoDecision_(
    { identity_fidelity: 3.0, overall_score: 3.0, anatomy: 3.0 },
    BATCH_CFG
  );
  assert.notEqual(decision, "REJECT");
});

test("batch: overall_score of 2.99 is hard-rejected", () => {
  const computeBatchAutoDecision_ = loadComputeBatchAutoDecision();
  const decision = computeBatchAutoDecision_(
    { identity_fidelity: 4.5, overall_score: 2.99, anatomy: 4.5 },
    BATCH_CFG
  );
  assert.equal(decision, "REJECT");
});

test("batch: identity_fidelity of 2.99 is hard-rejected", () => {
  const computeBatchAutoDecision_ = loadComputeBatchAutoDecision();
  const decision = computeBatchAutoDecision_(
    { identity_fidelity: 2.99, overall_score: 4.5, anatomy: 4.5 },
    BATCH_CFG
  );
  assert.equal(decision, "REJECT");
});

test("batch: anatomy of 2.99 is hard-rejected (previously batch had no anatomy check at all)", () => {
  const computeBatchAutoDecision_ = loadComputeBatchAutoDecision();
  const decision = computeBatchAutoDecision_(
    { identity_fidelity: 4.5, overall_score: 4.5, anatomy: 2.99 },
    BATCH_CFG
  );
  assert.equal(decision, "REJECT");
});

test("batch: a mid-band Diagnostic score resolves to ADJUST, not REJECT", () => {
  const computeBatchAutoDecision_ = loadComputeBatchAutoDecision();
  const decision = computeBatchAutoDecision_(
    { identity_fidelity: 3.6, overall_score: 3.6, anatomy: 3.6 },
    BATCH_CFG
  );
  assert.equal(decision, "ADJUST");
});

test("batch: automatic approval stays strict at the configured review/identity thresholds", () => {
  const computeBatchAutoDecision_ = loadComputeBatchAutoDecision();

  const justBelow = computeBatchAutoDecision_(
    { identity_fidelity: 4.2, overall_score: 4.4, anatomy: 4.5 },
    BATCH_CFG
  );
  assert.equal(justBelow, "ADJUST");

  const atThreshold = computeBatchAutoDecision_(
    { identity_fidelity: 4.3, overall_score: 4.4, anatomy: 4.5 },
    BATCH_CFG
  );
  assert.equal(atThreshold, "APPROVE");
});

// ---------------------------------------------------------------------------
// FAILURE_MEMORY gating: only hard rejects and technical/blocking failures
// belong there — ADJUST must not be appended.
// ---------------------------------------------------------------------------

type FixtureFile = {
  id: string;
  name: string;
};

function createFixtureDriveApp() {
  const files: Record<string, FixtureFile & { parents: string[] }> = {
    "FILE-ADJUST": { id: "FILE-ADJUST", name: "adjust.png", parents: ["INBOX"] },
    "FILE-REJECT": { id: "FILE-REJECT", name: "reject.png", parents: ["INBOX"] },
  };
  const folders: Record<string, { id: string }> = {
    ADJUSTMENT_FOLDER: { id: "ADJUSTMENT_FOLDER" },
    HUMAN_REVIEW_FOLDER: { id: "HUMAN_REVIEW_FOLDER" },
  };

  function makeFile(id: string) {
    const record = files[id];
    return {
      getId: () => record.id,
      getName: () => record.name,
      setName: (name: string) => {
        record.name = name;
      },
      getUrl: () => `https://drive.google.com/file/d/${record.id}/view`,
      getParents: () => {
        let index = 0;
        const parentIds = record.parents;
        return {
          hasNext: () => index < parentIds.length,
          next: () => {
            const parentId = parentIds[index++];
            return {
              getId: () => parentId,
              removeFile: () => {
                record.parents = record.parents.filter((p) => p !== parentId);
              },
            };
          },
        };
      },
    };
  }

  return {
    getFileById: (id: string) => makeFile(id),
    getFolderById: (id: string) => {
      if (!folders[id]) folders[id] = { id };
      return {
        getId: () => id,
        getFiles: () => ({
          hasNext: () => false,
          next: () => {
            throw new Error("No fixture files");
          },
        }),
        addFile: (file: { getId: () => string }) => {
          const record = files[file.getId()];
          if (record && !record.parents.includes(id)) record.parents.push(id);
        },
      };
    },
  };
}

function createFixtureSheets() {
  const sheets: Record<string, unknown[][]> = {
    CAPTURES: [
      ["capture_id", "status", "selected_for_review", "technical_error"],
    ],
    REVIEW_QUEUE: [
      [
        "result_id",
        "request_id",
        "capture_id",
        "file_id",
        "temp_filename",
        "drive_url",
        "scoring_status",
        "auto_decision",
        "human_decision",
        "human_scope",
        "final_filename",
        "next_action",
        "processed_at",
        "human_notes",
        "approved_by",
        "decision_at",
      ],
    ],
    RESULT_MEMORY: [
      [
        "result_id",
        "request_id",
        "created_at",
        "project",
        "subjects",
        "scene",
        "mode",
        "mechanism",
        "pack_version",
        "model",
        "identity_fidelity",
        "composition",
        "anatomy",
        "skin_realism",
        "camera",
        "continuity",
        "mambo_accuracy",
        "rings_tattoos_accuracy",
        "ai_gloss",
        "overall_score",
        "auto_decision",
        "dominant_failure",
        "preserve",
        "next_adjustment",
        "permitted_use",
        "prohibited_use",
        "prompt",
        "asset_link",
      ],
    ],
    FAILURE_MEMORY: [
      [
        "failure_id",
        "capture_id",
        "result_id",
        "request_id",
        "batch_id",
        "project",
        "subjects",
        "failure_category",
        "failure_description",
        "generator",
        "model",
        "prompt_version",
        "reference_pack",
        "repeated_failure",
        "do_not_reuse_as",
        "corrective_rule",
        "created_at",
        "notes",
      ],
    ],
  };

  function sheetFor(name: string) {
    const values = sheets[name];
    return {
      getName: () => name,
      getLastColumn: () => values[0].length,
      getLastRow: () => values.length,
      getDataRange: () => ({
        getValues: () => JSON.parse(JSON.stringify(values)),
      }),
      getRange: (row: number, column: number, rowCount = 1, columnCount = 1) => ({
        getValues: () =>
          values
            .slice(row - 1, row - 1 + rowCount)
            .map((record) => record.slice(column - 1, column - 1 + columnCount)),
        setValue: (value: unknown) => {
          values[row - 1][column - 1] = value;
        },
      }),
      appendRow: (row: unknown[]) => {
        values.push(row);
      },
    };
  }

  return { sheets, sheetFor };
}

function loadBatchWorkflowRuntime() {
  const { sheets, sheetFor } = createFixtureSheets();
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
    DriveApp: createFixtureDriveApp(),
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => "",
      }),
    },
    Utilities: {
      formatDate: () => "2026-08-20T00:00:00-05:00",
      getUuid: () => "00000000-0000-0000-0000-000000000000",
    },
  });

  loadFiles(context, [
    "01. Config.js",
    "02. Utils.js",
    "06. Workflow.js",
    "07. BatchWorkflow.js",
  ]);

  return {
    writeBatchScores_: context.writeBatchScores_ as (
      batchId: string,
      captures: UnknownRecord[],
      batchResult: UnknownRecord,
      cfg: UnknownRecord
    ) => void,
    sheets,
  };
}

test("batch: ADJUST result is not appended to FAILURE_MEMORY", () => {
  const { writeBatchScores_, sheets } = loadBatchWorkflowRuntime();
  const captures = [
    {
      capture_id: "CAP-ADJUST",
      file_id: "FILE-ADJUST",
      request_id: "REQ-1",
      project: "PROJECT-A",
      identity_subjects: "David",
      scene: "",
      prompt_context: "",
      generator_inferred: "GEMINI",
      _sheetRow: 2,
    },
  ];
  // Diagnostic-band score: overall/identity/anatomy all >= 3.0 archive
  // threshold, below the 4.3/4.4 approve thresholds -> ADJUST.
  const batchResult = {
    results: [
      {
        capture_id: "CAP-ADJUST",
        identity_fidelity: 3.6,
        overall_score: 3.6,
        anatomy: 3.6,
        dominant_failure: "minor continuity drift",
        prohibited_use: [],
        next_adjustment: "tighten continuity",
      },
    ],
  };
  sheets.CAPTURES.push(["CAP-ADJUST", "BATCHED", "FALSE", ""]);

  writeBatchScores_("BATCH-1", captures, batchResult, BATCH_CFG);

  assert.equal(sheets.FAILURE_MEMORY.length, 1, "no failure rows should be appended for ADJUST");
});

test("batch: REJECT result is appended to FAILURE_MEMORY", () => {
  const { writeBatchScores_, sheets } = loadBatchWorkflowRuntime();
  const captures = [
    {
      capture_id: "CAP-REJECT",
      file_id: "FILE-REJECT",
      request_id: "REQ-2",
      project: "PROJECT-A",
      identity_subjects: "David",
      scene: "",
      prompt_context: "",
      generator_inferred: "GEMINI",
      _sheetRow: 2,
    },
  ];
  const batchResult = {
    results: [
      {
        capture_id: "CAP-REJECT",
        identity_fidelity: 2.5,
        overall_score: 2.5,
        anatomy: 2.5,
        dominant_failure: "wrong identity",
        prohibited_use: ["identity anchor"],
        next_adjustment: "regenerate from scratch",
      },
    ],
  };
  sheets.CAPTURES.push(["CAP-REJECT", "BATCHED", "FALSE", ""]);

  writeBatchScores_("BATCH-2", captures, batchResult, BATCH_CFG);

  assert.equal(sheets.FAILURE_MEMORY.length, 2, "the hard reject must be recorded");
  const failureRow = sheets.FAILURE_MEMORY[1];
  const headerIndex = sheets.FAILURE_MEMORY[0].indexOf("failure_category");
  assert.equal(failureRow[headerIndex], "IDENTITY");
});

test("batch: a technical/blocking failure (missing Gemini result) is appended to FAILURE_MEMORY", () => {
  const { writeBatchScores_, sheets } = loadBatchWorkflowRuntime();
  const captures = [
    {
      capture_id: "CAP-MISSING",
      file_id: "FILE-ADJUST",
      request_id: "REQ-3",
      project: "PROJECT-A",
      identity_subjects: "David",
      scene: "",
      prompt_context: "",
      generator_inferred: "GEMINI",
      _sheetRow: 2,
    },
  ];
  const batchResult = { results: [] };
  sheets.CAPTURES.push(["CAP-MISSING", "BATCHED", "FALSE", ""]);

  writeBatchScores_("BATCH-3", captures, batchResult, BATCH_CFG);

  assert.equal(sheets.FAILURE_MEMORY.length, 2, "the technical failure must be recorded");
  const failureRow = sheets.FAILURE_MEMORY[1];
  const headerIndex = sheets.FAILURE_MEMORY[0].indexOf("failure_category");
  assert.equal(failureRow[headerIndex], "TECHNICAL");
});

// ---------------------------------------------------------------------------
// Existing human-decision behavior must be unaffected: final APPROVE/REJECT
// stays human-controlled regardless of the auto_decision recommendation.
// ---------------------------------------------------------------------------

function loadApplyHumanDecision() {
  const { sheets, sheetFor } = createFixtureSheets();
  const context = vm.createContext({
    Array,
    Boolean,
    Date,
    JSON,
    Math,
    Number,
    String,
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (name: string) => sheetFor(name),
      }),
    },
    DriveApp: createFixtureDriveApp(),
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => "" }),
    },
    Utilities: {
      formatDate: () => "2026-08-20T00:00:00-05:00",
      getUuid: () => "00000000-0000-0000-0000-000000000000",
    },
  });

  loadFiles(context, ["01. Config.js", "02. Utils.js", "06. Workflow.js"]);

  // Keep this regression focused on the authority of the human decision.
  // Filename construction and asset registration have their own integration
  // coverage and require unrelated REQUESTS/ASSET_REGISTRY fixtures.
  (context as unknown as Record<string, unknown>).findRequestById_ = () => ({
    project: "TEST",
    subjects: "David",
    scene: "Studio",
  });
  (context as unknown as Record<string, unknown>).appendAssetRegistry_ = () => undefined;

  return {
    applyHumanDecision_: context.applyHumanDecision_ as (
      sheet: unknown,
      sheetRow: number,
      row: unknown[],
      headers: Record<string, number>,
      decision: string
    ) => void,
    sheets,
    sheetFor,
  };
}

test("human-decision: REJECT auto_decision recommendation does not force final rejection", () => {
  const { applyHumanDecision_, sheets, sheetFor } = loadApplyHumanDecision();
  const reviewSheet = sheets.REVIEW_QUEUE;
  const headerRow = reviewSheet[0] as string[];
  const headers: Record<string, number> = {};
  headerRow.forEach((h, i) => (headers[h] = i + 1));

  const row = new Array(headerRow.length).fill("");
  row[headers.file_id - 1] = "FILE-ADJUST";
  row[headers.result_id - 1] = "RES-1";
  row[headers.request_id - 1] = "REQ-1";
  row[headers.human_scope - 1] = "";
  reviewSheet.push(row);
  const sheetRow = reviewSheet.length;

  // A human can APPROVE a capture even though the scoring engine's
  // auto_decision (not passed here at all) recommended REJECT — the human
  // decision, not the auto recommendation, drives the final outcome.
  applyHumanDecision_(sheetFor("REVIEW_QUEUE"), sheetRow, row, headers, "APPROVE");

  const nextActionIndex = headers.next_action - 1;
  assert.equal(reviewSheet[sheetRow - 1][nextActionIndex], "COMPLETED_APPROVED");
});

test("human-decision: ADJUST still routes to ADJUSTMENT folder naming and CREATE_CORRECTION_REQUEST", () => {
  const { applyHumanDecision_, sheets, sheetFor } = loadApplyHumanDecision();
  const reviewSheet = sheets.REVIEW_QUEUE;
  const headerRow = reviewSheet[0] as string[];
  const headers: Record<string, number> = {};
  headerRow.forEach((h, i) => (headers[h] = i + 1));

  const row = new Array(headerRow.length).fill("");
  row[headers.file_id - 1] = "FILE-ADJUST";
  row[headers.result_id - 1] = "RES-2";
  row[headers.request_id - 1] = "REQ-2";
  reviewSheet.push(row);
  const sheetRow = reviewSheet.length;

  assert.throws(() =>
    applyHumanDecision_(sheetFor("REVIEW_QUEUE"), sheetRow, row, headers, "ADJUST")
  );
  // createCorrectionRequest_ is not defined in this isolated context (it
  // lives in the REQUESTS workflow file), so the call throws past the
  // point where next_action/final_filename are already written — proving
  // the ADJUST branch still executes its existing rename/move/queue logic
  // unchanged before reaching that (out-of-scope) dependency.
  const finalFilenameIndex = headers.final_filename - 1;
  assert.match(
    String(reviewSheet[sheetRow - 1][finalFilenameIndex]),
    /^ADJUST - /
  );
});
