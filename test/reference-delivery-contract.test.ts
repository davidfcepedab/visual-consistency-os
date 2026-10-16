import assert from "node:assert/strict";
import test from "node:test";

import { generationToolResult } from "../src/reference-delivery.js";
import { selectDeliveryAnchors } from "../src/reference-selection.js";
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

function face(fileId: string, name: string, subject: string): VisualAnchor {
  return {
    asset_id: `AST-${fileId}`,
    subject,
    role: "Identity Anchor",
    file_id: fileId,
    file_name: name,
    allowed_use: [],
    prohibited_use: [],
    source: "ASSET_INDEX",
    verification_status: "VERIFIED_SOURCE",
  };
}

test("QUALITY selects one complementary angle per person and skips glasses and a second frontal", () => {
  const davidPrimary = face("DAVID-PRIMARY", "David | P0-01 | Primary cara frontal | 025.png", "David");
  const davidFront = face("DAVID-FRONT-2", "David | P0-02 | Cara frontal close hoodie | 019.png", "David");
  const davidQuarter = face("DAVID-QUARTER", "David | P0-07 | Cara tres cuartos terraza | 041.png", "David");
  const juanPrimary = face("JUAN-PRIMARY", "Juan | P0-01 | Primary cuerpo sentado tank negra | 011.png", "Juan");
  const juanGlasses = face("JUAN-GLASSES", "Juan | P0-07 | Cara tres cuartos lentes hoodie navy | 010.png", "Juan");
  const juanSmile = face("JUAN-SMILE", "Juan | P0-02 | Cara sonrisa tank negra | 004.jpg", "Juan");
  const room = face("ROOM-BOGOTA", "BOGOTA_WINDOW_ROOM.png", "");
  room.role = "Room Anchor";
  const couple = face("COUPLE", "Couple | P0-01 | PRIMARY pareja sofa.png", "Couple");
  couple.role = "Couple Relationship Anchor";
  const base = packet();
  const quality: GenerationPacket = {
    ...base,
    subjects: ["David", "Juan"],
    credit_mode: "QUALITY",
    scene_text: "David y Juan juntos en Bogotá, sonrisa leve",
    identity_authority: [
      {
        subject: "David",
        master_pack_id: "PACK-1",
        primary_identity_anchor: davidPrimary,
        priority_0_refs: [davidPrimary, davidFront, davidQuarter],
        supporting_anchors: [],
        body_anchor: null,
        expression_support: [],
        hairstyle_grooming_locks: [],
        tattoo_body_locks: [],
      },
      {
        subject: "Juan",
        master_pack_id: "PACK-2",
        primary_identity_anchor: juanPrimary,
        priority_0_refs: [juanPrimary, juanGlasses, juanSmile],
        supporting_anchors: [],
        body_anchor: null,
        expression_support: [],
        hairstyle_grooming_locks: [],
        tattoo_body_locks: [],
      },
    ],
    location_anchors: [room],
    relationship_anchors: [couple],
    reference_files: [davidPrimary, davidFront, davidQuarter, juanPrimary, juanGlasses, juanSmile, room, couple],
  };
  const { selected } = selectDeliveryAnchors(quality, []);
  assert.deepEqual(selected.map((item) => item.file_id), [
    "DAVID-PRIMARY",
    "JUAN-PRIMARY",
    "DAVID-QUARTER",
    "JUAN-SMILE",
    "ROOM-BOGOTA",
    "COUPLE",
  ]);
});

test("ECONOMY stays on primaries even when extra P0 and a room exist", () => {
  const davidPrimary = face("DAVID-PRIMARY", "David frontal.png", "David");
  const davidQuarter = face("DAVID-QUARTER", "David tres cuartos.png", "David");
  const base = packet();
  const economy: GenerationPacket = {
    ...base,
    credit_mode: "ECONOMY",
    scene_text: "playa",
    identity_authority: [{
      subject: "David",
      master_pack_id: "PACK-1",
      primary_identity_anchor: davidPrimary,
      priority_0_refs: [davidPrimary, davidQuarter],
      supporting_anchors: [],
      body_anchor: null,
      expression_support: [],
      hairstyle_grooming_locks: [],
      tattoo_body_locks: [],
    }],
    location_anchors: [{ ...face("ROOM", "PLAYA_ROOM.png", ""), role: "Room Anchor" }],
  };
  const { selected } = selectDeliveryAnchors(economy, []);
  assert.deepEqual(selected.map((item) => item.file_id), ["DAVID-PRIMARY"]);
});

test("three subjects keep one primary each and do not add complements", () => {
  const base = packet();
  const subjects = ["David", "Juan", "Mambo"].map((subject) => {
    const primary = face(`${subject}-PRIMARY`, `${subject} frontal.png`, subject);
    return {
      subject,
      master_pack_id: "PACK",
      primary_identity_anchor: primary,
      priority_0_refs: [primary, face(`${subject}-QUARTER`, `${subject} tres cuartos.png`, subject)],
      supporting_anchors: [],
      body_anchor: null,
      expression_support: [],
      hairstyle_grooming_locks: [],
      tattoo_body_locks: [],
    };
  });
  const { selected } = selectDeliveryAnchors({
    ...base,
    subjects: ["David", "Juan", "Mambo"],
    credit_mode: "QUALITY",
    scene_text: "familia en la sala",
    identity_authority: subjects,
  }, []);
  assert.deepEqual(selected.map((item) => item.file_id), [
    "David-PRIMARY",
    "Juan-PRIMARY",
    "Mambo-PRIMARY",
  ]);
});
