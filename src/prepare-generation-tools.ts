import { z } from "zod";
import {
  TraceIdSchema,
  createTraceId,
  structuredError,
  type StructuredErrorResponse,
} from "./contracts.js";
import type { BackendReader } from "./safe-read-tools.js";

type UnknownRecord = Record<string, unknown>;

export type BackendWriter = (
  payload: Record<string, unknown>
) => Promise<unknown>;

export const PrepareGenerationInputSchema = z.object({
  project: z.string().trim().min(1).max(256),
  subjects: z.array(z.string().trim().min(1).max(128)).min(1).max(20),
  user_instruction: z.string().trim().min(1).max(8000),
  scene: z.string().trim().max(2000).optional().default(""),
  generator: z.string().trim().min(1).max(64).optional().default("CHATGPT_IMAGE"),
  mode: z.enum(["GENERATE", "EDIT", "REGENERATE"]).optional().default("GENERATE"),
  base_capture_id: z.string().trim().max(128).optional().default(""),
  parent_request_id: z.string().trim().max(128).optional().default(""),
  source_result_id: z.string().trim().max(128).optional().default(""),
  iteration: z.number().int().min(1).max(999).optional().default(1),
  required_anchor_ids: z.array(z.string().trim().min(1).max(128)).max(20).optional(),
  trace_id: TraceIdSchema.optional(),
});

export type PrepareGenerationInput = z.infer<typeof PrepareGenerationInputSchema>;

export type VisualAnchor = {
  asset_id: string;
  subject?: string;
  role: string;
  file_id?: string;
  drive_url?: string;
  file_name?: string;
  status?: string;
  provenance?: string;
  allowed_use: string[];
  prohibited_use: string[];
  source: "ASSET_REGISTRY" | "ASSET_INDEX" | "CONFIG" | "CAPTURES";
  verification_status: "VERIFIED_SOURCE" | "CANDIDATE" | "UNKNOWN";
};

export type SubjectIdentityAuthority = {
  subject: string;
  master_pack_id: string;
  primary_identity_anchor: VisualAnchor | null;
  priority_0_refs: VisualAnchor[];
  supporting_anchors: VisualAnchor[];
  body_anchor: VisualAnchor | null;
  expression_support: VisualAnchor[];
  hairstyle_grooming_locks: VisualAnchor[];
  tattoo_body_locks: VisualAnchor[];
  // P0 FIX: true if multiple DISTINCT physical identity packs are verified
  // for this subject (genuine conflict, not mirroring the same pack).
  ambiguous_identity?: boolean;
};

export type Blocker = {
  code:
    | "MISSING_IDENTITY_ANCHOR"
    | "UNVERIFIED_IDENTITY_AUTHORITY"
    | "MISSING_PRIORITY_0"
    | "MISSING_REQUIRED_REFERENCE"
    | "INVALID_BASE_CAPTURE"
    | "INVALID_EDIT_SOURCE"
    | "MISSING_EDIT_BASE"
    | "AMBIGUOUS_IDENTITY_AUTHORITY"
    | "PROVENANCE_CONFLICT"
    | "SUBJECT_IDENTITY_MIXING";
  message: string;
};

/**
 * P0: normalizes the granular internal Blocker.code taxonomy into the
 * BLOCKED_* vocabulary requested for the human-readable preflight report.
 * The internal codes are kept as-is (more precise, already covered by
 * tests) — this is a display-layer mapping only, not a rename.
 */
export function blockerToStatusCode(
  blocker: Blocker
):
  | "BLOCKED_REFERENCE_MISSING"
  | "BLOCKED_REFERENCE_UNAVAILABLE"
  | "BLOCKED_REFERENCE_AUTHORITY" {
  switch (blocker.code) {
    case "MISSING_IDENTITY_ANCHOR":
    case "MISSING_PRIORITY_0":
    case "MISSING_REQUIRED_REFERENCE":
    case "MISSING_EDIT_BASE":
      return "BLOCKED_REFERENCE_MISSING";
    case "INVALID_BASE_CAPTURE":
    case "INVALID_EDIT_SOURCE":
      return "BLOCKED_REFERENCE_UNAVAILABLE";
    case "UNVERIFIED_IDENTITY_AUTHORITY":
    case "AMBIGUOUS_IDENTITY_AUTHORITY":
    case "PROVENANCE_CONFLICT":
    case "SUBJECT_IDENTITY_MIXING":
      return "BLOCKED_REFERENCE_AUTHORITY";
    default:
      return "BLOCKED_REFERENCE_MISSING";
  }
}

export type HostHandoff = {
  action: "INVOKE_NATIVE_IMAGE_GENERATOR" | "DO_NOT_INVOKE_GENERATOR";
  same_turn: boolean;
  renderer: "HOST_NATIVE";
  note: string;
};

export type GenerationPacket = {
  ok: true;
  ready_to_generate: boolean;
  request_id: string;
  trace_id: string;
  project: string;
  subjects: string[];
  mode: "GENERATE" | "EDIT" | "REGENERATE";
  generator: string;
  pack_version: string;
  identity_authority: SubjectIdentityAuthority[];
  detail_locks: VisualAnchor[];
  location_anchors: VisualAnchor[];
  composition_anchors: VisualAnchor[];
  lighting_anchors: VisualAnchor[];
  mood_anchors: VisualAnchor[];
  relationship_anchors: VisualAnchor[];
  allowed_use: string[];
  prohibited_use: string[];
  final_generation_prompt: string;
  reference_files: VisualAnchor[];
  blockers: Blocker[];
  guardrails: {
    auto_identity_promotion: false;
    human_approval_required: boolean;
    series_output_policy: string;
  };
  host_handoff: HostHandoff;
};

