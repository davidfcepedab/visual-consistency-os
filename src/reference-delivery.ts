import type { GenerationPacket, VisualAnchor } from "./prepare-generation-tools.js";

type ReferenceImage = {
  file_id: string;
  mime_type: string;
  data_base64: string;
};

type ReferenceLoader = (fileId: string) => Promise<unknown>;

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

function textContent(value: unknown) {
  return { type: "text" as const, text: JSON.stringify(value, null, 2) };
}

export async function generationToolResult(
  value: unknown,
  requiredIds: string[],
  loadReference: ReferenceLoader
) {
  if (!isRecord(value) || value.ok !== true || value.ready_to_generate !== true) {
    return {
      content: [textContent(value)],
      structuredContent: isRecord(value) ? value : { value },
    };
  }

  const packet = value as GenerationPacket;
  const selected = selectReferences(packet, requiredIds);
  const images: ReferenceImage[] = [];
  const failed: string[] = [];
  for (const anchor of selected) {
    try {
      const loaded = await loadReference(anchor.file_id!);
      if (
        !isRecord(loaded) || loaded.ok !== true ||
        typeof loaded.mime_type !== "string" || !loaded.mime_type.startsWith("image/") ||
        typeof loaded.data_base64 !== "string" || loaded.data_base64.length === 0
      ) {
        failed.push(anchor.file_id!);
        continue;
      }
      images.push({
        file_id: anchor.file_id!,
        mime_type: loaded.mime_type,
        data_base64: loaded.data_base64,
      });
    } catch {
      failed.push(anchor.file_id!);
    }
  }

  if (selected.length === 0 || failed.length > 0 || images.length !== selected.length) {
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
        count: images.length,
        required_count: selected.length,
        attached: images.map((image) => image.file_id),
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
      count: images.length,
      required_count: selected.length,
      attached: images.map((image) => image.file_id),
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
