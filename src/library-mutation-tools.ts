import { z } from "zod";
import {
  MutationControlSchema,
  createTraceId,
  structuredError,
  type StructuredErrorResponse,
} from "./contracts.js";
import type { BackendReader } from "./safe-read-tools.js";
import type { BackendWriter } from "./prepare-generation-tools.js";
import {
  driveIdFrom,
  readFullLibrarySnapshot,
  recordDriveId,
  stringValue,
  type LibraryMaintenanceSnapshot,
} from "./library-maintenance-tools.js";

type UnknownRecord = Record<string, unknown>;

/**
 * The only two deterministic, non-authoritative mutations this tool may
 * ever auto-apply. Adding a new action type here is a deliberate safety
 * decision, not a convenience — every action must stay clear of identity,
 * face, tattoo, ring, Detail Lock, Identity Master, and Publication Ready,
 * and must never overwrite an existing human decision.
 */
const DriveFileIdSchema = z
  .string()
  .trim()
  .min(10)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "file_id must be an exact Drive file ID");

export const RegisterCandidateActionSchema = z.object({
  type: z.literal("REGISTER_CANDIDATE"),
  file_id: DriveFileIdSchema,
});

export const ConsolidateDecidedFileActionSchema = z.object({
  type: z.literal("CONSOLIDATE_DECIDED_FILE"),
  file_id: DriveFileIdSchema,
  capture_id: z.string().trim().min(1).max(128),
});

export const LibraryMutationActionSchema = z.discriminatedUnion("type", [
  RegisterCandidateActionSchema,
  ConsolidateDecidedFileActionSchema,
]);

export type LibraryMutationAction = z.infer<typeof LibraryMutationActionSchema>;

export const ApplyLibraryReconciliationInputSchema = MutationControlSchema.extend(
  {
    actions: z.array(LibraryMutationActionSchema).min(1).max(20).superRefine(
      (actions, context) => {
        const seen = new Set<string>();
        actions.forEach((action, index) => {
          const key = `${action.type}|${action.file_id}|${"capture_id" in action ? action.capture_id : ""}`;
          if (seen.has(key)) {
            context.addIssue({
              code: "custom",
              path: [index],
              message: "duplicate reconciliation action",
            });
          }
          seen.add(key);
        });
      }
    ),
  }
);

export type ApplyLibraryReconciliationInput = z.infer<
  typeof ApplyLibraryReconciliationInputSchema
>;

export type PlannedLibraryMutation = {
  type: LibraryMutationAction["type"];
  file_id: string;
  capture_id?: string;
  target: "ASSET_REGISTRY";
  operation: "APPEND_ROW" | "APPEND_PROVENANCE" | "NOOP_ALREADY_REGISTERED";
  match?: { asset_id: string };
  fields: UnknownRecord;
  evidence: string[];
};

export type LibraryMutationRejection = {
  action: LibraryMutationAction;
  code: "NOT_FOUND" | "INVALID_ARGUMENT";
  message: string;
};

// Fields no automatic reconciliation action may ever set. This is the
// allowlist's hard boundary: identity/face/anatomy verification and
// authority promotion stay exclusively human-decided (visual_promote_asset,
// visual_submit_decision, update_asset_authority).
const FORBIDDEN_FIELD_PATTERN =
  /identity|face|tattoo|ring|detail_lock|identity_master|publication_ready/i;

const HUMAN_DECISION_FIELDS = new Set([
  "human_decision",
  "human_status",
  "reviewed_by",
  "approved_by",
]);

function assertSafeFields(fields: UnknownRecord): void {
  for (const key of Object.keys(fields)) {
    if (FORBIDDEN_FIELD_PATTERN.test(key)) {
      throw new Error(`Field not permitted for automatic library reconciliation: ${key}`);
    }
    if (HUMAN_DECISION_FIELDS.has(key)) {
      throw new Error(`Field is a human-decision field and cannot be set automatically: ${key}`);
    }
  }
}

function findExactHumanDecision(
  snapshot: LibraryMaintenanceSnapshot,
  fileId: string,
  captureId: string
): "APPROVE" | "REJECT" | undefined {
  const capture = snapshot.captures.find(
    (record) =>
      stringValue(record.capture_id) === captureId &&
      driveIdFrom(record.file_id) === fileId
  );
  if (!capture) return undefined;
  const status = stringValue(capture.status).toUpperCase();
  if (status === "APPROVED") return "APPROVE";
  if (status === "REJECTED") return "REJECT";
  return undefined;
}

