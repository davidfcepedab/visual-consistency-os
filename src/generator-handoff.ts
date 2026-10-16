import { createHash } from "node:crypto";

type RecordValue = Record<string, unknown>;
function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Inspect the actual MCP envelope. Never treat reference metadata as bytes. */
export function readGenerationHandoff(result: unknown) {
  if (!isRecord(result) || result.isError === true || !Array.isArray(result.content)) {
    throw new Error("BLOCKED_INVALID_MCP_ENVELOPE");
  }
  const content = result.content;
  let packet: unknown = result.structuredContent;
  if (!isRecord(packet)) {
    const text = content.find(block => isRecord(block) && block.type === "text");
    if (!isRecord(text) || typeof text.text !== "string") throw new Error("BLOCKED_MISSING_GENERATION_PACKET");
    try { packet = JSON.parse(text.text); } catch { throw new Error("BLOCKED_INVALID_GENERATION_PACKET"); }
  }
  if (!isRecord(packet) || packet.ok !== true || packet.ready_to_generate !== true ||
      typeof packet.request_id !== "string" || !packet.request_id ||
      typeof packet.final_generation_prompt !== "string" || !packet.final_generation_prompt.trim() ||
      !isRecord(packet.reference_delivery) || packet.reference_delivery.status !== "ATTACHED" ||
      !Array.isArray(packet.identity_authority) || !packet.identity_authority.length) {
    throw new Error("BLOCKED_GENERATION_GATES");
  }
  const delivery = packet.reference_delivery;
  const ids = delivery.attached;
  const images = content.filter(block => isRecord(block) && block.type === "image");
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== "string" || !id) ||
      new Set(ids).size !== ids.length || ids.length !== images.length ||
      delivery.count !== images.length || !Number.isInteger(delivery.required_count) ||
      Number(delivery.required_count) < 1 || Number(delivery.required_count) > images.length ||
      !Array.isArray(delivery.failed) || delivery.failed.length) {
    throw new Error("BLOCKED_REFERENCE_DELIVERY");
  }
  const optionalIds = delivery.optional_attached === undefined ? [] : delivery.optional_attached;
  if (!Array.isArray(optionalIds) || optionalIds.some(id => typeof id !== "string" || !ids.includes(id)) ||
      new Set(optionalIds).size !== optionalIds.length || delivery.required_count !== ids.length - optionalIds.length) {
    throw new Error("BLOCKED_REFERENCE_DELIVERY");
  }
  for (const authority of packet.identity_authority) {
    if (!isRecord(authority) || !isRecord(authority.primary_identity_anchor) ||
        !ids.includes(authority.primary_identity_anchor.file_id) ||
        optionalIds.includes(authority.primary_identity_anchor.file_id)) {
      throw new Error("BLOCKED_PRIMARY_BITMAP_MISSING");
    }
  }
  const references = images.map((image, index) => {
    if (!isRecord(image) || typeof image.data !== "string" || !image.data ||
        typeof image.mimeType !== "string" || !image.mimeType.startsWith("image/")) {
      throw new Error("BLOCKED_INVALID_IMAGE_BLOCK");
    }
    const bytes = Buffer.from(image.data, "base64");
    if (!bytes.length || bytes.toString("base64") !== image.data.replace(/\s/g, "")) {
      throw new Error("BLOCKED_INVALID_IMAGE_BYTES");
    }
    return {
      source_file_id: ids[index] as string,
      content_index: content.indexOf(image),
      mime_type: image.mimeType,
      byte_length: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      image_block: image,
    };
  });
  if (delivery.manifest !== undefined) {
    if (!Array.isArray(delivery.manifest) || delivery.manifest.length !== references.length ||
        delivery.manifest.some((entry, index) => !isRecord(entry) ||
          entry.file_id !== references[index].source_file_id ||
          entry.sha256 !== references[index].sha256 || entry.byte_length !== references[index].byte_length ||
          entry.mime_type !== references[index].mime_type || entry.content_index !== references[index].content_index)) {
      throw new Error("BLOCKED_REFERENCE_MANIFEST_MISMATCH");
    }
  }
  return {
    request_id: packet.request_id,
    prompt: packet.final_generation_prompt,
    references,
    // The caller must forward image_block to its native generator and record
    // that invocation separately. Delivery alone cannot prove consumption.
    generator_consumption: "NOT_VERIFIED" as const,
  };
}