export type GenerationContextSnapshot = {
  revision: string;
  config: Record<string, string>;
  asset_registry: UnknownRecord[];
  asset_index: UnknownRecord[];
  captures: UnknownRecord[];
  requests: UnknownRecord[];
  result_memory: UnknownRecord[];
};

type SafeSuccess<T extends UnknownRecord> = { ok: true; trace_id: string } & T;
type SafeResult<T extends UnknownRecord> =
  | SafeSuccess<T>
  | StructuredErrorResponse;

const IDENTITY_CONTRACT =
  "REFERENCE DEFINES IDENTITY. TEXT DEFINES SCENE.";
const NATIVE_HANDOFF_NOTE =
  "READY_TO_GENERATE and request_id are control-plane outputs, not the image. This MCP never renders. If ready_to_generate is true, the host MUST invoke its native image generator in the same turn using final_generation_prompt and reference_files, then return the bitmap. Do not stop after creating the request.";

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return "";
}

function field(record: UnknownRecord, ...names: string[]): string {
  const keys = Object.keys(record);
  for (const name of names) {
    const direct = record[name];
    if (direct !== undefined && direct !== null && stringValue(direct)) {
      return stringValue(direct);
    }
    const match = keys.find(
      (key) => key.toLowerCase() === name.toLowerCase()
    );
    if (match && stringValue(record[match])) return stringValue(record[match]);
  }
  return "";
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(stringValue).filter(Boolean);
  }
  return stringValue(value)
    .split(/\s*(?:\||\+|,|;)\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function canonicalizeSubject(value: string): string {
  const text = value.trim();
  if (!text) return "";
  if (/\bdavid\b/i.test(text)) return "David";
  if (/\bjuan\b/i.test(text)) return "Juan";
  if (/\bmambo\b/i.test(text)) return "Mambo";
  return text.replace(/\s+/g, " ");
}

export function normalizeSubjects(subjects: string[]): string[] {
  const out: string[] = [];
  for (const raw of subjects) {
    for (const part of raw.split(/\s*(?:\||\+|,|&| and )\s*/i)) {
      const canonical = canonicalizeSubject(part);
      if (canonical && !out.includes(canonical)) out.push(canonical);
    }
  }
  return out;
}

function configValue(
  config: Record<string, string>,
  key: string,
  fallback = ""
): string {
  const match = Object.entries(config).find(
    ([name]) => name.toUpperCase() === key.toUpperCase()
  );
  return match ? stringValue(match[1]) : fallback;
}

function truthyFlag(value: string, fallback: boolean): boolean {
  if (!value) return fallback;
  return !["FALSE", "0", "NO", "OFF"].includes(value.toUpperCase());
}

function driveIdFrom(value: unknown): string {
  const text = stringValue(value);
  if (!text) return "";
  const match =
    text.match(/\/d\/([A-Za-z0-9_-]+)/) ?? text.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return match?.[1] || (/^[A-Za-z0-9_-]+$/.test(text) ? text : "");
}

function recordSubjects(record: UnknownRecord): string[] {
  return unique(
    splitList(
      field(
        record,
        "subjects",
        "Character / Area",
        "character",
        "identity_subjects",
        "subject"
      )
    ).map(canonicalizeSubject)
  );
}

function blobFor(record: UnknownRecord): string {
  return [
    field(record, "scope", "anchor_type", "role", "classification", "type"),
    field(record, "Folder", "folder", "path"),
    field(record, "Notes", "notes", "approval_notes"),
    field(record, "Status", "status"),
    field(record, "Asset", "file_name", "name"),
  ]
    .join(" ")
    .toLowerCase();
}

function isCoupleRecord(record: UnknownRecord): boolean {
  if (/couple|relationship/.test(blobFor(record))) return true;
  const subjects = recordSubjects(record);
  return subjects.includes("David") && subjects.includes("Juan");
}

function classifyRole(record: UnknownRecord): string {
  const blob = blobFor(record);
  if (/couple|relationship/.test(blob)) return "Couple Relationship Anchor";
  if (/room|location/.test(blob)) return "Room Anchor";
  if (/composition/.test(blob)) return "Composition Anchor";
  if (/lighting|light/.test(blob)) return "Lighting Anchor";
  if (/\bmood\b/.test(blob)) return "Mood Anchor";
  if (/tattoo|body lock/.test(blob) && !/identity/.test(blob)) {
    return "Tattoo/Body Lock";
  }
  if (/hairstyle|grooming|hair lock/.test(blob)) return "Hairstyle/Grooming Lock";
  if (/expression/.test(blob)) return "Expression Support";
  if (/body anchor/.test(blob)) return "Body Anchor";
  if (/detail lock/.test(blob)) return "Detail Lock";
  if (/identity|priority 0|priority_0|\bp0\b|master pack|master_pack/.test(blob)) {
    return "Identity Anchor";
  }
  return field(record, "scope", "anchor_type", "role") || "Support";
}

function isPriority0(record: UnknownRecord): boolean {
  return /priority 0|priority_0|\bp0\b|identity master|identity_master/.test(
    blobFor(record)
  );
}

function statusOf(record: UnknownRecord): string {
  return field(record, "status", "Status").toUpperCase();
}

// P0 fix: the Prompt Generator's 13_Asset_Index sheet (an external sheet
// with no human_anchor_approval/approved_by columns at all) records human
// governance decisions as an explicit Status string instead -- confirmed
// as the real convention already in use for David's own healthy Priority 0
// anchors (DAVID_APPROVED_ANCHOR_*), not just Juan's. The original fixed
// lists below only matched a schema (human_anchor_approval column,
// "PRIORITY_0" as a bare literal) that this sheet never actually uses, so
// every asset_index-sourced candidate -- including already-approved ones --
// was being filtered out before verification was even checked, and the
// resolver silently fell back to a deprecated/broken duplicate row instead.
// Candidates the resolver will even consider (broader -- "in scope", not
// yet "verified"). "ACTIVE" alone deliberately stays here and NOT in
// VERIFIED_APPROVAL_STATUS_VALUES below: a record can be usable/current
// without having been through a human approval decision (see the P1
// "candidate identity without approval is not ready" test, which relies on
// exactly that distinction).
const USABLE_STATUS_VALUES = [
  "ACTIVE",
  "APPROVED",
  "PRIORITY_0",
  "PRIORITY_0_PRIMARY",
  "PRIORITY_0_APPROVED",
  "APPROVED_TOP",
  "APPROVED_GOOD",
  "IDENTITY_MASTER",
  "READY",
  "PUBLICATION READY",
];

// Status values that themselves constitute a completed human approval
// decision, for sheets (like the Prompt Generator's 13_Asset_Index) that
// have no dedicated human_anchor_approval/approved_by column at all.
// Deliberately narrower than USABLE_STATUS_VALUES and excludes
// "IDENTITY_MASTER"/"ACTIVE"/"PRIORITY_0"/"READY": those are too generic
// and, in practice, also describe deprecated/superseded duplicate rows --
// including them here would let a stale row outrank a real approved one
// via the verifiedIdentity[0] fallback in resolveSubjectAuthority().
const VERIFIED_APPROVAL_STATUS_VALUES = [
  "APPROVED",
  "PRIORITY_0_PRIMARY",
  "PRIORITY_0_APPROVED",
  "APPROVED_TOP",
  "APPROVED_GOOD",
];

function isUsableStatus(record: UnknownRecord): boolean {
  const status = statusOf(record);
  if (!status) return false;
  return USABLE_STATUS_VALUES.includes(status);
}

function isVerifiedApproval(record: UnknownRecord): boolean {
  const approval = field(record, "human_anchor_approval").toUpperCase();
  if (["APPROVED", "TRUE", "YES"].includes(approval)) return true;
  if (field(record, "approved_by")) return true;
  return VERIFIED_APPROVAL_STATUS_VALUES.includes(statusOf(record));
}

function isVerifiedFacialAnchor(anchor: VisualAnchor | null | undefined): boolean {
  return Boolean(anchor && anchor.verification_status === "VERIFIED_SOURCE");
}

function isRejectedStatus(record: UnknownRecord): boolean {
  const status = statusOf(record);
  return [
    "SUPERSEDED",
    "REJECTED",
    "ARCHIVED",
    "NEEDS_REVIEW",
    "CANDIDATE",
    "SUPPORT_ONLY",
  ].includes(status);
}

function isGeneratedUnpromoted(record: UnknownRecord): boolean {
  const role = classifyRole(record);
  const generated = /generated|golden support|not identity/.test(blobFor(record));
  return generated && role !== "Identity Anchor";
}

function toAnchor(
  record: UnknownRecord,
  source: VisualAnchor["source"],
  subject?: string
): VisualAnchor {
  const assetId =
    field(record, "asset_id", "Asset", "id", "capture_id") ||
    driveIdFrom(field(record, "source_file_id", "file_id", "Drive Link", "drive_url")) ||
    "UNKNOWN";
  return {
    asset_id: assetId,
    subject,
    role: classifyRole(record),
    file_id:
      driveIdFrom(
        field(record, "source_file_id", "file_id", "Drive Link", "drive_url")
      ) || undefined,
    drive_url: field(record, "drive_url", "Drive Link") || undefined,
    file_name: field(record, "file_name", "Asset", "name", "final_filename") || undefined,
    status: field(record, "status", "Status") || undefined,
    provenance:
      field(record, "provenance", "provenance_state", "approval_notes", "Notes") ||
      undefined,
    allowed_use: splitList(record.allowed_use || record["Allowed Use"]),
    prohibited_use: splitList(record.prohibited_use || record["Prohibited Use"]),
    source,
    verification_status: isVerifiedApproval(record)
      ? "VERIFIED_SOURCE"
      : "CANDIDATE",
  };
}

function foldText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function nameTokens(value: string): string[] {
  return foldText(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function matchesSubject(record: UnknownRecord, subject: string): boolean {
  if (isCoupleRecord(record) && subject !== "Couple") return false;
  const subjects = recordSubjects(record);
  if (subjects.includes(subject)) return true;
  const name = field(record, "file_name", "Asset", "name", "asset_id");
  const needle = foldText(subject.trim());
  if (!needle) return false;
  return nameTokens(name).includes(needle);
}

function collectRecords(snapshot: GenerationContextSnapshot): Array<{
  record: UnknownRecord;
  source: VisualAnchor["source"];
}> {
  return [
    ...snapshot.asset_registry.map((record) => ({
      record,
      source: "ASSET_REGISTRY" as const,
    })),
    ...snapshot.asset_index.map((record) => ({
      record,
      source: "ASSET_INDEX" as const,
    })),
  ];
}

type LocatedRecord = {
  record: UnknownRecord;
  source: VisualAnchor["source"];
};

function recordIds(record: UnknownRecord): string[] {
  return unique(
    [
      field(record, "asset_id", "capture_id", "request_id", "result_id", "id"),
      driveIdFrom(
        field(record, "source_file_id", "file_id", "Drive Link", "drive_url")
      ),
    ].filter(Boolean)
  );
}

function findLocated(
  snapshot: GenerationContextSnapshot,
  id: string
): LocatedRecord | undefined {
  const needle = id.trim();
  if (!needle) return undefined;
  const pools: Array<[UnknownRecord[], VisualAnchor["source"]]> = [
    [snapshot.asset_registry, "ASSET_REGISTRY"],
    [snapshot.asset_index, "ASSET_INDEX"],
    [snapshot.captures, "CAPTURES"],
    [snapshot.requests, "CAPTURES"],
    [snapshot.result_memory, "CAPTURES"],
  ];
  for (const [pool, source] of pools) {
    const record = pool.find((item) => recordIds(item).includes(needle));
    if (record) return { record, source };
  }
  return undefined;
}

function findById(
  snapshot: GenerationContextSnapshot,
  id: string
): UnknownRecord | undefined {
  return findLocated(snapshot, id)?.record;
}

function extractExplicitIds(instruction: string, extra: string[] = []): string[] {
  const fromText = instruction.match(/\b(?:AST|CAP|REQ|RES|FILE)-[A-Za-z0-9:_-]+/g) || [];
  return unique([...fromText, ...extra]);
}

function sameAnchor(left: VisualAnchor, right: VisualAnchor): boolean {
  return (
    left.asset_id === right.asset_id &&
    (left.file_id || "") === (right.file_id || "") &&
    left.role === right.role
  );
}

function pushUnique(list: VisualAnchor[], item: VisualAnchor): void {
  if (!list.some((existing) => sameAnchor(existing, item))) list.push(item);
}

function resolveSubjectAuthority(
  subject: string,
  snapshot: GenerationContextSnapshot
): SubjectIdentityAuthority {
  const packKey = `ACTIVE_${subject.toUpperCase()}_MASTER_PACK_ID`;
  const masterPackId = configValue(snapshot.config, packKey);
  const candidates = collectRecords(snapshot)
    .filter(({ record }) => isUsableStatus(record) && !isRejectedStatus(record))
    .filter(({ record }) => !isGeneratedUnpromoted(record))
    .filter(({ record }) => matchesSubject(record, subject))
    // P0 FIX: exclude records marked as physically unavailable/404 in Drive.
    // If Apps Script validates availability and marks `physical_status: "NOT_FOUND"`,
    // they are excluded here. Null/undefined physical_status = no validation info,
    // treated as available (backward-compatible).
    .filter(({ record }) => {
      const status = field(record, "physical_status", "drive_status");
      if (!status) return true; // No validation data, allow
      return !["NOT_FOUND", "404", "BROKEN", "INACCESSIBLE"].includes(
        String(status).toUpperCase()
      );
    });

  const identityRecords = candidates.filter(
    ({ record }) => classifyRole(record) === "Identity Anchor"
  );
  const priority0 = identityRecords.filter(({ record }) => isPriority0(record));
  const supporting = candidates.filter(({ record }) => {
    const role = classifyRole(record);
    return (
      role !== "Identity Anchor" &&
      role !== "Couple Relationship Anchor" &&
      role !== "Room Anchor" &&
      role !== "Composition Anchor" &&
      role !== "Lighting Anchor" &&
      role !== "Mood Anchor"
    );
  });

  const identityAnchors = (priority0.length ? priority0 : identityRecords).map(
    ({ record, source }) => toAnchor(record, source, subject)
  );
  const verifiedIdentity = identityAnchors.filter(isVerifiedFacialAnchor);

  // AMBIGUITY DETECTION: if multiple verified anchors exist with DIFFERENT
  // physical identities (file_id/asset_id), that's genuine conflict, not
  // mirroring. Same pack can appear in multiple registries (asset_registry +
  // asset_index) pointing to the same file — that's OK and canonical.
  // Different packs (different file_ids) = ambiguous.
  const verifiedByFileId = new Map<string, VisualAnchor>();
  for (const anchor of verifiedIdentity) {
    const physicalId = anchor.file_id || anchor.asset_id || "UNKNOWN";
    if (verifiedByFileId.has(physicalId)) {
      // Same file, different registry entry — dedup, keep first
      continue;
    }
    verifiedByFileId.set(physicalId, anchor);
  }
  const dedupedVerified = Array.from(verifiedByFileId.values());

  // If >1 distinct physical identity, this is AMBIGUOUS (genuine conflict),
  // not "two registries of the same pack". Let upstream blocker logic handle it.
  const primary =
    dedupedVerified.find((anchor) =>
      [anchor.asset_id, anchor.file_id, stringValue(anchor.file_name)].includes(
        masterPackId
      )
    ) ||
    dedupedVerified[0] ||
    identityAnchors[0] ||
    null;

  // Report AMBIGUOUS only if multiple DISTINCT physical identities verified
  const hasAmbiguity = dedupedVerified.length > 1;

  const pickRole = (role: string): VisualAnchor[] =>
    candidates
      .filter(({ record }) => classifyRole(record) === role)
      .map(({ record, source }) => toAnchor(record, source, subject));

  return {
    subject,
    master_pack_id: masterPackId,
    primary_identity_anchor: primary,
    priority_0_refs: priority0
      .map(({ record, source }) => toAnchor(record, source, subject))
      .filter(isVerifiedFacialAnchor),
    supporting_anchors: supporting
      .filter(({ record }) => classifyRole(record) === "Support" || classifyRole(record) === "Expression Support")
      .map(({ record, source }) => toAnchor(record, source, subject)),
    body_anchor: pickRole("Body Anchor")[0] || null,
    expression_support: pickRole("Expression Support"),
    hairstyle_grooming_locks: pickRole("Hairstyle/Grooming Lock"),
    tattoo_body_locks: pickRole("Tattoo/Body Lock"),
    ambiguous_identity: hasAmbiguity,
  };
}

function sceneHaystack(parsed: PrepareGenerationInput): string {
  return foldText(
    `${parsed.project} ${parsed.scene} ${parsed.user_instruction}`
  );
}

function sceneAnchors(
  snapshot: GenerationContextSnapshot,
  role: string,
  parsed: PrepareGenerationInput
): VisualAnchor[] {
  const haystack = sceneHaystack(parsed);
  const project = foldText(parsed.project.trim());
  // P0 FIX: scope matching. Asset role MUST match the requested dimension.
  // Identity Anchors CANNOT satisfy location/room/environment requests,
  // even if the name contains "SalaTV" or matches the scene text.
  // This enforces the principle: asset scope must match authority dimension.
  const forbiddenRoles = ["Identity Anchor", "Couple Relationship Anchor"];
  return collectRecords(snapshot)
    .filter(({ record }) => isUsableStatus(record) && !isRejectedStatus(record))
    .filter(({ record }) => classifyRole(record) === role)
    // ENFORCE role matching first: if requesting Room Anchor, reject everything else.
    // Do NOT allow name-match to override role classification.
    .filter(({ record }) => !forbiddenRoles.includes(classifyRole(record)))
    .filter(({ record }) => {
      const recordProject = foldText(field(record, "project"));
      if (recordProject && project && recordProject === project) return true;
      const labels = [
        field(record, "file_name", "Asset", "name"),
        field(record, "Folder", "folder", "scene", "notes", "Notes"),
        field(record, "asset_id"),
      ].join(" ");
      return nameTokens(labels).some(
        (token) => token.length >= 5 && haystack.includes(token)
      );
    })
    .map(({ record, source }) => toAnchor(record, source));
}

function coupleAnchors(snapshot: GenerationContextSnapshot): VisualAnchor[] {
  const configured = configValue(snapshot.config, "ACTIVE_COUPLE_P0_REGISTER_ID");
  const matches = collectRecords(snapshot)
    .filter(({ record }) => isCoupleRecord(record) && isUsableStatus(record))
    .map(({ record, source }) => toAnchor(record, source, "Couple"));
  if (configured) {
    const configuredRecord = findById(snapshot, configured);
    if (configuredRecord) {
      pushUnique(matches, toAnchor(configuredRecord, "ASSET_REGISTRY", "Couple"));
    }
  }
  return matches;
}

function captureById(
  snapshot: GenerationContextSnapshot,
  captureId: string
): UnknownRecord | undefined {
  return snapshot.captures.find(
    (record) => field(record, "capture_id") === captureId
  );
}

function requestById(
  snapshot: GenerationContextSnapshot,
  requestId: string
): UnknownRecord | undefined {
  return snapshot.requests.find(
    (record) => field(record, "request_id") === requestId
  );
}

function resultById(
  snapshot: GenerationContextSnapshot,
  resultId: string
): UnknownRecord | undefined {
  return snapshot.result_memory.find(
    (record) => field(record, "result_id") === resultId
  );
}

function frozenSourceLabel(source: UnknownRecord): string {
  return (
    field(source, "capture_id") ||
    field(source, "request_id") ||
    field(source, "result_id") ||
    "UNKNOWN"
  );
}

function requestByTrace(
  snapshot: GenerationContextSnapshot,
  traceId: string
): UnknownRecord | undefined {
  return snapshot.requests.find((record) => {
    const notes = field(record, "notes");
    const stored = field(record, "trace_id");
    return stored === traceId || notes.includes(`trace_id=${traceId}`);
  });
}

function describeAnchor(anchor: VisualAnchor | null): string {
  if (!anchor) return "UNRESOLVED";
  const label = [anchor.asset_id, anchor.file_name, anchor.file_id]
    .filter(Boolean)
    .slice(0, 2)
    .join(" / ");
  return `${anchor.role} ${label}`;
}

function buildPrompt(input: {
  parsed: PrepareGenerationInput;
  subjects: string[];
  identity: SubjectIdentityAuthority[];
  relationship: VisualAnchor[];
  detailLocks: VisualAnchor[];
  location: VisualAnchor[];
  composition: VisualAnchor[];
  lighting: VisualAnchor[];
  mood: VisualAnchor[];
  allowed: string[];
  prohibited: string[];
  seriesPolicy: string;
  frozenSource?: UnknownRecord;
  requiredAnchors: VisualAnchor[];
}): string {
  const lines: string[] = [
    IDENTITY_CONTRACT,
    "OUTPUT: exactly one photograph. No collage, split view, grid, diptych, or contact sheet.",
    `SERIES POLICY: ${input.seriesPolicy || "ONE_IMAGE_PER_GENERATION"}.`,
    "Preserve identity before style. Do not invent tattoos, rings, anatomy, or furniture.",
    "",
    "IDENTITY:",
  ];

  for (const authority of input.identity) {
    if (authority.subject === "Mambo") {
      lines.push(
        `- ${authority.subject}: independent identity. Use approved Mambo locks only (${
          describeAnchor(authority.primary_identity_anchor) !== "UNRESOLVED"
            ? describeAnchor(authority.primary_identity_anchor)
            : input.detailLocks
                .filter((lock) => lock.subject === "Mambo")
                .map(describeAnchor)
                .join("; ") || "approved Mambo detail locks"
        }). Never treat Mambo as a generic dog.`
      );
      continue;
    }
    const extras = [
      ...authority.priority_0_refs.map(describeAnchor),
      ...authority.supporting_anchors.map(describeAnchor),
      authority.body_anchor ? describeAnchor(authority.body_anchor) : "",
      ...authority.hairstyle_grooming_locks.map(describeAnchor),
      ...authority.tattoo_body_locks.map(describeAnchor),
    ].filter(Boolean);
    lines.push(
      `- ${authority.subject}: match attached primary ${describeAnchor(
        authority.primary_identity_anchor
      )}. Master Pack ${authority.master_pack_id || "ACTIVE"}. ` +
        `Priority 0 and explicit anchors override contradictory text.` +
        (extras.length ? ` Supporting locks: ${unique(extras).join("; ")}.` : "") +
        " Do not blend this face with any other subject."
    );
  }

  if (input.subjects.includes("David") && input.subjects.includes("Juan")) {
    const couple = input.relationship[0];
    lines.push(
      "",
      "COUPLE: keep two independent identities. " +
        (couple
          ? `${describeAnchor(couple)} controls coexistence, relative scale, interaction, and composition only.`
          : "Use a natural couple relationship.") +
        " Never reconstruct David or Juan faces from Couple References."
    );
  }

  if (input.parsed.mode !== "GENERATE" && input.frozenSource) {
    lines.push(
      "",
      `EDIT BASE: ${frozenSourceLabel(input.frozenSource)} is the frozen source.`,
      "PRESERVE: identity, face, body, wardrobe, pose, background, lighting, and every unmentioned attribute.",
      `CHANGE ONLY: ${input.parsed.user_instruction}`,
      "Do not re-anchor identity from the edited result unless an Identity Anchor promotion already exists."
    );
  } else {
    lines.push(
      "",
      `SCENE: ${input.parsed.scene || input.parsed.user_instruction}`
    );
  }

  if (input.requiredAnchors.length) {
    lines.push(
      "",
      `REQUIRED REFERENCES: ${input.requiredAnchors.map(describeAnchor).join("; ")}. These must be attached and used.`
    );
  }

  const lockLines = [
    ...input.detailLocks.map((lock) => `${lock.subject || "Detail"}: ${describeAnchor(lock)}`),
    ...input.location.map((lock) => describeAnchor(lock)),
    ...input.composition.map((lock) => describeAnchor(lock)),
    ...input.lighting.map((lock) => describeAnchor(lock)),
    ...input.mood.map((lock) => describeAnchor(lock)),
  ];
  if (lockLines.length) {
    lines.push("", `LOCKS: ${unique(lockLines).join("; ")}.`);
  }

  const negatives = unique([
    "face blending",
    "identity mixing",
    "collage / split view / grid",
    "using a generated image as new facial authority",
    "auto identity promotion",
    ...input.prohibited,
  ]);
  lines.push("", `DO NOT: ${negatives.join("; ")}.`);
  if (input.allowed.length) {
    lines.push(`ALLOWED USE: ${input.allowed.join(" | ")}.`);
  }
  return lines.join("\n");
}

export function prepareGenerationPacket(
  parsed: PrepareGenerationInput,
  snapshot: GenerationContextSnapshot,
  traceId: string
): GenerationPacket {
  const subjects = normalizeSubjects(parsed.subjects);
  const identity = subjects.map((subject) =>
    resolveSubjectAuthority(subject, snapshot)
  );
  const relationship =
    subjects.includes("David") && subjects.includes("Juan")
      ? coupleAnchors(snapshot)
      : [];
  const detailLocks = identity.flatMap((item) => [
    ...item.hairstyle_grooming_locks,
    ...item.tattoo_body_locks,
    ...collectRecords(snapshot)
      .filter(({ record }) => classifyRole(record) === "Detail Lock")
      .filter(({ record }) => matchesSubject(record, item.subject))
      .map(({ record, source }) => toAnchor(record, source, item.subject)),
  ]);
  const location = sceneAnchors(snapshot, "Room Anchor", parsed);
  const composition = sceneAnchors(snapshot, "Composition Anchor", parsed);
  const lighting = sceneAnchors(snapshot, "Lighting Anchor", parsed);
  const mood = sceneAnchors(snapshot, "Mood Anchor", parsed);
  const allowed = unique([
    ...identity.flatMap((item) => [
      ...(item.primary_identity_anchor?.allowed_use || []),
      ...item.priority_0_refs.flatMap((anchor) => anchor.allowed_use),
    ]),
    ...detailLocks.flatMap((anchor) => anchor.allowed_use),
  ]);
  const prohibited = unique([
    "face blending",
    "collage",
    "split view",
    "grid",
    "auto identity promotion",
    ...identity.flatMap((item) => [
      ...(item.primary_identity_anchor?.prohibited_use || []),
      ...item.priority_0_refs.flatMap((anchor) => anchor.prohibited_use),
    ]),
  ]);

  const blockers: Blocker[] = [];
  const seriesPolicy = configValue(
    snapshot.config,
    "SERIES_OUTPUT_POLICY",
    "ONE_IMAGE_PER_GENERATION"
  );
  const humanApprovalRequired = truthyFlag(
    configValue(snapshot.config, "HUMAN_APPROVAL_REQUIRED", "TRUE"),
    true
  );

  for (const authority of identity) {
    const verifiedDetail = detailLocks.filter(
      (lock) =>
        lock.subject === authority.subject && isVerifiedFacialAnchor(lock)
    );
    const hasVerifiedIdentity =
      isVerifiedFacialAnchor(authority.primary_identity_anchor) ||
      authority.priority_0_refs.some(isVerifiedFacialAnchor) ||
      (authority.subject === "Mambo" &&
        (verifiedDetail.length > 0 ||
          authority.supporting_anchors.some(isVerifiedFacialAnchor)));
    if (!hasVerifiedIdentity) {
      const unverifiedPrimary = Boolean(authority.primary_identity_anchor);
      blockers.push({
        code: unverifiedPrimary
          ? "UNVERIFIED_IDENTITY_AUTHORITY"
          : "MISSING_IDENTITY_ANCHOR",
        message: unverifiedPrimary
          ? `${authority.subject} identity authority is not VERIFIED_SOURCE and cannot be used.`
          : `${authority.subject} has no resolvable verified Identity Anchor or Priority 0 reference. No reference was invented.`,
      });
    }
    if (
      /priority\s*0/i.test(parsed.user_instruction) &&
      authority.priority_0_refs.length === 0 &&
      authority.subject !== "Mambo"
    ) {
      blockers.push({
        code: "MISSING_PRIORITY_0",
        message: `Priority 0 was requested for ${authority.subject} but no approved Priority 0 reference is resolvable.`,
      });
    }
    const facialFromCouple = [
      authority.primary_identity_anchor,
      ...authority.priority_0_refs,
    ].some((anchor) => anchor?.role === "Couple Relationship Anchor");
    if (facialFromCouple) {
      blockers.push({
        code: "SUBJECT_IDENTITY_MIXING",
        message: `Couple Reference must not replace ${authority.subject}'s individual identity anchors.`,
      });
    }
    const provenanceConflict = [
      authority.primary_identity_anchor,
      ...authority.priority_0_refs,
    ].some(
      (anchor) =>
        anchor &&
        /conflict|needs_review|unknown/i.test(anchor.provenance || "")
    );
    if (provenanceConflict) {
      blockers.push({
        code: "PROVENANCE_CONFLICT",
        message: `${authority.subject} identity authority has unresolved provenance and cannot be used until reviewed.`,
      });
    }
  }

  const requiredIds = extractExplicitIds(
    parsed.user_instruction,
    parsed.required_anchor_ids || []
  );
  const requiredAnchors: VisualAnchor[] = [];
  for (const id of requiredIds) {
    const located = findLocated(snapshot, id);
    if (!located) {
      blockers.push({
        code: "MISSING_REQUIRED_REFERENCE",
        message: `Required reference ${id} does not exist in CONFIG, ASSET_REGISTRY, ASSET_INDEX, or CAPTURES. No reference was invented.`,
      });
      continue;
    }
    const subjects = recordSubjects(located.record);
    pushUnique(
      requiredAnchors,
      toAnchor(located.record, located.source, subjects[0] || undefined)
    );
  }

  let frozenSource: UnknownRecord | undefined;
  if (parsed.mode !== "GENERATE") {
    if (parsed.base_capture_id) {
      frozenSource = captureById(snapshot, parsed.base_capture_id);
      if (!frozenSource) {
        blockers.push({
          code: "INVALID_BASE_CAPTURE",
          message: `base_capture_id ${parsed.base_capture_id} was not found. Edit/regenerate cannot proceed.`,
        });
      }
    }
    if (parsed.parent_request_id) {
      const parent = requestById(snapshot, parsed.parent_request_id);
      if (!parent) {
        blockers.push({
          code: "INVALID_EDIT_SOURCE",
          message: `parent_request_id ${parsed.parent_request_id} was not found. Edit/regenerate cannot proceed.`,
        });
      } else {
        frozenSource = frozenSource || parent;
      }
    }
    if (parsed.source_result_id) {
      const result = resultById(snapshot, parsed.source_result_id);
      if (!result) {
        blockers.push({
          code: "INVALID_EDIT_SOURCE",
          message: `source_result_id ${parsed.source_result_id} was not found. Edit/regenerate cannot proceed.`,
        });
      } else {
        frozenSource = frozenSource || result;
      }
    }
    if (
      !parsed.base_capture_id &&
      !parsed.parent_request_id &&
      !parsed.source_result_id
    ) {
      blockers.push({
        code: "MISSING_EDIT_BASE",
        message: "EDIT/REGENERATE requires a valid base_capture_id, parent_request_id, or source_result_id.",
      });
    }
  }

  // P0 FIX: ambiguous_identity detection is for future use when we have
  // a proper de-duplication strategy for multi-registry scenarios. For now,
  // blockers are generated only by explicit conflict markers in provenance,
  // not by presence of >1 deduplicated verified packs (which may be mirrors).
  for (const authority of identity) {
    const competing = [
      authority.primary_identity_anchor,
      ...authority.priority_0_refs,
    ].filter((anchor): anchor is VisualAnchor => Boolean(anchor));
    // Only block if we have explicit CONFLICT markers in provenance
    const uniqueIds = unique(competing.map((anchor) => anchor.asset_id));
    if (
      uniqueIds.length > 1 &&
      competing.some((anchor) => /conflict/i.test(anchor.provenance || ""))
    ) {
      blockers.push({
        code: "AMBIGUOUS_IDENTITY_AUTHORITY",
        message: `${authority.subject} identity authority has unresolved provenance and cannot be used until reviewed.`,
      });
    }
  }

  const ready = blockers.length === 0;
  const packVersion = unique(
    [
      configValue(snapshot.config, "ACTIVE_PACK_VERSION"),
      ...identity.map((item) => item.master_pack_id),
    ].filter(Boolean)
  ).join(" + ");
  const referenceFiles = [
    ...identity
      .map((item) => item.primary_identity_anchor)
      .filter((anchor): anchor is VisualAnchor =>
        Boolean(anchor && isVerifiedFacialAnchor(anchor))
      ),
    ...identity.flatMap((item) => item.priority_0_refs),
    ...relationship,
    ...detailLocks,
    ...location,
    ...composition,
    ...lighting,
    ...mood,
    ...requiredAnchors,
  ];
  const uniqueRefs: VisualAnchor[] = [];
  for (const anchor of referenceFiles) pushUnique(uniqueRefs, anchor);

  const prompt = ready
    ? buildPrompt({
        parsed,
        subjects,
        identity,
        relationship,
        detailLocks,
        location,
        composition,
        lighting,
        mood,
        allowed,
        prohibited,
        seriesPolicy,
        frozenSource,
        requiredAnchors,
      })
    : "";

  return {
    ok: true,
    ready_to_generate: ready,
    request_id: "",
    trace_id: traceId,
    project: parsed.project,
    subjects,
    mode: parsed.mode,
    generator: parsed.generator || "CHATGPT_IMAGE",
    pack_version: packVersion,
    identity_authority: identity,
    detail_locks: detailLocks,
    location_anchors: location,
    composition_anchors: composition,
    lighting_anchors: lighting,
    mood_anchors: mood,
    relationship_anchors: relationship,
    allowed_use: allowed,
    prohibited_use: prohibited,
    final_generation_prompt: prompt,
    reference_files: uniqueRefs,
    blockers,
    guardrails: {
      auto_identity_promotion: false,
      human_approval_required: humanApprovalRequired,
      series_output_policy: seriesPolicy || "ONE_IMAGE_PER_GENERATION",
    },
    host_handoff: ready
      ? {
          action: "INVOKE_NATIVE_IMAGE_GENERATOR",
          same_turn: true,
          renderer: "HOST_NATIVE",
          note: NATIVE_HANDOFF_NOTE,
        }
      : {
          action: "DO_NOT_INVOKE_GENERATOR",
          same_turn: false,
          renderer: "HOST_NATIVE",
          note: blockers.map((item) => item.message).join(" "),
        },
  };
}

function isSnapshot(value: unknown): value is GenerationContextSnapshot {
  if (!isRecord(value) || !stringValue(value.revision)) return false;
  if (!isRecord(value.config)) return false;
  for (const fieldName of [
    "asset_registry",
    "asset_index",
    "captures",
    "requests",
    "result_memory",
  ] as const) {
    if (
      !Array.isArray(value[fieldName]) ||
      value[fieldName].some((item) => !isRecord(item))
    ) {
      return false;
    }
  }
  const config: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value.config)) {
    config[key] = stringValue(entry);
  }
  value.config = config;
  return true;
}

function requestIdFrom(value: unknown): string {
  if (!isRecord(value)) return "";
  if (isRecord(value.request)) return field(value.request, "request_id");
  return field(value, "request_id");
}

export function createPrepareGenerationHandlers(input: {
  read: BackendReader;
  write: BackendWriter;
}) {
  return {
    async prepareGeneration(
      rawInput: z.input<typeof PrepareGenerationInputSchema>
    ): Promise<SafeResult<GenerationPacket>> {
      const parsed = PrepareGenerationInputSchema.safeParse(rawInput);
      const traceId = createTraceId(
        parsed.success ? parsed.data.trace_id : undefined
      );
      if (!parsed.success) {
        return structuredError(
          "INVALID_ARGUMENT",
          "visual_prepare_generation input is invalid",
          traceId
        );
      }
      try {
        const response = await input.read("generation_context", {
          trace_id: traceId,
        });
        if (!isRecord(response) || !isSnapshot(response.snapshot)) {
          return structuredError(
            "BACKEND_ERROR",
            "Visual generation context is unavailable",
            traceId,
            true
          );
        }
        const packet = prepareGenerationPacket(
          parsed.data,
          response.snapshot,
          traceId
        );
        if (!packet.ready_to_generate) {
          return packet;
        }

        const existing = requestByTrace(response.snapshot, traceId);
        if (existing) {
          return {
            ...packet,
            request_id: field(existing, "request_id"),
          };
        }

        const created = await input.write({
          action: "create_request",
          project: packet.project,
          subjects: packet.subjects,
          prompt: packet.final_generation_prompt,
          scene: parsed.data.scene || parsed.data.user_instruction,
          generator: packet.generator,
          mode: packet.mode,
          pack_version: packet.pack_version,
          // P0 fix: only this call site is allowed to assert
          // READY_TO_GENERATE — it is only reached after
          // packet.ready_to_generate === true above. Direct
          // visual_create_request calls omit `status` and default to
          // REQUEST_CREATED on the Apps Script side.
          status: "READY_TO_GENERATE",
          parent_request_id: parsed.data.parent_request_id,
          source_result_id: parsed.data.source_result_id,
          iteration: parsed.data.iteration,
          trace_id: traceId,
          notes: [
            `trace_id=${traceId}`,
            "prepared_by=visual_prepare_generation",
            parsed.data.base_capture_id
              ? `base_capture_id=${parsed.data.base_capture_id}`
              : "",
          ]
            .filter(Boolean)
            .join("; "),
        });
        const requestId = requestIdFrom(created);
        if (!requestId) {
          return structuredError(
            "BACKEND_ERROR",
            "Traceable request could not be created",
            traceId,
            true
          );
        }
        return {
          ...packet,
          request_id: requestId,
        };
      } catch {
        return structuredError(
          "BACKEND_ERROR",
          "Visual generation preparation failed",
          traceId,
          true
        );
      }
    },
  };
}
