import { createHash } from "node:crypto";
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

// QUALITY (default) adds verified extra face angles, shared round-robin across
// subjects, up to QUALITY_MAX_REFERENCES and MAX_TOTAL_BYTES: one Primary per
// subject is not enough for the host generator to hold identity. ECONOMY sends
// only the mandatory set (each subject's Primary, one matched location and
// explicitly required references) when a smaller response is needed.
const QUALITY_MAX_REFERENCES = 6;
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
  requiredIds: string[]
): { selected: VisualAnchor[]; unresolvedRequiredIds: string[] } {
  const selected: VisualAnchor[] = [];
  const seen = new Set<string>();
  const add = (anchor: VisualAnchor | null | undefined) => {
    if (!anchor?.file_id || seen.has(anchor.file_id)) return;
    seen.add(anchor.file_id);
    selected.push(anchor);
  };

  packet.identity_authority.forEach((authority) =>
    add(authority.primary_identity_anchor)
  );
  // A matched location is part of what the scene must reproduce, so attach
  // one approved Room Anchor even in ECONOMY instead of relying on text.
  add(packet.location_anchors?.[0]);

  const unresolvedRequiredIds: string[] = [];
  for (const id of requiredIds) {
    const anchor = packet.reference_files.find(
      (candidate) => candidate.file_id === id || candidate.asset_id === id
    );
    if (!anchor?.file_id) {
      unresolvedRequiredIds.push(id);
      continue;
    }
    add(anchor);
  }

  return { selected, unresolvedRequiredIds };
}

function selectOptionalReferences(
  packet: GenerationPacket,
  mandatory: VisualAnchor[],
  mode: ReferenceDeliveryMode
): VisualAnchor[] {
  if (mode !== "QUALITY") return [];
  const seen = new Set(mandatory.map((anchor) => anchor.file_id));
  const optional: VisualAnchor[] = [];
  const take = (anchor: VisualAnchor | undefined): boolean => {
    if (mandatory.length + optional.length >= QUALITY_MAX_REFERENCES) return false;
    if (!anchor?.file_id || seen.has(anchor.file_id)) return true;
    if (anchor.verification_status !== "VERIFIED_SOURCE") return true;
    seen.add(anchor.file_id);
    optional.push(anchor);
    return true;
  };

  // Extra face angles are shared round-robin across subjects, so one subject
  // with many approved P0 references cannot crowd out the others.
  const queues = packet.identity_authority.map((authority) => [
    ...(authority.priority_0_refs || []),
  ]);
  let added = true;
  while (added) {
    added = false;
    for (const queue of queues) {
      while (queue.length) {
        const anchor = queue.shift()!;
        const before = optional.length;
        if (!take(anchor)) return optional;
        if (optional.length > before) {
          added = true;
          break;
        }
      }
    }
  }

  for (const anchor of packet.reference_files) {
    if (!take(anchor)) break;
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
  const { selected, unresolvedRequiredIds } = selectReferences(packet, [
    ...new Set([...requiredIds, ...(packet.required_reference_ids || [])]),
  ]);
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
