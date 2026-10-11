import assert from "node:assert/strict";
import test from "node:test";

import {
  createPrepareGenerationHandlers,
  prepareGenerationPacket,
  PrepareGenerationInputSchema,
  type GenerationContextSnapshot,
} from "../src/prepare-generation-tools.js";

function row(id: string, status: string, scope: string, allowed: string) {
  return {
    asset_id: `LIB-${id}`,
    subjects: "David",
    approval_scope: scope,
    status,
    source_file_id: id,
    drive_url: `https://drive.google.com/file/d/${id}/view`,
    final_filename: `David | ${status} | ${id}.png`,
    human_anchor_approval: "APPROVED",
    anchor_eligible: "TRUE",
    provenance_state: "APPROVAL_TRACEABLE",
    allowed_use: allowed,
    prohibited_use: "No identity mixing",
  };
}

function snapshot(): GenerationContextSnapshot {
  return {
    revision: "rev-fluid",
    config: { ACTIVE_DAVID_MASTER_PACK_ID: "PACK", HUMAN_APPROVAL_REQUIRED: "TRUE" },
    asset_registry: [
      row("FILE-PRIMARY-025", "PRIORITY_0_PRIMARY", "FACIAL_IDENTITY_PRIMARY", "Facial identity reference"),
      row("FILE-FACE-019", "PRIORITY_0_APPROVED", "FACIAL_IDENTITY_SUPPORT", "Facial identity reference"),
      row("FILE-FACE-011", "PRIORITY_0_APPROVED", "FACIAL_IDENTITY_SUPPORT", "Facial identity reference"),
      row("FILE-FACE-020", "PRIORITY_0_APPROVED", "FACIAL_IDENTITY_SUPPORT", "Facial identity reference"),
      row("FILE-BODY-014", "PRIORITY_0_APPROVED", "BODY_SUPPORT", "Body and tattoo map reference"),
      row("FILE-BODY-027", "PRIORITY_0_APPROVED", "BODY_SUPPORT", "Body proportions only"),
    ],
    asset_index: [],
    captures: [],
    requests: [],
    result_memory: [],
  };
}

function input(extra: Record<string, unknown> = {}) {
  return PrepareGenerationInputSchema.parse({
    project: "fluid",
    subjects: ["David"],
    user_instruction: "retrato en la sala",
    trace_id: "trace-fluid",
    ...extra,
  });
}

test("lean packet keeps primary plus at most two scene references", () => {
  const packet = prepareGenerationPacket(input(), snapshot(), "trace-fluid");
  assert.equal(packet.ready_to_generate, true);
  const david = packet.identity_authority[0];
  assert.equal(david.primary_identity_anchor?.file_id, "FILE-PRIMARY-025");
  assert.ok(david.priority_0_refs.length <= 3);
  assert.equal(david.priority_0_refs[0].file_id, "FILE-PRIMARY-025");
  assert.ok((david.priority_0_total || 0) >= david.priority_0_refs.length);
  assert.equal(packet.scene_profile, "FACE");
  assert.equal(packet.auto_required_file_ids, undefined);
});

test("verbose packet keeps every approved P0", () => {
  const lean = prepareGenerationPacket(input(), snapshot(), "t");
  const full = prepareGenerationPacket(input({ verbose: true }), snapshot(), "t");
  assert.ok(full.identity_authority[0].priority_0_refs.length >= lean.identity_authority[0].priority_0_refs.length);
  assert.ok(full.final_generation_prompt.length >= lean.final_generation_prompt.length);
});

test("body scenes attach body references automatically", () => {
  const packet = prepareGenerationPacket(
    input({ user_instruction: "David caminando en la playa sin camisa" }),
    snapshot(),
    "trace-body"
  );
  assert.equal(packet.scene_profile, "BODY");
  assert.deepEqual(packet.auto_required_file_ids, ["FILE-BODY-014", "FILE-BODY-027"]);
  const files = packet.reference_files.map((anchor) => anchor.file_id);
  assert.ok(files.includes("FILE-BODY-014") && files.includes("FILE-BODY-027"));
});

test("validate_only resolves without creating a request", async () => {
  let writes = 0;
  const handlers = createPrepareGenerationHandlers({
    read: async () => ({ ok: true, snapshot: snapshot() }),
    write: async () => {
      writes += 1;
      return { ok: true, request_id: "REQ-X" };
    },
  });
  const result = await handlers.prepareGeneration({
    project: "fluid",
    subjects: ["David"],
    user_instruction: "retrato",
    validate_only: true,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.ready_to_generate, true);
    assert.equal(result.request_id, "");
    assert.ok(result.warnings.some((w) => w.code === "VALIDATE_ONLY"));
  }
  assert.equal(writes, 0);
});
