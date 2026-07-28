import { randomUUID } from "node:crypto";
import { z } from "zod";
export const FieldVerificationStatusSchema = z.enum([
    "VERIFIED_SOURCE",
    "CANDIDATE",
    "UNKNOWN",
]);
const INFERRED_SOURCE_PATTERN = /AI|FILENAME|FOLDER|HEURISTIC|INFERENCE|GENERATED_SUMMARY/i;
export const SourceEvidenceSchema = z
    .object({
    source_type: z.string().trim().min(1).max(64),
    source_id: z.string().trim().min(1).max(256),
    field: z.string().trim().min(1).max(128).optional(),
    verification_status: FieldVerificationStatusSchema.default("UNKNOWN"),
})
    .superRefine((evidence, context) => {
    if (evidence.verification_status === "VERIFIED_SOURCE" &&
        INFERRED_SOURCE_PATTERN.test(evidence.source_type)) {
        context.addIssue({
            code: "custom",
            path: ["verification_status"],
            message: "Inferred evidence cannot be stored as VERIFIED_SOURCE",
        });
    }
});
export const TraceIdSchema = z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const PaginationCursorSchema = z.string().trim().min(1).max(2048);
export const MutationControlSchema = z.object({
    dry_run: z.boolean(),
    idempotency_key: z.string().trim().min(8).max(256),
    expected_revision: z.string().trim().min(1).max(256),
    reason: z.string().trim().min(1).max(1000),
    updated_by: z.string().trim().min(1).max(256),
    source_evidence: z.array(SourceEvidenceSchema).min(1),
    overwrite: z.boolean().default(false),
    trace_id: TraceIdSchema,
});
export const AuditOperationSchema = z.enum([
    "CREATE",
    "UPDATE",
    "STATE_TRANSITION",
    "RETRY",
]);
export const AuditRecordSchema = z.object({
    audit_id: z.string().uuid(),
    trace_id: TraceIdSchema,
    idempotency_key: z.string().trim().min(8).max(256),
    operation: AuditOperationSchema,
    target_type: z.string().trim().min(1).max(64),
    target_id: z.string().trim().min(1).max(256),
    actor: z.string().trim().min(1).max(256),
    reason: z.string().trim().min(1).max(1000),
    dry_run: z.boolean(),
    before_revision: z.string().trim().min(1).max(256),
    after_revision: z.string().trim().min(1).max(256).nullable(),
    source_evidence: z.array(SourceEvidenceSchema),
    created_at: z.string().datetime({ offset: true }),
});
export const IMMUTABLE_FIELDS = Object.freeze([
    "capture_id",
    "batch_id",
    "request_id",
    "session_id",
    "created_at",
    "captured_at",
    "processed_at",
    "human_decision",
    "human_status",
    "reviewed_by",
    "approved_by",
]);
export const StructuredErrorCodeSchema = z.enum([
    "INVALID_ARGUMENT",
    "INVALID_CURSOR",
    "NOT_FOUND",
    "BACKEND_ERROR",
    "BACKEND_PROTOCOL_ERROR",
    "CONFLICT",
    "UNAUTHORIZED",
    "INTERNAL_ERROR",
]);
export function createTraceId(provided) {
    if (provided) {
        return TraceIdSchema.parse(provided);
    }
    return `trace-${randomUUID()}`;
}
export function structuredError(code, message, traceId, retryable = false) {
    return {
        ok: false,
        trace_id: traceId,
        error: {
            code,
            message,
            retryable,
        },
    };
}
export function assertRuntimeSecurity(input) {
    const nodeEnv = (input.nodeEnv || "development").toLowerCase();
    const isLocal = new Set(["development", "test", "local"]).has(nodeEnv);
    if (!isLocal && !input.mcpApiKey) {
        throw new Error("MCP_API_KEY is required when NODE_ENV is not local or development");
    }
}
const CursorPayloadSchema = z.object({
    offset: z.number().int().nonnegative(),
    revision: z.string().min(1).max(256),
});
export function encodePaginationCursor(payload) {
    return Buffer.from(JSON.stringify(CursorPayloadSchema.parse(payload)), "utf8").toString("base64url");
}
export function decodePaginationCursor(cursor) {
    const validated = PaginationCursorSchema.parse(cursor);
    let decoded;
    try {
        decoded = JSON.parse(Buffer.from(validated, "base64url").toString("utf8"));
    }
    catch {
        throw new Error("Invalid pagination cursor");
    }
    const result = CursorPayloadSchema.safeParse(decoded);
    if (!result.success) {
        throw new Error("Invalid pagination cursor");
    }
    return result.data;
}
