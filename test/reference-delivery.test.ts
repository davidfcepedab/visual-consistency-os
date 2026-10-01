import assert from "node:assert/strict";
import test from "node:test";

import {
  deliverGenerationReferences,
  selectGenerationReferences,
} from "../src/reference-delivery.js";
import type { GenerationPacket } from "../src/prepare-generation-tools.js";

function packet(): GenerationPacket {
  const primary = {
    asset_id: "AST-DAVID-P0",
    subject: "David",
    role: "Identity Anchor",
    file_id: "FILE-DAVID-P0",
    status: "PRIORITY_0_PRIMARY",
    allowed_use: [],
    prohibited_use: [],
    source: "ASSET_INDEX" as const,
    verification_status: "VERIFIED_SOURCE" as const,
  };
  return {
    ok: true,
    ready_to_generate: true,
    request_id: "REQ-001",
    trace_id: "trace-001",
    project: "TEST",
    subjects: ["David"],
    mode: "GENERATE",
    generator: "CHATGPT_IMAGE",
    pack_version: "PACK-1",
    identity_authority: [
      {
        subject: "David",
        master_pack_id: "PACK-1",
        primary_identity_anchor: primary,
        priority_0_refs: [primary],
        supporting_anchors: [],
        body_anchor: null,
        expression_support: [],
        hairstyle_grooming_locks: [],
        tattoo_body_locks: [],
      },
    ],
    detail_locks: [],
    location_anchors: [],
    composition_anchors: [],
    lighting_anchors: [],
    mood_anchors: [],
    relationship_anchors: [],
    allowed_use: [],
    prohibited_use: [],
    final_generation_prompt: "Create exactly one photograph.",
    reference_files: [primary],
    blockers: [],
    warnings: [],
    guardrails: {
      auto_identity_promotion: false,
      human_approval_required: true,
      series_output_policy: "ONE_IMAGE_PER_GENERATION",
    },
    host_handoff: {
      action: "INVOKE_NATIVE_IMAGE_GENERATOR",
      same_turn: true,
      renderer: "HOST_NATIVE",
      note: "Invoke native image generation.",
    },
  };
}

test("reference delivery prioritizes primary identity anchors and attaches bytes", async () => {
  const input = packet();
  assert.equal(selectGenerationReferences(input)[0]?.file_id, "FILE-DAVID-P0");
  const result = await deliverGenerationReferences(input, async () =>
    new Response(Buffer.from("image-bytes"), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    })
  );
  assert.equal(result.packet.ready_to_generate, true);
  assert.equal(result.packet.reference_delivery.status, "ATTACHED");
  assert.equal(result.packet.reference_delivery.count, 1);
  assert.match(result.packet.host_handoff.note, /MCP image content attached/);
  assert.equal(result.images[0]?.data, Buffer.from("image-bytes").toString("base64"));
});

test("reference delivery blocks generation when a primary anchor is not an image", async () => {
  const result = await deliverGenerationReferences(packet(), async () =>
    new Response("login", {
      status: 200,
      headers: { "content-type": "text/html" },
    })
  );
  assert.equal(result.packet.ready_to_generate, false);
  assert.equal(result.packet.reference_delivery.status, "BLOCKED");
  assert.equal(result.packet.host_handoff.action, "DO_NOT_INVOKE_GENERATOR");
  assert.equal(result.packet.final_generation_prompt, "");
  assert.equal(result.images.length, 0);
});

test("economy mode sends only primary identity references while quality can send six", () => {
  const input = packet();
  input.reference_files = Array.from({ length: 7 }, (_, index) => ({
    ...input.reference_files[0],
    asset_id: `AST-${index}`,
    file_id: index === 0 ? "FILE-DAVID-P0" : `FILE-${index}`,
  }));
  assert.equal(selectGenerationReferences(input, "ECONOMY").length, 1);
  assert.equal(selectGenerationReferences(input, "QUALITY").length, 6);
});

test("economy mode keeps one primary reference for every subject", () => {
  const input = packet();
  const juanPrimary = {
    ...input.identity_authority[0].primary_identity_anchor!,
    asset_id: "AST-JUAN-P0",
    file_id: "FILE-JUAN-P0",
    subject: "Juan",
  };
  input.identity_authority.push({
    ...input.identity_authority[0],
    subject: "Juan",
    primary_identity_anchor: juanPrimary,
    priority_0_refs: [juanPrimary],
  });
  input.reference_files.push(juanPrimary);
  assert.deepEqual(
    selectGenerationReferences(input, "ECONOMY").map((anchor) => anchor.file_id),
    ["FILE-DAVID-P0", "FILE-JUAN-P0"]
  );
});
