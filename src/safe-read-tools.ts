import { z } from "zod";
import {
  PaginationCursorSchema,
  TraceIdSchema,
  createTraceId,
  decodePaginationCursor,
  encodePaginationCursor,
  structuredError,
  type StructuredErrorResponse,
} from "./contracts.js";

type UnknownRecord = Record<string, unknown>;

export type BackendReader = (
  action: string,
  params: Record<string, string>
) => Promise<unknown>;

export const CaptureIdField = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/);

export const TraceIdField = TraceIdSchema.optional();
export const CursorField = PaginationCursorSchema.optional();
export const PageLimitField = z.number().int().min(1).max(200).default(50);

const IsoDateField = z
  .string()
  .trim()
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Expected an ISO date or date-time",
  });

export const GetCaptureInputSchema = z.object({
  capture_id: CaptureIdField,
  trace_id: TraceIdField,
});

export const DetectOrphanCapturesInputSchema = z.object({
  cursor: CursorField,
  limit: PageLimitField,
  trace_id: TraceIdField,
});

export const ListBatchesByProjectInputSchema = z
  .object({
    project: z.string().max(256),
    statuses: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
    human_statuses: z
      .array(z.string().trim().min(1).max(64))
      .max(50)
      .optional(),
    date_from: IsoDateField.optional(),
    date_to: IsoDateField.optional(),
    subjects: z.array(z.string().trim().min(1).max(128)).max(50).optional(),
    cursor: CursorField,
    limit: PageLimitField,
    trace_id: TraceIdField,
  })
  .refine(
    ({ date_from, date_to }) =>
      !date_from ||
      !date_to ||
      Date.parse(date_from) <= Date.parse(date_to),
    {
      message: "date_from must be before or equal to date_to",
      path: ["date_from"],
    }
  );

export type CaptureRecord = UnknownRecord & {
  capture_id: string;
  batch_id?: string;
  request_id?: string;
  session_id?: string;
};

export type BatchRecord = UnknownRecord & {
  batch_id: string;
  project?: string;
  status?: string;
  human_status?: string;
  created_at?: string;
  subjects?: string[] | string;
  identity_subjects?: string[] | string;
};

type RequestRecord = UnknownRecord & {
  request_id: string;
};

type CaptureReferenceRecord = UnknownRecord & {
  capture_id?: string;
};

export type OrphanSnapshot = {
  revision: string;
  captures: CaptureRecord[];
  batches: BatchRecord[];
  requests: RequestRecord[];
  reviews: Array<CaptureReferenceRecord & { review_id?: string }>;
  result_memory: Array<CaptureReferenceRecord & { result_id?: string }>;
  assets: Array<CaptureReferenceRecord & { asset_id?: string }>;
};

export type OrphanCategory =
  | "CAPTURE_WITHOUT_BATCH"
  | "MISSING_BATCH"
  | "MISSING_REQUEST_OR_SESSION"
  | "MISSING_REQUEST"
  | "ORPHAN_REVIEW"
  | "ORPHAN_RESULT_MEMORY"
  | "ORPHAN_ASSET";

export type OrphanRecord = {
  category: OrphanCategory;
  reference_state: "UNKNOWN" | "BROKEN_REFERENCE";
  record_type:
    | "CAPTURE"
    | "REVIEW"
    | "RESULT_MEMORY"
    | "ASSET";
  record_id: string;
  referenced_id?: string;
  missing_fields?: string[];
  verification_status: "VERIFIED_SOURCE" | "CANDIDATE" | "UNKNOWN";
};

type SafeSuccess<T extends UnknownRecord> = {
  ok: true;
  trace_id: string;
} & T;

type SafeResult<T extends UnknownRecord> =
  | SafeSuccess<T>
  | StructuredErrorResponse;

type GetCaptureInput = z.input<typeof GetCaptureInputSchema>;
type DetectOrphansInput = z.input<typeof DetectOrphanCapturesInputSchema>;
type ListBatchesInput = z.input<typeof ListBatchesByProjectInputSchema>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordId(
  record: UnknownRecord,
  preferredField: string,
  fallback: string
): string {
  return stringValue(record[preferredField]) || fallback;
}

