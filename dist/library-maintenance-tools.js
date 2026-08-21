import { z } from "zod";
import { PaginationCursorSchema, TraceIdSchema, createTraceId, decodePaginationCursor, encodePaginationCursor, structuredError, } from "./contracts.js";
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
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function stringValue(value) {
    return typeof value === "string" ? value.trim() : "";
}
function normalizeStatus(value) {
    return stringValue(value).toUpperCase();
}
export function driveIdFrom(value) {
    const text = stringValue(value);
    if (!text)
        return "";
    const match = text.match(/\/d\/([A-Za-z0-9_-]+)/) ?? text.match(/[?&]id=([A-Za-z0-9_-]+)/);
    return match?.[1] || (/^[A-Za-z0-9_-]+$/.test(text) ? text : "");
}
export function recordDriveId(record) {
    return (driveIdFrom(record.source_file_id) ||
        driveIdFrom(record.file_id) ||
        driveIdFrom(record.drive_url) ||
        driveIdFrom(record["Drive Link"]));
}
function candidateCategory(path) {
    if (path.includes("/02. Ready/"))
        return "READY_CANDIDATE";
    if (path.includes("/04. Locations/"))
        return "LOCATION_CANDIDATE";
    if (path.includes("/05. Inspiration/"))
        return "INSPIRATION_CANDIDATE";
    if (path.includes("/90. Archive/"))
        return "ARCHIVE_CANDIDATE";
    return "NEEDS_REVIEW";
}
export function planLibraryReconciliation(snapshot) {
    const findings = [];
    const indexedFileIds = new Set([...snapshot.asset_registry, ...snapshot.asset_index]
        .map(recordDriveId)
        .filter(Boolean));
    const capturedFileIds = new Set(snapshot.captures.map((capture) => driveIdFrom(capture.file_id)).filter(Boolean));
    for (const file of snapshot.files) {
        if (file.scope === "INBOX" &&
            !indexedFileIds.has(file.file_id) &&
            !capturedFileIds.has(file.file_id)) {
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
    const byName = new Map();
    for (const file of snapshot.files) {
        const key = file.name.toLocaleLowerCase();
        byName.set(key, [...(byName.get(key) || []), file]);
    }
    for (const [name, files] of byName) {
        if (files.length < 2)
            continue;
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
        if (!missing.length)
            continue;
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
        const provenanceOpen = ["NEEDS_REVIEW", "UNKNOWN"].includes(normalizeStatus(asset.provenance_state));
        if (!approved || (!notCleared && !provenanceOpen))
            continue;
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
        if (check.state === "EXISTS")
            continue;
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
    const unique = new Map();
    for (const finding of findings) {
        const key = `${finding.category}|${finding.record_type}|${finding.record_id}`;
        if (!unique.has(key))
            unique.set(key, finding);
    }
    return [...unique.values()].sort((left, right) => `${left.category}|${left.record_id}`.localeCompare(`${right.category}|${right.record_id}`));
}
function paginate(items, cursor, limit, revision) {
    let offset = 0;
    if (cursor) {
        const decoded = decodePaginationCursor(cursor);
        if (decoded.revision !== revision)
            throw new Error("STALE_CURSOR");
        offset = decoded.offset;
    }
    if (offset > items.length)
        throw new Error("INVALID_CURSOR");
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
function handlerError(error, traceId) {
    if (error instanceof Error && error.message === "STALE_CURSOR") {
        return structuredError("CONFLICT", "Pagination cursor does not match the current library revision", traceId);
    }
    if (error instanceof Error && error.message === "INVALID_CURSOR") {
        return structuredError("INVALID_CURSOR", "Pagination cursor is invalid", traceId);
    }
    return structuredError("BACKEND_ERROR", "Visual library backend request failed", traceId, true);
}
// Exhaustive, cursor-based Drive traversal: keeps calling the Apps Script
// `library_snapshot` action with the cursor it returns until it reports
// complete:true. Every page's scan_id/revision must stay stable across the
// whole traversal; files are de-duplicated by file_id across pages so a
// multi-parent Drive file (or a defensive re-send) never appears twice.
// There is no silent partial success: a scan that cannot finish (missing
// cursor, changing scan_id, or exceeding the safety page cap) is a thrown
// error, not a truncated-but-labeled-ok snapshot.
const LIBRARY_SCAN_MAX_PAGES = 5000;
const LIBRARY_SCAN_PAGE_SIZE = "500";
export async function readFullLibrarySnapshot(backend, traceId) {
    const filesById = new Map();
    let cursor;
    let scanId;
    let revision;
    let pagesScanned = 0;
    let foldersScanned = 0;
    let filesScanned = 0;
    let finalPage;
    for (let page = 0; page < LIBRARY_SCAN_MAX_PAGES; page += 1) {
        const params = { trace_id: traceId, page_size: LIBRARY_SCAN_PAGE_SIZE };
        if (cursor)
            params.cursor = cursor;
        const response = await backend("library_snapshot", params);
        if (!isRecord(response) || response.ok === false) {
            throw new Error("INVALID_LIBRARY_SNAPSHOT");
        }
        if (typeof response.scan_id !== "string" || typeof response.revision !== "string") {
            throw new Error("INVALID_LIBRARY_SNAPSHOT");
        }
        if (scanId && response.scan_id !== scanId) {
            throw new Error("LIBRARY_SCAN_ID_CHANGED_MID_TRAVERSAL");
        }
        scanId = response.scan_id;
        revision = response.revision;
        pagesScanned += 1;
        foldersScanned = Number(response.folders_scanned) || foldersScanned;
        filesScanned = Number(response.files_scanned) || filesScanned;
        const pageFiles = Array.isArray(response.files) ? response.files : [];
        for (const file of pageFiles) {
            if (!isRecord(file) || !isLibraryFileRecord(file)) {
                throw new Error("INVALID_LIBRARY_SNAPSHOT");
            }
            filesById.set(String(file.file_id), file);
        }
        if (response.complete === true) {
            finalPage = response;
            break;
        }
        if (typeof response.next_cursor !== "string" || !response.next_cursor) {
            throw new Error("LIBRARY_SCAN_INCOMPLETE_MISSING_CURSOR");
        }
        cursor = response.next_cursor;
    }
    if (!finalPage || !scanId || !revision) {
        throw new Error("LIBRARY_SCAN_DID_NOT_COMPLETE");
    }
    const snapshot = {
        revision,
        scan: {
            scan_id: scanId,
            complete: true,
            truncated: false,
            coverage: "COMPLETE",
            pages_scanned: pagesScanned,
            folders_scanned: foldersScanned,
            files_scanned: filesById.size || filesScanned,
        },
        files: [...filesById.values()].sort((left, right) => left.file_id.localeCompare(right.file_id)),
        captures: isArrayOfRecords(finalPage.captures) ? finalPage.captures : [],
        result_memory: isArrayOfRecords(finalPage.result_memory) ? finalPage.result_memory : [],
        asset_registry: isArrayOfRecords(finalPage.asset_registry) ? finalPage.asset_registry : [],
        asset_index: isArrayOfRecords(finalPage.asset_index) ? finalPage.asset_index : [],
        reference_checks: isArrayOfRecords(finalPage.reference_checks)
            ? finalPage.reference_checks
            : [],
    };
    return snapshot;
}
function isArrayOfRecords(value) {
    return Array.isArray(value) && value.every((item) => isRecord(item));
}
function isLibraryFileRecord(value) {
    return Boolean(stringValue(value.file_id) &&
        stringValue(value.name) &&
        ["INBOX", "LIBRARY"].includes(stringValue(value.scope)));
}
export function createLibraryMaintenanceHandlers(backend) {
    let cachedSnapshot;
    let cachedAt = 0;
    const snapshotTtlMs = 5 * 60 * 1000;
    async function readCachedSnapshot(traceId) {
        if (cachedSnapshot && Date.now() - cachedAt < snapshotTtlMs) {
            return cachedSnapshot;
        }
        cachedSnapshot = await readFullLibrarySnapshot(backend, traceId);
        cachedAt = Date.now();
        return cachedSnapshot;
    }
    return {
        async listLibraryInventory(rawInput) {
            const parsed = ListLibraryInventoryInputSchema.safeParse(rawInput);
            const traceId = createTraceId(parsed.success ? parsed.data.trace_id : undefined);
            if (!parsed.success)
                return structuredError("INVALID_ARGUMENT", "Library inventory query is invalid", traceId);
            try {
                const snapshot = await readCachedSnapshot(traceId);
                const unique = new Map(snapshot.files.map((file) => [file.file_id, file]));
                const files = [...unique.values()]
                    .filter((file) => parsed.data.scope === "ALL" || file.scope === parsed.data.scope)
                    .sort((left, right) => left.file_id.localeCompare(right.file_id));
                return { ok: true, trace_id: traceId, revision: snapshot.revision, scan: snapshot.scan, ...paginate(files, parsed.data.cursor, parsed.data.limit, snapshot.revision) };
            }
            catch (error) {
                return handlerError(error, traceId);
            }
        },
        async planLibraryReconciliation(rawInput) {
            const parsed = PlanLibraryReconciliationInputSchema.safeParse(rawInput);
            const traceId = createTraceId(parsed.success ? parsed.data.trace_id : undefined);
            if (!parsed.success)
                return structuredError("INVALID_ARGUMENT", "dry_run=true is required for library reconciliation", traceId);
            try {
                const snapshot = await readCachedSnapshot(traceId);
                const page = paginate(planLibraryReconciliation(snapshot), parsed.data.cursor, parsed.data.limit, snapshot.revision);
                return { ok: true, trace_id: traceId, revision: snapshot.revision, scan: snapshot.scan, dry_run: true, write_count: 0, ...page };
            }
            catch (error) {
                return handlerError(error, traceId);
            }
        },
    };
}
