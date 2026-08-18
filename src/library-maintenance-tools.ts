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
import type { BackendReader } from "./safe-read-tools.js";

type UnknownRecord = Record<string, unknown>;

export type LibraryFileRecord = UnknownRecord & {
  file_id: string;
  name: string;
  mime_type: string;
  path: string;
  scope: "INBOX" | "LIBRARY";
};

export type DriveReferenceCheck = {
  file_id: string;
  state: "EXISTS" | "NOT_FOUND" | "UNAVAILABLE";
  source: "ASSET_REGISTRY" | "ASSET_INDEX";
};

export type LibraryMaintenanceSnapshot = {
  revision: string;
  scan?: {
    file_limit: number;
    truncated: boolean;
  };
  files: LibraryFileRecord[];
  captures: UnknownRecord[];
  result_memory: UnknownRecord[];
  asset_registry: UnknownRecord[];
  asset_index: UnknownRecord[];
  reference_checks: DriveReferenceCheck[];
};

export type LibraryFindingCategory =
  | "UNREGISTERED_INBOX_FILE"
  | "UNINDEXED_LIBRARY_FILE"
  | "BROKEN_DRIVE_REFERENCE"
  | "UNAVAILABLE_DRIVE_REFERENCE"
  | "INCOMPLETE_CAPTURE_METADATA"
  | "ASSET_STATE_CONFLICT"
  | "DUPLICATE_NAME_CANDIDATE";

export type LibraryFinding = {
  category: LibraryFindingCategory;
  record_type: "FILE" | "CAPTURE" | "ASSET" | "REFERENCE";
  record_id: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  verification_status: "VERIFIED_SOURCE" | "CANDIDATE" | "UNKNOWN";
  evidence: string[];
  suggested_action: string;
  suggested_category?: string;
  requires_human_approval: true;
};

export const ListLibraryInventoryInputSchema = z.object({
  scope: z.enum(["ALL", "INBOX", "LIBRARY"]).default("ALL"),
  cursor: PaginationCursorSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  trace_id: TraceIdSchema.optional(),
});

export const PlanLibraryReconciliationInputSchema = z.object({
  dry_run: z.literal(true),
  cursor: PaginationCursorSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  trace_id: TraceIdSchema.optional(),
});

type SafeSuccess<T extends UnknownRecord> = { ok: true; trace_id: string } & T;
type SafeResult<T extends UnknownRecord> = SafeSuccess<T> | StructuredErrorResponse;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStatus(value: unknown): string {
  return stringValue(value).toUpperCase();
}

function driveIdFrom(value: unknown): string {
  const text = stringValue(value);
  if (!text) return "";
  const match = text.match(/\/d\/([A-Za-z0-9_-]+)/) ?? text.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return match?.[1] || (/^[A-Za-z0-9_-]+$/.test(text) ? text : "");
}

function recordDriveId(record: UnknownRecord): string {
  return (
    driveIdFrom(record.source_file_id) ||
    driveIdFrom(record.file_id) ||
    driveIdFrom(record.drive_url) ||
    driveIdFrom(record["Drive Link"])
  );
}

function candidateCategory(path: string): string {
  if (path.includes("/02. Ready/")) return "READY_CANDIDATE";
  if (path.includes("/04. Locations/")) return "LOCATION_CANDIDATE";
  if (path.includes("/05. Inspiration/")) return "INSPIRATION_CANDIDATE";
  if (path.includes("/90. Archive/")) return "ARCHIVE_CANDIDATE";
  return "NEEDS_REVIEW";
}