function unknownLineage(
  capture: CaptureRecord,
  missingFields: string[]
): OrphanRecord {
  return {
    category: "MISSING_REQUEST_OR_SESSION",
    reference_state: "UNKNOWN",
    record_type: "CAPTURE",
    record_id: capture.capture_id,
    missing_fields: missingFields,
    verification_status: "UNKNOWN",
  };
}

export function classifyOrphans(snapshot: OrphanSnapshot): OrphanRecord[] {
  const batchIds = new Set(
    snapshot.batches.map((batch) => stringValue(batch.batch_id)).filter(Boolean)
  );
  const requestIds = new Set(
    snapshot.requests
      .map((request) => stringValue(request.request_id))
      .filter(Boolean)
  );
  const captureIds = new Set(
    snapshot.captures
      .map((capture) => stringValue(capture.capture_id))
      .filter(Boolean)
  );
  const results: OrphanRecord[] = [];

  for (const capture of snapshot.captures) {
    const captureId = stringValue(capture.capture_id);
    const batchId = stringValue(capture.batch_id);
    const requestId = stringValue(capture.request_id);
    const sessionId = stringValue(capture.session_id);

    if (!captureId) continue;

    if (!batchId) {
      results.push({
        category: "CAPTURE_WITHOUT_BATCH",
        reference_state: "UNKNOWN",
        record_type: "CAPTURE",
        record_id: captureId,
        missing_fields: ["batch_id"],
        verification_status: "UNKNOWN",
      });
    } else if (!batchIds.has(batchId)) {
      results.push({
        category: "MISSING_BATCH",
        reference_state: "BROKEN_REFERENCE",
        record_type: "CAPTURE",
        record_id: captureId,
        referenced_id: batchId,
        verification_status: "VERIFIED_SOURCE",
      });
    }

    const missingLineage = [
      !requestId ? "request_id" : "",
      !sessionId ? "session_id" : "",
    ].filter(Boolean);
    if (missingLineage.length > 0) {
      results.push(unknownLineage(capture, missingLineage));
    }

    if (requestId && !requestIds.has(requestId)) {
      results.push({
        category: "MISSING_REQUEST",
        reference_state: "BROKEN_REFERENCE",
        record_type: "CAPTURE",
        record_id: captureId,
        referenced_id: requestId,
        verification_status: "VERIFIED_SOURCE",
      });
    }
  }

  const classifyCaptureReferences = (
    records: CaptureReferenceRecord[],
    category:
      | "ORPHAN_REVIEW"
      | "ORPHAN_RESULT_MEMORY"
      | "ORPHAN_ASSET",
    recordType: "REVIEW" | "RESULT_MEMORY" | "ASSET",
    idField: "review_id" | "result_id" | "asset_id"
  ) => {
    records.forEach((record, index) => {
      const captureId = stringValue(record.capture_id);
      if (captureId && captureIds.has(captureId)) return;

      results.push({
        category,
        reference_state: captureId ? "BROKEN_REFERENCE" : "UNKNOWN",
        record_type: recordType,
        record_id: recordId(record, idField, `${recordType}-${index + 1}`),
        referenced_id: captureId || undefined,
        missing_fields: captureId ? undefined : ["capture_id"],
        verification_status: captureId ? "VERIFIED_SOURCE" : "UNKNOWN",
      });
    });
  };

  classifyCaptureReferences(
    snapshot.reviews,
    "ORPHAN_REVIEW",
    "REVIEW",
    "review_id"
  );
  classifyCaptureReferences(
    snapshot.result_memory,
    "ORPHAN_RESULT_MEMORY",
    "RESULT_MEMORY",
    "result_id"
  );
  classifyCaptureReferences(
    snapshot.assets,
    "ORPHAN_ASSET",
    "ASSET",
    "asset_id"
  );

  const uniqueResults = new Map<string, OrphanRecord>();
  for (const result of results) {
    const key = [
      result.category,
      result.record_type,
      result.record_id,
      result.referenced_id || "",
    ].join("|");
    if (!uniqueResults.has(key)) {
      uniqueResults.set(key, result);
    }
  }

  return [...uniqueResults.values()].sort((left, right) =>
    [
      left.category,
      left.record_type,
      left.record_id,
      left.referenced_id || "",
    ]
      .join("|")
      .localeCompare(
        [
          right.category,
          right.record_type,
          right.record_id,
          right.referenced_id || "",
        ].join("|")
      )
  );
}

