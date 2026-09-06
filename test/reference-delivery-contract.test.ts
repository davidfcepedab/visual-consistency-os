import assert from "node:assert/strict";
import test from "node:test";

import { generationToolResult } from "../src/reference-delivery.js";
import type { GenerationPacket, VisualAnchor } from "../src/prepare-generation-tools.js";

function anchor(fileId: string): VisualAnchor {
  return {
    asset_id: `AST-${fileId}`,
    subject: "David",
    role: "Identity Anchor",
    file_id: fileId,
    allowed_use: [],
    prohibited_use: [],
    source: "ASSET_INDEX",
    verification_status: "VERIFIED_SOURCE",
  };
}

function packet(): GenerationPacket {
  const primary = anchor("FILE-PRIMARY-001");
  const required = anchor("FILE-REQUIRED-013");
  return {
    ok: true, ready_to_generate: true, request_id: "REQ-1", trace_id: "TRACE-1",
    project: "TEST", subjects: ["David"], mode: "GENERATE", generator: "OPENAI_NATIVE",
    pack_version: "PACK-1",
    identity_authority: [{ subject: "David", master_pack_id: "PACK-1", primary_identity_anchor: primary,
      priority_0_refs: [primary], supporting_anchors: [], body_anchor: null, expression_support: [],
      hairstyle_grooming_locks: [], tattoo_body_locks: [] }],
    detail_locks: [], location_anchors: [], composition_anchors: [], lighting_anchors: [],
    mood_anchors: [], relationship_anchors: [], allowed_use: [], prohibited_use: [],
    final_generation_prompt: "Generate one image", reference_files: [primary, required],
    blockers: [], warnings: [], guardrails: { auto_identity_promotion: false,
      human_approval_required: true, series_output_policy: "ONE_IMAGE_PER_GENERATION" },
    host_handoff: { action: "INVOKE_NATIVE_IMAGE_GENERATOR", same_turn: true,
      renderer: "HOST_NATIVE", note: "ready" },
  };
}

test("attaches the primary and every explicitly required reference", async () => {
  const result = await generationToolResult(packet(), ["FILE-REQUIRED-013"], async (fileId) => ({
    ok: true, file_id: fileId, mime_type: "image/png", data_base64: "aW1hZ2U=",
  }));
  const structured = result.structuredContent as Record<string, any>;
  assert.equal(structured.reference_delivery.status, "ATTACHED");
  assert.equal(structured.reference_delivery.count, 2);
  assert.equal(result.content.filter((item) => item.type === "image").length, 2);
});

test("blocks the handoff when any mandatory bitmap cannot be delivered", async () => {
  const result = await generationToolResult(packet(), ["FILE-REQUIRED-013"], async (fileId) =>
    fileId === "FILE-PRIMARY-001"
      ? { ok: true, mime_type: "image/jpeg", data_base64: "aW1hZ2U=" }
      : { ok: false }
  );
  const structured = result.structuredContent as Record<string, any>;
  assert.equal(structured.ready_to_generate, false);
  assert.equal(structured.reference_delivery.status, "BLOCKED");
  assert.equal(structured.host_handoff.action, "DO_NOT_INVOKE_GENERATOR");
  assert.equal(result.content.some((item) => item.type === "image"), false);
});