export function planLibraryReconciliation(
  snapshot: LibraryMaintenanceSnapshot
): LibraryFinding[] {
  const findings: LibraryFinding[] = [];
  const indexedFileIds = new Set(
    [...snapshot.asset_registry, ...snapshot.asset_index]
      .map(recordDriveId)
      .filter(Boolean)
  );
  const capturedFileIds = new Set(
    snapshot.captures.map((capture) => driveIdFrom(capture.file_id)).filter(Boolean)
  );

  for (const file of snapshot.files) {
    if (
      file.scope === "INBOX" &&
      !indexedFileIds.has(file.file_id) &&
      !capturedFileIds.has(file.file_id)
    ) {
      findings.push({
        category: "UNREGISTERED_INBOX_FILE",
        record_type: "FILE",
        record_id: file.file_id,
        severity: "MEDIUM",
        verification_status: "VERIFIED_SOURCE",
        evidence: [`Drive scope=INBOX`, `file_id=${file.file_id}`],
        suggested_action: "Registrar procedencia o enviar a revisión; no mover automáticamente",
        suggested_category: "NEEDS_REVIEW",
        requires_human_approval: true,
      });
    }
    if (file.scope === "LIBRARY" && !indexedFileIds.has(file.file_id)) {
      findings.push({
        category: "UNINDEXED_LIBRARY_FILE",
        record_type: "FILE",
        record_id: file.file_id,
        severity: "MEDIUM",
        verification_status: "VERIFIED_SOURCE",
        evidence: [`Drive scope=LIBRARY`, `path=${file.path}`],
        suggested_action: "Proponer fila en 13_Asset_Index con procedencia pendiente",
        suggested_category: candidateCategory(file.path),
        requires_human_approval: true,
      });
    }
  }

  const byName = new Map<string, LibraryFileRecord[]>();
  for (const file of snapshot.files) {
    const key = file.name.toLocaleLowerCase();
    byName.set(key, [...(byName.get(key) || []), file]);
  }
  for (const [name, files] of byName) {
    if (files.length < 2) continue;
    for (const file of files) {
      findings.push({
        category: "DUPLICATE_NAME_CANDIDATE",
        record_type: "FILE",
        record_id: file.file_id,
        severity: "LOW",
        verification_status: "CANDIDATE",
        evidence: [`same_name=${name}`, `distinct_ids=${files.map((item) => item.file_id).join(",")}`],
        suggested_action: "Comparar contenido antes de archivar o consolidar",
        suggested_category: "DUPLICATE_CANDIDATE",
        requires_human_approval: true,
      });
    }
  }

  for (const capture of snapshot.captures) {
    const missing = ["project", "identity_subjects", "scene", "prompt_context"]
      .filter((field) => !stringValue(capture[field]));
    if (!stringValue(capture.request_id) && !stringValue(capture.session_id)) {
      missing.push("request_id_or_session_id");
    }
    if (!missing.length) continue;
    findings.push({
      category: "INCOMPLETE_CAPTURE_METADATA",
      record_type: "CAPTURE",
      record_id: stringValue(capture.capture_id) || "UNKNOWN_CAPTURE",
      severity: "MEDIUM",
      verification_status: "VERIFIED_SOURCE",
      evidence: missing.map((field) => `missing=${field}`),
      suggested_action: "Preparar metadata candidata con evidencia; no completar por inferencia",
      requires_human_approval: true,
    });
  }

  for (const asset of snapshot.asset_registry) {
    const approved = normalizeStatus(asset.human_anchor_approval) === "APPROVED";
    const notCleared = normalizeStatus(asset.identity_clearance) === "NOT_CLEARED";
    const provenanceOpen = ["NEEDS_REVIEW", "UNKNOWN"].includes(
      normalizeStatus(asset.provenance_state)
    );
    if (!approved || (!notCleared && !provenanceOpen)) continue;
    findings.push({
      category: "ASSET_STATE_CONFLICT",
      record_type: "ASSET",
      record_id: stringValue(asset.asset_id) || "UNKNOWN_ASSET",
      severity: "HIGH",
      verification_status: "VERIFIED_SOURCE",
      evidence: [
        `human_anchor_approval=${stringValue(asset.human_anchor_approval)}`,
        `identity_clearance=${stringValue(asset.identity_clearance)}`,
        `provenance_state=${stringValue(asset.provenance_state)}`,
      ],
      suggested_action: "Resolver autoridad y procedencia mediante decisión humana separada",
      requires_human_approval: true,
    });
  }

  for (const check of snapshot.reference_checks) {
    if (check.state === "EXISTS") continue;
    findings.push({
      category: check.state === "NOT_FOUND" ? "BROKEN_DRIVE_REFERENCE" : "UNAVAILABLE_DRIVE_REFERENCE",
      record_type: "REFERENCE",
      record_id: check.file_id,
      severity: check.state === "NOT_FOUND" ? "HIGH" : "MEDIUM",
      verification_status: check.state === "NOT_FOUND" ? "VERIFIED_SOURCE" : "UNKNOWN",
      evidence: [`source=${check.source}`, `state=${check.state}`],
      suggested_action: check.state === "NOT_FOUND"
        ? "Conservar historia y reemplazar el enlace activo solo con evidencia"
        : "Reintentar lectura autorizada antes de declarar referencia rota",
      requires_human_approval: true,
    });
  }

  const unique = new Map<string, LibraryFinding>();
  for (const finding of findings) {
    const key = `${finding.category}|${finding.record_type}|${finding.record_id}`;
    if (!unique.has(key)) unique.set(key, finding);
  }
  return [...unique.values()].sort((left, right) =>
    `${left.category}|${left.record_id}`.localeCompare(`${right.category}|${right.record_id}`)
  );
}