function paginate<T>(
  items: T[],
  input: { cursor?: string; limit: number },
  revision: string
): {
  items: T[];
  next_cursor?: string;
  total: number;
} {
  let offset = 0;
  if (input.cursor) {
    const cursor = decodePaginationCursor(input.cursor);
    if (cursor.revision !== revision) {
      throw new Error("Stale pagination cursor");
    }
    offset = cursor.offset;
  }

  if (offset > items.length) {
    throw new Error("Invalid pagination cursor");
  }

  const page = items.slice(offset, offset + input.limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    next_cursor:
      nextOffset < items.length
        ? encodePaginationCursor({ offset: nextOffset, revision })
        : undefined,
    total: items.length,
  };
}

function normalizeSubjects(batch: BatchRecord): string[] {
  const raw = batch.subjects ?? batch.identity_subjects;
  if (Array.isArray(raw)) {
    return raw.map(stringValue).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function classifyHandlerError(
  error: unknown,
  traceId: string
): StructuredErrorResponse {
  const message = error instanceof Error ? error.message : "";
  if (message === "Stale pagination cursor") {
    return structuredError(
      "CONFLICT",
      "Pagination cursor does not match the current dataset revision",
      traceId
    );
  }
  if (message === "Invalid pagination cursor") {
    return structuredError(
      "INVALID_CURSOR",
      "Pagination cursor is invalid",
      traceId
    );
  }
  return structuredError(
    "BACKEND_ERROR",
    "Visual OS backend request failed",
    traceId,
    true
  );
}

export function createSafeReadHandlers(backend: BackendReader) {
  return {
    async getCapture(
      rawInput: GetCaptureInput
    ): Promise<SafeResult<{ capture: UnknownRecord }>> {
      const parsed = GetCaptureInputSchema.safeParse(rawInput);
      const traceId = createTraceId(
        parsed.success ? parsed.data.trace_id : undefined
      );
      if (!parsed.success) {
        return structuredError(
          "INVALID_ARGUMENT",
          "capture_id must be a valid exact identifier",
          traceId
        );
      }

      try {
        const response = await backend("capture", {
          id: parsed.data.capture_id,
          trace_id: traceId,
        });
        if (!isRecord(response)) {
          return structuredError(
            "BACKEND_PROTOCOL_ERROR",
            "Visual OS backend returned an invalid capture response",
            traceId
          );
        }

        if (response.ok === false) {
          const backendError = isRecord(response.error)
            ? response.error
            : response;
          if (backendError.code === "NOT_FOUND") {
            return structuredError(
              "NOT_FOUND",
              "Capture was not found",
              traceId
            );
          }
          return structuredError(
            "BACKEND_ERROR",
            "Visual OS backend request failed",
            traceId,
            true
          );
        }

        if (response.capture === null || response.capture === undefined) {
          return structuredError(
            "NOT_FOUND",
            "Capture was not found",
            traceId
          );
        }
        if (!isRecord(response.capture)) {
          return structuredError(
            "BACKEND_PROTOCOL_ERROR",
            "Visual OS backend returned an invalid capture response",
            traceId
          );
        }
        if (
          stringValue(response.capture.capture_id) !== parsed.data.capture_id
        ) {
          return structuredError(
            "BACKEND_PROTOCOL_ERROR",
            "Visual OS backend did not return the requested capture",
            traceId
          );
        }

        return {
          ok: true,
          trace_id: traceId,
          capture: response.capture,
        };
      } catch (error) {
        return classifyHandlerError(error, traceId);
      }
    },

    async detectOrphanCaptures(
      rawInput: DetectOrphansInput
    ): Promise<
      SafeResult<{
        items: OrphanRecord[];
        next_cursor?: string;
        total: number;
        revision: string;
      }>
    > {
      const parsed = DetectOrphanCapturesInputSchema.safeParse(rawInput);
      const traceId = createTraceId(
        parsed.success ? parsed.data.trace_id : undefined
      );
      if (!parsed.success) {
        return structuredError(
          "INVALID_ARGUMENT",
          "Orphan detection pagination input is invalid",
          traceId
        );
      }

      try {
        const response = await backend("orphan_snapshot", {
          trace_id: traceId,
        });
        if (
          !isRecord(response) ||
          !isRecord(response.snapshot) ||
          !isOrphanSnapshot(response.snapshot)
        ) {
          return structuredError(
            "BACKEND_PROTOCOL_ERROR",
            "Visual OS backend returned an invalid orphan snapshot",
            traceId
          );
        }
        const snapshot = response.snapshot;
        const page = paginate(
          classifyOrphans(snapshot),
          parsed.data,
          snapshot.revision
        );
        return {
          ok: true,
          trace_id: traceId,
          revision: snapshot.revision,
          ...page,
        };
      } catch (error) {
        return classifyHandlerError(error, traceId);
      }
    },

    async listBatchesByProject(
      rawInput: ListBatchesInput
    ): Promise<
      SafeResult<{
        items: BatchRecord[];
        next_cursor?: string;
        total: number;
        revision: string;
      }>
    > {
      const parsed = ListBatchesByProjectInputSchema.safeParse(rawInput);
      const traceId = createTraceId(
        parsed.success ? parsed.data.trace_id : undefined
      );
      if (!parsed.success) {
        return structuredError(
          "INVALID_ARGUMENT",
          "Batch project query is invalid",
          traceId
        );
      }

      try {
        const response = await backend("batches_catalog", {
          trace_id: traceId,
        });
        if (
          !isRecord(response) ||
          !Array.isArray(response.batches) ||
          response.batches.some((batch) => !isRecord(batch))
        ) {
          return structuredError(
            "BACKEND_PROTOCOL_ERROR",
            "Visual OS backend returned an invalid batch catalog",
            traceId
          );
        }
        const revision = stringValue(response.revision) || "UNVERSIONED";
        const statusSet = new Set(parsed.data.statuses || []);
        const humanStatusSet = new Set(parsed.data.human_statuses || []);
        const subjectSet = new Set(parsed.data.subjects || []);

        const uniqueBatches = new Map<string, BatchRecord>();
        for (const batch of response.batches as BatchRecord[]) {
          const batchId = stringValue(batch.batch_id);
          if (batchId && !uniqueBatches.has(batchId)) {
            uniqueBatches.set(batchId, batch);
          }
        }

        const batches = [...uniqueBatches.values()]
          .filter((batch) => stringValue(batch.project) === parsed.data.project)
          .filter(
            (batch) =>
              statusSet.size === 0 || statusSet.has(stringValue(batch.status))
          )
          .filter(
            (batch) =>
              humanStatusSet.size === 0 ||
              humanStatusSet.has(stringValue(batch.human_status))
          )
          .filter((batch) => {
            if (subjectSet.size === 0) return true;
            const availableSubjects = new Set(normalizeSubjects(batch));
            return [...subjectSet].every((subject) =>
              availableSubjects.has(subject)
            );
          })
          .filter((batch) => {
            const createdAt = stringValue(batch.created_at);
            if (!parsed.data.date_from && !parsed.data.date_to) return true;
            if (!createdAt || !Number.isFinite(Date.parse(createdAt))) {
              return false;
            }
            const created = Date.parse(createdAt);
            if (
              parsed.data.date_from &&
              created < Date.parse(parsed.data.date_from)
            ) {
              return false;
            }
            if (
              parsed.data.date_to &&
              created > Date.parse(parsed.data.date_to)
            ) {
              return false;
            }
            return true;
          })
          .sort((left, right) =>
            stringValue(left.batch_id).localeCompare(
              stringValue(right.batch_id)
            )
          );

        const page = paginate(batches, parsed.data, revision);
        return {
          ok: true,
          trace_id: traceId,
          revision,
          ...page,
        };
      } catch (error) {
        return classifyHandlerError(error, traceId);
      }
    },
  };
}

function isOrphanSnapshot(value: UnknownRecord): value is OrphanSnapshot {
  return (
    typeof value.revision === "string" &&
    Array.isArray(value.captures) &&
    Array.isArray(value.batches) &&
    Array.isArray(value.requests) &&
    Array.isArray(value.reviews) &&
    Array.isArray(value.result_memory) &&
    Array.isArray(value.assets)
  );
}