/**
 * Pure planning function: decides exactly which safe, deterministic write
 * each action maps to, without performing any I/O. Anything that cannot be
 * proven safe from the snapshot alone is rejected here, before any backend
 * call is made.
 */
export function planSafeLibraryMutations(
  snapshot: LibraryMaintenanceSnapshot,
  actions: LibraryMutationAction[]
): { plan: PlannedLibraryMutation[]; rejections: LibraryMutationRejection[] } {
  const plan: PlannedLibraryMutation[] = [];
  const rejections: LibraryMutationRejection[] = [];

  const filesById = new Map(snapshot.files.map((file) => [file.file_id, file]));
  const indexedFileIds = new Set(
    [...snapshot.asset_registry, ...snapshot.asset_index]
      .map(recordDriveId)
      .filter(Boolean)
  );
  const registryRowByFileId = new Map<string, UnknownRecord>();
  for (const row of snapshot.asset_registry) {
    const id = recordDriveId(row);
    if (id) registryRowByFileId.set(id, row);
  }

  for (const action of actions) {
    if (action.type === "REGISTER_CANDIDATE") {
      const file = filesById.get(action.file_id);
      if (!file) {
        rejections.push({
          action,
          code: "NOT_FOUND",
          message: `Drive file ${action.file_id} is not present in the current library snapshot.`,
        });
        continue;
      }
      if (indexedFileIds.has(action.file_id)) {
        plan.push({
          type: "REGISTER_CANDIDATE",
          file_id: action.file_id,
          target: "ASSET_REGISTRY",
          operation: "NOOP_ALREADY_REGISTERED",
          fields: {},
          evidence: [`file_id=${action.file_id} already indexed`],
        });
        continue;
      }
      const fields: UnknownRecord = {
        asset_id: `LIB-${file.file_id}`,
        source_file_id: file.file_id,
        file_name: file.name,
        final_filename: file.name,
        drive_url: `https://drive.google.com/file/d/${file.file_id}/view`,
        status: "CANDIDATE",
        scope: "NEEDS_REVIEW",
      };
      assertSafeFields(fields);
      plan.push({
        type: "REGISTER_CANDIDATE",
        file_id: action.file_id,
        target: "ASSET_REGISTRY",
        operation: "APPEND_ROW",
        fields,
        evidence: [`scope=${file.scope}`, `path=${file.path}`],
      });
      continue;
    }

    // CONSOLIDATE_DECIDED_FILE
    const decision = findExactHumanDecision(snapshot, action.file_id, action.capture_id);
    if (!decision) {
      rejections.push({
        action,
        code: "NOT_FOUND",
        message: `No exact existing human APPROVE or REJECT decision proves the destination for capture ${action.capture_id} / file ${action.file_id}.`,
      });
      continue;
    }
    const existingRow = registryRowByFileId.get(action.file_id);
    if (!existingRow) {
      rejections.push({
        action,
        code: "NOT_FOUND",
        message: `File ${action.file_id} has no existing ASSET_REGISTRY row to consolidate; register it first.`,
      });
      continue;
    }
    // Consolidation is audit-only. The originating human decision remains in
    // CAPTURES; automatic maintenance must not rewrite it into a different
    // status or authority field in ASSET_REGISTRY.
    const fields: UnknownRecord = {};
    assertSafeFields(fields);
    plan.push({
      type: "CONSOLIDATE_DECIDED_FILE",
      file_id: action.file_id,
      capture_id: action.capture_id,
      target: "ASSET_REGISTRY",
      operation: "APPEND_PROVENANCE",
      match: { asset_id: stringValue(existingRow.asset_id) },
      fields,
      evidence: [`human_decision=${decision}`, `capture_id=${action.capture_id}`],
    });
  }

  return { plan, rejections };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type SafeSuccess<T extends UnknownRecord> = { ok: true; trace_id: string } & T;
type SafeResult<T extends UnknownRecord> = SafeSuccess<T> | StructuredErrorResponse;

export function createLibraryMutationHandlers(io: {
  read: BackendReader;
  write: BackendWriter;
}) {
  let cachedSnapshot: LibraryMaintenanceSnapshot | undefined;
  let cachedAt = 0;
  const snapshotTtlMs = 5 * 60 * 1000;

  async function readSnapshot(traceId: string, expectedRevision: string) {
    if (
      cachedSnapshot &&
      cachedSnapshot.revision === expectedRevision &&
      Date.now() - cachedAt < snapshotTtlMs
    ) {
      return cachedSnapshot;
    }
    cachedSnapshot = await readFullLibrarySnapshot(io.read, traceId);
    cachedAt = Date.now();
    return cachedSnapshot;
  }

  return {
    async applyLibraryReconciliation(
      rawInput: unknown
    ): Promise<SafeResult<UnknownRecord>> {
      const parsed = ApplyLibraryReconciliationInputSchema.safeParse(rawInput);
      const traceId = createTraceId(
        parsed.success ? parsed.data.trace_id : undefined
      );
      if (!parsed.success) {
        return structuredError(
          "INVALID_ARGUMENT",
          "visual_apply_library_reconciliation input is invalid",
          traceId
        );
      }
      const input = parsed.data;

      try {
        // A replay must be answerable before scanning or comparing the now-
        // advanced revision. Apps Script owns the durable idempotency ledger;
        // NOT_FOUND means this is the first execution and planning may proceed.
        if (!input.dry_run) {
          const replay = await io.write({
            action: "apply_library_reconciliation",
            replay_only: true,
            idempotency_key: input.idempotency_key,
            expected_revision: input.expected_revision,
            actions: input.actions,
            trace_id: traceId,
          });
          if (isRecord(replay) && replay.ok === true) {
            return {
              ...replay,
              ok: true,
              trace_id: traceId,
              dry_run: false,
              idempotency_key: input.idempotency_key,
            } as SafeSuccess<UnknownRecord>;
          }
          const replayCode = isRecord(replay) && isRecord(replay.error)
            ? replay.error.code
            : undefined;
          if (replayCode !== "NOT_FOUND") {
            return structuredError(
              replayCode === "INVALID_ARGUMENT" ? "INVALID_ARGUMENT" : "BACKEND_ERROR",
              "Visual library idempotency lookup failed",
              traceId,
              replayCode !== "INVALID_ARGUMENT"
            );
          }
        }

        const snapshot = await readSnapshot(traceId, input.expected_revision);

        if (input.expected_revision !== snapshot.revision) {
          return structuredError(
            "CONFLICT",
            `expected_revision does not match the current library revision (${snapshot.revision})`,
            traceId
          );
        }

        const { plan, rejections } = planSafeLibraryMutations(
          snapshot,
          input.actions
        );
        if (rejections.length > 0) {
          return structuredError(
            "INVALID_ARGUMENT",
            `Unsafe or unresolved action(s): ${rejections
              .map((rejection) => rejection.message)
              .join(" ")}`,
            traceId
          );
        }

        if (input.dry_run) {
          return {
            ok: true,
            trace_id: traceId,
            dry_run: true,
            write_count: 0,
            revision: snapshot.revision,
            planned: plan,
          };
        }

        const actionable = plan.filter(
          (mutation) => mutation.operation !== "NOOP_ALREADY_REGISTERED"
        );
        if (actionable.length === 0) {
          return {
            ok: true,
            trace_id: traceId,
            dry_run: false,
            applied: false,
            write_count: 0,
            revision: snapshot.revision,
            idempotency_key: input.idempotency_key,
            planned: plan,
          };
        }

        const written = await io.write({
          action: "apply_library_reconciliation",
          idempotency_key: input.idempotency_key,
          expected_revision: input.expected_revision,
          reason: input.reason,
          updated_by: input.updated_by,
          source_evidence: input.source_evidence,
          actions: input.actions,
          overwrite: input.overwrite,
          trace_id: traceId,
          mutations: plan,
        });

        if (!isRecord(written) || written.ok === false) {
          const backendError = isRecord(written) && isRecord(written.error)
            ? written.error
            : undefined;
          const code =
            backendError && backendError.code === "CONFLICT"
              ? "CONFLICT"
              : backendError && backendError.code === "INVALID_ARGUMENT"
                ? "INVALID_ARGUMENT"
                : "BACKEND_ERROR";
          return structuredError(
            code,
            "Visual library reconciliation write failed",
            traceId,
            code === "BACKEND_ERROR"
          );
        }

        return {
          ...(written as UnknownRecord),
          ok: true,
          trace_id: traceId,
          dry_run: false,
          idempotency_key: input.idempotency_key,
        } as SafeSuccess<UnknownRecord>;
      } catch {
        return structuredError(
          "BACKEND_ERROR",
          "Visual library reconciliation failed",
          traceId,
          true
        );
      }
    },
  };
}
