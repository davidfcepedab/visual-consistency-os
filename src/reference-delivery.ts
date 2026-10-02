import type { GenerationPacket, VisualAnchor } from "./prepare-generation-tools.js";

type ReferenceImage = {
  file_id: string;
  mime_type: string;
  data_base64: string;
  bytes: number;
  mandatory: boolean;
};

type ReferenceLoader = (fileId: string) => Promise<unknown>;

export type ReferenceDeliveryMode = "ECONOMY" | "QUALITY";

// ECONOMY (default) sends only the mandatory set: the primary identity anchor
// of every subject plus explicitly required references. Optional references
// can make MCP responses several megabytes and exhaust the host tool budget
// before native generation starts, so extra verified references are opt-in
// through QUALITY.
const QUALITY_MAX_REFERENCES = 6;
const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES: Record<ReferenceDeliveryMode, number> = {
  ECONOMY: 8 * 1024 * 1024,
  QUALITY: 15 * 1024 * 1024,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectReferences(packet: GenerationPacket, requiredIds: string[]): VisualAnchor[] {
  const selected: VisualAnchor[] = [];
  const seen = new Set<string>();
  const add = (anchor: VisualAnchor | null | undefined) => {
    if (!anchor?.file_id || seen.has(anchor.file_id)) return;
    seen.add(anchor.file_id);
    selected.push(anchor);
  };
  packet.identity_authority.forEach((authority) => add(authority.primary_identity_anchor));
  requiredIds.forEach((id) => add(packet.reference_files.find((anchor) => anchor.file_id === id)));
  return selected;
}

function selectOptionalReferences(
  packet: GenerationPacket,
  mandatory: VisualAnchor[],
  mode: ReferenceDeliveryMode
): VisualAnchor[] {
  if (mode !== "QUALITY") return [];
  const seen = new Set(mandatory.map((anchor) => anchor.file_id));
  const optional: VisualAnchor[] = [];
  for (const anchor of packet.reference_files) {
    if (mandatory.length + optional.length >= QUALITY_MAX_REFERENCES) break;
    if (!anchor.file_id || seen.has(anchor.file_id)) continue;
    if (anchor.verification_status !== "VERIFIED_SOURCE") continue;
    seen.add(anchor.file_id);
    optional.push(anchor);
  }
  return optional;
}

function decodedBytes(dataBase64: string): number {
  const padding = dataBase64.endsWith("==") ? 2 : dataBase64.endsWith("=") ? 1 : 0;
  return Math.floor((dataBase64.length * 3) / 4) - padding;
}

function textContent(value: unknown) {
  return { type: "text" as const, text: JSON.stringify(value, null, 2) };
}

async function loadImage(
  anchor: VisualAnchor,
  loadReference: ReferenceLoader
): Promise<{ mime_type: string; data_base64: string; bytes: number } | null> {
  try {
    const loaded = await loadReference(anchor.file_id!);
    if (
      !isRecord(loaded) || loaded.ok !== true ||
      typeof loaded.mime_type !== "string" || !loaded.mime_type.startsWith("image/") ||
      typeof loaded.data_base64 !== "string" || loaded.data_base64.length === 0
    ) {
      return null;
    }
    return {
      mime_type: loaded.mime_type,
      data_base64: loaded.data_base64,
      bytes: decodedBytes(loaded.data_base64),
    };
  } catch {
    return null;
  }
}

export async function generationToolResult(
  value: unknown,
  requiredIds: string[],
  loadReference: ReferenceLoader,
  mode: ReferenceDeliveryMode = "ECONOMY"
) {
  if (!isRecord(value) || value.ok !== true || value.ready_to_generate !== true) {
    return {
      content: [textContent(value)],
      structuredContent: isRecord(value) ? value : { value },
    };
  }

  const packet = value as GenerationPacket;
  const selected = selectReferences(packet, requiredIds);
  const optional = selectOptionalReferences(packet, selected, mode);
  const maxTotalBytes = MAX_TOTAL_BYTES[mode];
  const images: ReferenceImage[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;

  for (const anchor of selected) {
    const loaded = await loadImage(anchor, loadReference);
    if (
      !loaded ||
      loaded.bytes > MAX_REFERENCE_BYTES ||
      totalBytes + loaded.bytes > maxTotalBytes
    ) {
      failed.push(anchor.file_id!);
      continue;
    }
    totalBytes += loaded.bytes;
    images.push({ file_id: anchor.file_id!, ...loaded, mandatory: true });
  }

  for (const anchor of optional) {
    const loaded = await loadImage(anchor, loadReference);
    if (
      !loaded ||
      loaded.bytes > MAX_REFERENCE_BYTES ||
      totalBytes + loaded.bytes > maxTotalBytes
    ) {
      skipped.push(anchor.file_id!);
      continue;
    }
    totalBytes += loaded.bytes;
    images.push({ file_id: anchor.file_id!, ...loaded, mandatory: false });
  }

  const mandatoryAttached = images.filter((image) => image.mandatory);
  const deliveryBase = {
    mode,
    count: images.length,
    required_count: selected.length,
    attached: images.map((image) => image.file_id),
    optional_attached: images.filter((image) => !image.mandatory).map((image) => image.file_id),
    skipped,
    total_bytes: totalBytes,
    max_total_bytes: maxTotalBytes,
  };

  if (selected.length === 0 || failed.length > 0 || mandatoryAttached.length !== selected.length) {
    const missing = failed.length ? failed : ["PRIMARY_IDENTITY_REFERENCE"];
    const blocked = {
      ...packet,
      ready_to_generate: false,
      final_generation_prompt: "",
      blockers: [
        ...packet.blockers,
        {
          code: "MISSING_REQUIRED_REFERENCE" as const,
          message: `Physical reference delivery failed for: ${missing.join(", ")}.`,
        },
      ],
      reference_delivery: {
        status: "BLOCKED" as const,
        ...deliveryBase,
        count: mandatoryAttached.length,
        attached: mandatoryAttached.map((image) => image.file_id),
        optional_attached: [] as string[],
        failed,
      },
      host_handoff: {
        action: "DO_NOT_INVOKE_GENERATOR" as const,
        same_turn: false,
        renderer: "HOST_NATIVE" as const,
        note: "Mandatory reference bitmaps were not fully attached.",
      },
    };
    return { content: [textContent(blocked)], structuredContent: blocked };
  }

  const delivered = {
    ...packet,
    reference_delivery: {
      status: "ATTACHED" as const,
      ...deliveryBase,
      failed: [] as string[],
    },
  };
  return {
    content: [
      textContent(delivered),
      ...images.map((image) => ({
        type: "image" as const,
        data: image.data_base64,
        mimeType: image.mime_type,
      })),
    ],
    structuredContent: delivered,
  };
}
