import { createHash } from "node:crypto";
import sharp from "sharp";
import type { GenerationPacket, VisualAnchor } from "./prepare-generation-tools.js";
import { selectDeliveryAnchors } from "./reference-selection.js";

type ReferenceImage = {
  file_id: string;
  mime_type: string;
  data_base64: string;
  bytes: number;
  mandatory: boolean;
};

type ReferenceLoader = (fileId: string) => Promise<unknown>;

export type ReferenceDeliveryMode = "ECONOMY" | "QUALITY";

// Selection is role-based (reference-selection.ts). ECONOMY (default) sends
// each subject's Primary plus explicitly required references. QUALITY, only
// when credit_mode asks for it, adds one complementary face angle per person,
// a scene-matched location and a couple or body reference, capped at
// DELIVERY_CAP. Primaries and required references are mandatory; the
// role-based extras are optional and are skipped, not blocking, if they fail.
const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES: Record<ReferenceDeliveryMode, number> = {
  ECONOMY: 8 * 1024 * 1024,
  QUALITY: 15 * 1024 * 1024,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectReferences(
  packet: GenerationPacket,
  requiredIds: string[],
  mode: ReferenceDeliveryMode
): {
  selected: VisualAnchor[];
  optional: VisualAnchor[];
  unresolvedRequiredIds: string[];
} {
  const { selected: chosen, unresolvedRequiredIds } = selectDeliveryAnchors(
    { ...packet, credit_mode: mode },
    requiredIds
  );
  const mandatoryIds = new Set<string>();
  packet.identity_authority.forEach((authority) => {
    const id = authority.primary_identity_anchor?.file_id;
    if (id) mandatoryIds.add(id);
  });
  for (const anchor of chosen) {
    if (requiredIds.includes(anchor.file_id!) || requiredIds.includes(anchor.asset_id)) {
      mandatoryIds.add(anchor.file_id!);
    }
  }
  return {
    selected: chosen.filter((anchor) => mandatoryIds.has(anchor.file_id!)),
    optional: chosen.filter((anchor) => !mandatoryIds.has(anchor.file_id!)),
    unresolvedRequiredIds,
  };
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
    return await downscaleReference(loaded.mime_type, loaded.data_base64);
  } catch {
    return null;
  }
}

// Original P0 files are ~2 MB PNGs. ChatGPT abandons tool results above
// ~8 MiB ("MCP request timed out"), and every working response on
// 2026-10-12/13 was <= 7.4 MB, so references are re-encoded to a bounded
// JPEG. 1536 px on the long edge keeps facial detail for the generator.
// If re-encoding fails or does not shrink the file, the original is sent.
const REFERENCE_MAX_EDGE = 1536;
const REFERENCE_JPEG_QUALITY = 88;

async function downscaleReference(
  mimeType: string,
  dataBase64: string
): Promise<{ mime_type: string; data_base64: string; bytes: number }> {
  const original = {
    mime_type: mimeType,
    data_base64: dataBase64,
    bytes: decodedBytes(dataBase64),
  };
  try {
    const output = await sharp(Buffer.from(dataBase64, "base64"))
      .rotate()
      .resize({
        width: REFERENCE_MAX_EDGE,
        height: REFERENCE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: REFERENCE_JPEG_QUALITY })
      .toBuffer();
    if (output.length >= original.bytes) return original;
    return {
      mime_type: "image/jpeg",
      data_base64: output.toString("base64"),
      bytes: output.length,
    };
  } catch {
    return original;
  }
}

export function resolveDeliveryMode(
  requested?: ReferenceDeliveryMode
): ReferenceDeliveryMode {
  return requested || "ECONOMY";
}

export async function generationToolResult(
  value: unknown,
  requiredIds: string[],
  loadReference: ReferenceLoader,
  requestedMode?: ReferenceDeliveryMode
) {
  if (!isRecord(value) || value.ok !== true || value.ready_to_generate !== true) {
    return {
      content: [textContent(value)],
      structuredContent: isRecord(value) ? value : { value },
    };
  }

  const packet = value as GenerationPacket;
  const mode = resolveDeliveryMode(requestedMode || packet.credit_mode);
  const { selected, optional, unresolvedRequiredIds } = selectReferences(
    packet,
    [...new Set([...requiredIds, ...(packet.required_reference_ids || [])])],
    mode
  );
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

  if (
    selected.length === 0 ||
    unresolvedRequiredIds.length > 0 ||
    failed.length > 0 ||
    mandatoryAttached.length !== selected.length
  ) {
    const missing = [
      ...unresolvedRequiredIds,
      ...failed,
      ...(selected.length === 0 ? ["PRIMARY_IDENTITY_REFERENCE"] : []),
    ];
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
      manifest: images.map((image, index) => ({
        file_id: image.file_id,
        content_index: index + 1,
        mime_type: image.mime_type,
        byte_length: Buffer.from(image.data_base64, "base64").length,
        sha256: createHash("sha256").update(Buffer.from(image.data_base64, "base64")).digest("hex"),
      })),
      generator_consumption: "NOT_VERIFIED" as const,
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
