import type {
  GenerationPacket,
  VisualAnchor,
} from "./prepare-generation-tools.js";

type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export type DeliveredReference = {
  asset_id: string;
  file_id: string;
  subject?: string;
  role: string;
  mime_type: string;
  bytes: number;
  data: string;
};

export type GenerationPacketWithDelivery = GenerationPacket & {
  reference_delivery: {
    status: "ATTACHED" | "BLOCKED";
    count: number;
    max_count: number;
    attached: Array<{
      asset_id: string;
      file_id: string;
      subject?: string;
      role: string;
      mime_type: string;
      bytes: number;
    }>;
  };
};

const QUALITY_MAX_REFERENCES = 6;
// Economy is the default chat path. Send only the minimum primary identity
// set: optional locks can make MCP responses several megabytes and exhaust the
// host tool budget before native generation starts. QUALITY remains opt-in.
const ECONOMY_MAX_REFERENCES = 0;
const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
const QUALITY_MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const ECONOMY_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export type ReferenceDeliveryMode = "ECONOMY" | "QUALITY";

function primaryIds(packet: GenerationPacket): Set<string> {
  return new Set(
    packet.identity_authority
      .map((authority) => authority.primary_identity_anchor?.file_id || "")
      .filter(Boolean)
  );
}

export function selectGenerationReferences(
  packet: GenerationPacket,
  mode: ReferenceDeliveryMode = "ECONOMY"
): VisualAnchor[] {
  const primary = packet.identity_authority
    .map((authority) => authority.primary_identity_anchor)
    .filter((anchor): anchor is VisualAnchor => Boolean(anchor?.file_id));
  const ordered = [
    ...primary,
    ...packet.reference_files.filter(
      (anchor) =>
        anchor.verification_status === "VERIFIED_SOURCE" && Boolean(anchor.file_id)
    ),
  ];
  const selected: VisualAnchor[] = [];
  const seen = new Set<string>();
  const minimumForPrimary = primaryIds(packet).size;
  const configuredMaximum =
    mode === "QUALITY" ? QUALITY_MAX_REFERENCES : ECONOMY_MAX_REFERENCES;
  const maxReferences = Math.max(minimumForPrimary, configuredMaximum);
  for (const anchor of ordered) {
    const fileId = anchor.file_id || "";
    if (!fileId || seen.has(fileId)) continue;
    selected.push(anchor);
    seen.add(fileId);
    if (selected.length === maxReferences) break;
  }
  return selected;
}

function driveDownloadUrl(fileId: string): string {
  const url = new URL("https://drive.google.com/uc");
  url.searchParams.set("export", "download");
  url.searchParams.set("id", fileId);
  return url.toString();
}

async function downloadReference(
  anchor: VisualAnchor,
  fetchImpl: FetchLike
): Promise<DeliveredReference | null> {
  const fileId = anchor.file_id || "";
  if (!fileId) return null;
  const response = await fetchImpl(driveDownloadUrl(fileId), {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  const mimeType = (response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!response.ok || !mimeType.startsWith("image/")) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_REFERENCE_BYTES) return null;
  return {
    asset_id: anchor.asset_id,
    file_id: fileId,
    subject: anchor.subject,
    role: anchor.role,
    mime_type: mimeType,
    bytes: bytes.length,
    data: bytes.toString("base64"),
  };
}

export async function deliverGenerationReferences(
  packet: GenerationPacket,
  fetchImpl: FetchLike = fetch,
  mode: ReferenceDeliveryMode = "ECONOMY"
): Promise<{
  packet: GenerationPacketWithDelivery;
  images: DeliveredReference[];
}> {
  const maxReferences = Math.max(
    primaryIds(packet).size,
    mode === "QUALITY" ? QUALITY_MAX_REFERENCES : ECONOMY_MAX_REFERENCES
  );
  const maxTotalBytes =
    mode === "QUALITY" ? QUALITY_MAX_TOTAL_BYTES : ECONOMY_MAX_TOTAL_BYTES;
  if (!packet.ready_to_generate) {
    return {
      packet: {
        ...packet,
        reference_delivery: {
          status: "BLOCKED",
          count: 0,
          max_count: maxReferences,
          attached: [],
        },
      },
      images: [],
    };
  }

  const selected = selectGenerationReferences(packet, mode);
  const attempts = await Promise.all(
    selected.map(async (anchor) => {
      try {
        return await downloadReference(anchor, fetchImpl);
      } catch {
        return null;
      }
    })
  );
  const images: DeliveredReference[] = [];
  let totalBytes = 0;
  for (const delivered of attempts) {
    if (!delivered) continue;
    if (totalBytes + delivered.bytes > maxTotalBytes) continue;
    images.push(delivered);
    totalBytes += delivered.bytes;
  }

  const attachedIds = new Set(images.map((image) => image.file_id));
  const missingPrimary = [...primaryIds(packet)].filter(
    (fileId) => !attachedIds.has(fileId)
  );
  const blocked = missingPrimary.length > 0;
  const attached = images.map(({ data: _data, ...metadata }) => metadata);
  const nextPacket: GenerationPacketWithDelivery = {
    ...packet,
    ...(blocked
      ? {
          ready_to_generate: false,
          final_generation_prompt: "",
          blockers: [
            ...packet.blockers,
            {
              code: "MISSING_REQUIRED_REFERENCE" as const,
              message:
                "One or more primary identity references could not be physically attached to the host image generator.",
            },
          ],
          host_handoff: {
            action: "DO_NOT_INVOKE_GENERATOR" as const,
            same_turn: false,
            renderer: "HOST_NATIVE" as const,
            note:
              "Primary identity reference delivery failed. Do not invoke image generation with URL-only references.",
          },
        }
      : {}),
    ...(!blocked
      ? {
          host_handoff: {
            action: "INVOKE_NATIVE_IMAGE_GENERATOR" as const,
            same_turn: true,
            renderer: "HOST_NATIVE" as const,
            note:
              "Invoke the host native image generator now with final_generation_prompt and the MCP image content attached to this tool result. Return exactly one bitmap; do not stop at READY_TO_GENERATE.",
          },
        }
      : {}),
    reference_delivery: {
      status: blocked ? "BLOCKED" : "ATTACHED",
      count: images.length,
      max_count: maxReferences,
      attached,
    },
  };

  return { packet: nextPacket, images: blocked ? [] : images };
}
