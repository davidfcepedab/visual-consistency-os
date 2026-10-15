import assert from "node:assert/strict";
import test from "node:test";

import { generationToolResult, resolveDeliveryMode } from "../src/reference-delivery.js";
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


test("accepts required asset_id and attaches its physical file", async () => {
  const p = packet();
  const required = p.reference_files.find(
    (item) => item.file_id === "FILE-REQUIRED-013"
  )!;
  const result = await generationToolResult(
    p,
    [required.asset_id],
    async (fileId) => ({
      ok: true,
      file_id: fileId,
      mime_type: "image/png",
      data_base64: "aW1hZ2U=",
    })
  );
  const structured = result.structuredContent as Record<string, any>;
  assert.equal(structured.reference_delivery.status, "ATTACHED");
  assert.deepEqual(structured.reference_delivery.attached.sort(), [
    "FILE-PRIMARY-001",
    "FILE-REQUIRED-013",
  ]);
});

test("blocks when an explicitly required id cannot resolve to a physical reference", async () => {
  const result = await generationToolResult(
    packet(),
    ["AST-NOT-IN-PACKET"],
    async (fileId) => ({
      ok: true,
      file_id: fileId,
      mime_type: "image/png",
      data_base64: "aW1hZ2U=",
    })
  );
  const structured = result.structuredContent as Record<string, any>;
  assert.equal(structured.ready_to_generate, false);
  assert.equal(structured.reference_delivery.status, "BLOCKED");
  assert.ok(
    structured.blockers.some((item: Record<string, any>) =>
      String(item.message).includes("AST-NOT-IN-PACKET")
    )
  );
});

test("QUALITY shares extra face references across subjects and attaches the location", async () => {
  const base = packet();
  const david = base.identity_authority[0];
  const juanPrimary = { ...anchor("FILE-JUAN-P01"), subject: "Juan" };
  const davidRefs = ["FILE-D2", "FILE-D3", "FILE-D4", "FILE-D5", "FILE-D6"].map(anchor);
  const juanRefs = ["FILE-J2", "FILE-J6"].map((id) => ({ ...anchor(id), subject: "Juan" }));
  const room = { ...anchor("FILE-RIC-ROOM"), role: "Room Anchor", subject: "" };
  const value: GenerationPacket = {
    ...base,
    subjects: ["David", "Juan"],
    identity_authority: [
      { ...david, priority_0_refs: [david.primary_identity_anchor!, ...davidRefs] },
      { ...david, subject: "Juan", primary_identity_anchor: juanPrimary,
        priority_0_refs: [juanPrimary, ...juanRefs] },
    ],
    location_anchors: [room],
    reference_files: [david.primary_identity_anchor!, juanPrimary, ...davidRefs, ...juanRefs, room],
  };
  const result = await generationToolResult(value, [], async (fileId) => ({
    ok: true, mime_type: "image/png", data_base64: Buffer.from(fileId).toString("base64"),
  }), "QUALITY");
  const attached = (result.structuredContent as { reference_delivery: { attached: string[] } })
    .reference_delivery.attached;
  assert.equal(attached.length, 6);
  for (const id of ["FILE-PRIMARY-001", "FILE-JUAN-P01", "FILE-RIC-ROOM", "FILE-J2", "FILE-D2"]) {
    assert.equal(attached.includes(id), true, `${id} must be attached`);
  }
  assert.equal(attached.filter((id) => id.startsWith("FILE-J")).length >= 2, true);
});

test("without credit_mode every request gets ECONOMY; an explicit mode wins", () => {
  assert.equal(resolveDeliveryMode(), "ECONOMY");
  assert.equal(resolveDeliveryMode("QUALITY"), "QUALITY");
  assert.equal(resolveDeliveryMode("ECONOMY"), "ECONOMY");
});