function isSnapshot(value: unknown): value is LibraryMaintenanceSnapshot {
  if (!isRecord(value) || !stringValue(value.revision)) return false;
  for (const field of ["files", "captures", "result_memory", "asset_registry", "asset_index", "reference_checks"] as const) {
    if (!Array.isArray(value[field]) || value[field].some((item) => !isRecord(item))) return false;
  }
  return (value.files as UnknownRecord[]).every((file) =>
    Boolean(stringValue(file.file_id) && stringValue(file.name) && ["INBOX", "LIBRARY"].includes(stringValue(file.scope)))
  );
}

function paginate<T>(items: T[], cursor: string | undefined, limit: number, revision: string) {
  let offset = 0;
  if (cursor) {
    const decoded = decodePaginationCursor(cursor);
    if (decoded.revision !== revision) throw new Error("STALE_CURSOR");
    offset = decoded.offset;
  }
  if (offset > items.length) throw new Error("INVALID_CURSOR");
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    total: items.length,
    next_cursor: nextOffset < items.length
      ? encodePaginationCursor({ offset: nextOffset, revision })
      : undefined,
  };
}

function handlerError(error: unknown, traceId: string): StructuredErrorResponse {
  if (error instanceof Error && error.message === "STALE_CURSOR") {
    return structuredError("CONFLICT", "Pagination cursor does not match the current library revision", traceId);
  }
  if (error instanceof Error && error.message === "INVALID_CURSOR") {
    return structuredError("INVALID_CURSOR", "Pagination cursor is invalid", traceId);
  }
  return structuredError("BACKEND_ERROR", "Visual library backend request failed", traceId, true);
}

async function readSnapshot(backend: BackendReader, traceId: string): Promise<LibraryMaintenanceSnapshot> {
  const response = await backend("library_snapshot", { trace_id: traceId });
  if (!isRecord(response) || !isSnapshot(response.snapshot)) {
    throw new Error("INVALID_LIBRARY_SNAPSHOT");
  }
  return response.snapshot;
}

export function createLibraryMaintenanceHandlers(backend: BackendReader) {
  let cachedSnapshot: LibraryMaintenanceSnapshot | undefined;
  let cachedAt = 0;
  const snapshotTtlMs = 5 * 60 * 1000;

  async function readCachedSnapshot(traceId: string) {
    if (cachedSnapshot && Date.now() - cachedAt < snapshotTtlMs) {
      return cachedSnapshot;
    }
    cachedSnapshot = await readSnapshot(backend, traceId);
    cachedAt = Date.now();
    return cachedSnapshot;
  }

  return {
    async listLibraryInventory(rawInput: z.input<typeof ListLibraryInventoryInputSchema>): Promise<
      SafeResult<{ revision: string; scan?: LibraryMaintenanceSnapshot["scan"]; items: LibraryFileRecord[]; total: number; next_cursor?: string }>
    > {
      const parsed = ListLibraryInventoryInputSchema.safeParse(rawInput);
      const traceId = createTraceId(parsed.success ? parsed.data.trace_id : undefined);
      if (!parsed.success) return structuredError("INVALID_ARGUMENT", "Library inventory query is invalid", traceId);
      try {
        const snapshot = await readCachedSnapshot(traceId);
        const unique = new Map(snapshot.files.map((file) => [file.file_id, file]));
        const files = [...unique.values()]
          .filter((file) => parsed.data.scope === "ALL" || file.scope === parsed.data.scope)
          .sort((left, right) => left.file_id.localeCompare(right.file_id));
        return { ok: true, trace_id: traceId, revision: snapshot.revision, scan: snapshot.scan, ...paginate(files, parsed.data.cursor, parsed.data.limit, snapshot.revision) };
      } catch (error) {
        return handlerError(error, traceId);
      }
    },

    async planLibraryReconciliation(rawInput: unknown): Promise<
      SafeResult<{ revision: string; scan?: LibraryMaintenanceSnapshot["scan"]; dry_run: true; write_count: 0; items: LibraryFinding[]; total: number; next_cursor?: string }>
    > {
      const parsed = PlanLibraryReconciliationInputSchema.safeParse(rawInput);
      const traceId = createTraceId(parsed.success ? parsed.data.trace_id : undefined);
      if (!parsed.success) return structuredError("INVALID_ARGUMENT", "dry_run=true is required for library reconciliation", traceId);
      try {
        const snapshot = await readCachedSnapshot(traceId);
        const page = paginate(planLibraryReconciliation(snapshot), parsed.data.cursor, parsed.data.limit, snapshot.revision);
        return { ok: true, trace_id: traceId, revision: snapshot.revision, scan: snapshot.scan, dry_run: true, write_count: 0, ...page };
      } catch (error) {
        return handlerError(error, traceId);
      }
    },
  };
}
