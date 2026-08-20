import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createPrepareGenerationHandlers,
  prepareGenerationPacket,
  type GenerationContextSnapshot,
} from "../src/prepare-generation-tools.js";

function authoritySnapshot(): GenerationContextSnapshot {
  return {
    revision: "generation-rev-1",
    config: {
      ACTIVE_DAVID_MASTER_PACK_ID: "PACK-DAVID-V5",
      ACTIVE_JUAN_MASTER_PACK_ID: "PACK-JUAN-V4",
      ACTIVE_MAMBO_MASTER_PACK_ID: "PACK-MAMBO-V1",
      ACTIVE_COUPLE_P0_REGISTER_ID: "AST-COUPLE-P0",
      AUTO_IDENTITY_PROMOTION: "FALSE",
      HUMAN_APPROVAL_REQUIRED: "TRUE",
      SERIES_OUTPUT_POLICY: "ONE_IMAGE_PER_GENERATION",
      ACTIVE_PACK_VERSION: "DAVID_MASTER_PACK_V5_0",
    },
    asset_registry: [
      {
        asset_id: "AST-DAVID-P0",
        subjects: "David",
        scope: "Identity Anchor",
        status: "ACTIVE",
        source_file_id: "FILE-DAVID-P0",
        drive_url: "https://drive.google.com/file/d/FILE-DAVID-P0/view",
        file_name: "DAVID_PRIORITY_0_IDENTITY.png",
        notes: "Priority 0 approved identity anchor",
        approved_by: "David",
        human_anchor_approval: "APPROVED",
        allowed_use: "identity | portrait",
        prohibited_use: "face blending",
        provenance: "approved-real-reference",
      },
      {
        asset_id: "AST-DAVID-BODY",
        subjects: "David",
        scope: "Body Anchor",
        status: "ACTIVE",
        source_file_id: "FILE-DAVID-BODY",
        file_name: "DAVID_BODY_ANCHOR.png",
        approved_by: "David",
      },
      {
        asset_id: "AST-DAVID-GENERATED",
        subjects: "David",
        scope: "Support",
        status: "ACTIVE",
        notes: "Generated Golden support | Not Identity",
        source_file_id: "FILE-DAVID-GENERATED",
      },
      {
        asset_id: "AST-JUAN-P0",
        subjects: "Juan",
        scope: "Identity Anchor",
        status: "ACTIVE",
        source_file_id: "FILE-JUAN-P0",
        drive_url: "https://drive.google.com/file/d/FILE-JUAN-P0/view",
        file_name: "JUAN_PRIORITY_0_IDENTITY.png",
        notes: "Priority 0 approved identity anchor",
        approved_by: "David",
        human_anchor_approval: "APPROVED",
        provenance: "approved-real-reference",
      },
      {
        asset_id: "AST-COUPLE-P0",
        subjects: "David + Juan",
        scope: "Couple Relationship Anchor",
        status: "ACTIVE",
        source_file_id: "FILE-COUPLE-P0",
        file_name: "COUPLE_PRIORITY_0.png",
        notes: "Priority 0 couple coexistence, scale, and composition only",
        approved_by: "David",
      },
      {
        asset_id: "AST-MAMBO-LOCK",
        subjects: "Mambo",
        scope: "Detail Lock",
        status: "ACTIVE",
        source_file_id: "FILE-MAMBO-LOCK",
        file_name: "MAMBO_DETAIL_LOCK.png",
        notes: "Approved Mambo identity lock",
        approved_by: "David",
      },
      {
        asset_id: "AST-ROOM-BOGOTA",
        subjects: "",
        scope: "Room Anchor",
        status: "ACTIVE",
        source_file_id: "FILE-ROOM-BOGOTA",
        file_name: "BOGOTA_WINDOW_ROOM.png",
      },
      {
        asset_id: "AST-ROOM-MIAMI",
        subjects: "",
        scope: "Room Anchor",
        status: "ACTIVE",
        source_file_id: "FILE-ROOM-MIAMI",
        file_name: "MIAMI_BEACH_ROOM.png",
      },
    ],
    asset_index: [
      {
        Asset: "DAVID_PRIORITY_0_IDENTITY.png",
        "Character / Area": "David",
        Status: "ACTIVE",
        "Drive Link": "https://drive.google.com/file/d/FILE-DAVID-P0/view",
        Folder: "01. Identity Masters | Priority 0",
        Notes: "Priority 0 identity",
      },
    ],
    captures: [
      {
        capture_id: "CAP-001",
        file_id: "FILE-CAP-001",
        identity_subjects: "David",
        project: "TEST-NATIVE-HANDOFF",
        status: "APPROVED",
      },
    ],
    requests: [
      {
        request_id: "REQ-PARENT-001",
        status: "READY_TO_GENERATE",
        project: "TEST-NATIVE-HANDOFF",
        prompt: "Original portrait of David.",
      },
    ],
    result_memory: [
      {
        result_id: "RES-001",
        request_id: "REQ-PARENT-001",
        capture_id: "CAP-001",
      },
    ],
  };
}

function handlersFor(snapshot: GenerationContextSnapshot, writes: Record<string, unknown>[] = []) {
  return createPrepareGenerationHandlers({
    read: async (action) => {
      assert.equal(action, "generation_context");
      return { ok: true, snapshot };
    },
    write: async (payload) => {
      writes.push(payload);
      return {
        ok: true,
        request: { request_id: "REQ-TEST-001", status: "READY_TO_GENERATE" },
      };
    },
  });
}

test("Test A — simple generation hands off to the host native renderer", async () => {
  const writes: Record<string, unknown>[] = [];
  const result = await handlersFor(authoritySnapshot(), writes).prepareGeneration({
    project: "TEST-NATIVE-HANDOFF",
    subjects: ["David"],
    user_instruction: "Create one photorealistic portrait of David by a Bogotá window.",
    generator: "CHATGPT_IMAGE",
    trace_id: "trace-test-a",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ready_to_generate, true);
  assert.equal(result.request_id, "REQ-TEST-001");
  assert.deepEqual(result.subjects, ["David"]);
  const david = result.identity_authority.find((item) => item.subject === "David");
  assert.ok(david);
  assert.equal(david?.master_pack_id, "PACK-DAVID-V5");
  assert.equal(david?.primary_identity_anchor?.asset_id, "AST-DAVID-P0");
  assert.ok((david?.priority_0_refs.length || 0) >= 1);
  assert.ok(result.final_generation_prompt.length > 0);
  assert.match(result.final_generation_prompt, /REFERENCE DEFINES IDENTITY/);
  assert.match(result.final_generation_prompt, /exactly one photograph/i);
  assert.doesNotMatch(
    result.final_generation_prompt,
    /image generator is not enabled|renderer unavailable|cannot generate the image/i
  );
  assert.equal(result.host_handoff.action, "INVOKE_NATIVE_IMAGE_GENERATOR");
  assert.equal(result.host_handoff.same_turn, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.action, "create_request");
  assert.equal(writes[0]?.generator, "CHATGPT_IMAGE");
  assert.equal(writes[0]?.trace_id, "trace-test-a");
  // P0: visual_create_request must never default to READY_TO_GENERATE on
  // its own — only the verified prepare_generation path may assert it.
  assert.equal(writes[0]?.status, "READY_TO_GENERATE");
  assert.equal(
    result.location_anchors.some((anchor) => anchor.asset_id === "AST-ROOM-BOGOTA"),
    true
  );
  assert.equal(
    result.location_anchors.some((anchor) => anchor.asset_id === "AST-ROOM-MIAMI"),
    false
  );
});

test("Test B — couple keeps separate identities and does not face-blend from couple refs", async () => {
  const writes: Record<string, unknown>[] = [];
  const result = await handlersFor(authoritySnapshot(), writes).prepareGeneration({
    project: "TEST-NATIVE-HANDOFF",
    subjects: ["David", "Juan"],
    user_instruction: "Create one photorealistic photo of David and Juan together in Bogotá.",
    generator: "CHATGPT_IMAGE",
    trace_id: "trace-test-b",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ready_to_generate, true);
  assert.deepEqual(result.subjects, ["David", "Juan"]);
  const david = result.identity_authority.find((item) => item.subject === "David");
  const juan = result.identity_authority.find((item) => item.subject === "Juan");
  assert.equal(david?.primary_identity_anchor?.asset_id, "AST-DAVID-P0");
  assert.equal(juan?.primary_identity_anchor?.asset_id, "AST-JUAN-P0");
  assert.notEqual(david?.primary_identity_anchor?.asset_id, juan?.primary_identity_anchor?.asset_id);
  assert.equal(david?.primary_identity_anchor?.role, "Identity Anchor");
  assert.equal(
    result.relationship_anchors.some((anchor) => anchor.asset_id === "AST-COUPLE-P0"),
    true
  );
  assert.equal(
    [...(david?.priority_0_refs || []), david?.primary_identity_anchor]
      .some((anchor) => anchor?.asset_id === "AST-COUPLE-P0"),
    false
  );
  assert.match(result.final_generation_prompt, /Do not blend this face/i);
  assert.match(result.final_generation_prompt, /Never reconstruct David or Juan faces from Couple References/i);
  assert.doesNotMatch(result.final_generation_prompt, /blend David and Juan into one face/i);
  assert.equal(result.host_handoff.action, "INVOKE_NATIVE_IMAGE_GENERATOR");
});

test("David + Mambo resolves independent identities for native handoff", async () => {
  const result = await handlersFor(authoritySnapshot()).prepareGeneration({
    project: "TEST-NATIVE-HANDOFF",
    subjects: ["David", "Mambo"],
    user_instruction: "Genera una foto de David caminando con Mambo en Bogotá",
    generator: "CHATGPT_IMAGE",
    trace_id: "trace-test-mambo",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ready_to_generate, true);
  assert.ok(result.identity_authority.some((item) => item.subject === "David"));
  assert.ok(result.identity_authority.some((item) => item.subject === "Mambo"));
  assert.match(result.final_generation_prompt, /Mambo/);
  assert.match(result.final_generation_prompt, /independent identity/i);
  assert.equal(result.host_handoff.action, "INVOKE_NATIVE_IMAGE_GENERATOR");
});

test("Test C — edit freezes unrequested attributes and changes only the requested one", async () => {
  const result = await handlersFor(authoritySnapshot()).prepareGeneration({
    project: "TEST-NATIVE-HANDOFF",
    subjects: ["David"],
    user_instruction: "Change only David's shirt to a white linen shirt.",
    mode: "EDIT",
    base_capture_id: "CAP-001",
    generator: "CHATGPT_IMAGE",
    trace_id: "trace-test-c",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ready_to_generate, true);
  assert.equal(result.mode, "EDIT");
  assert.match(result.final_generation_prompt, /PRESERVE:/);
  assert.match(result.final_generation_prompt, /CHANGE ONLY:/);
  assert.match(result.final_generation_prompt, /white linen shirt/i);
  assert.match(result.final_generation_prompt, /Do not re-anchor identity/i);
  assert.doesNotMatch(
    result.final_generation_prompt,
    /use the edited image as a new identity anchor/i
  );
});

test("Test D — missing required reference does not invent one or mark ready", async () => {
  const writes: Record<string, unknown>[] = [];
  const result = await handlersFor(authoritySnapshot(), writes).prepareGeneration({
    project: "TEST-NATIVE-HANDOFF",
    subjects: ["David"],
    user_instruction:
      "Create a portrait using Priority 0 identity anchor AST-DOES-NOT-EXIST.",
    required_anchor_ids: ["AST-DOES-NOT-EXIST"],
    generator: "CHATGPT_IMAGE",
    trace_id: "trace-test-d",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ready_to_generate, false);
  assert.equal(result.final_generation_prompt, "");
  assert.ok(
    result.blockers.some((blocker) => blocker.code === "MISSING_REQUIRED_REFERENCE")
  );
  assert.match(result.blockers.map((blocker) => blocker.message).join(" "), /AST-DOES-NOT-EXIST/);
  assert.equal(
    result.identity_authority.some((item) =>
      [item.primary_identity_anchor, ...item.priority_0_refs].some(
        (anchor) => anchor?.asset_id === "AST-DOES-NOT-EXIST"
      )
    ),
    false
  );
  assert.equal(result.host_handoff.action, "DO_NOT_INVOKE_GENERATOR");
  assert.equal(writes.length, 0);
});

test("missing David identity authority is not ready and does not invent a reference", () => {
  const packet = prepareGenerationPacket(
    {
      project: "TEST-NATIVE-HANDOFF",
      subjects: ["David"],
      user_instruction: "Create one photorealistic portrait of David.",
      scene: "",
      generator: "CHATGPT_IMAGE",
      mode: "GENERATE",
      base_capture_id: "",
      parent_request_id: "",
      source_result_id: "",
      iteration: 1,
      trace_id: "trace-test-d-empty",
    },
    {
      ...authoritySnapshot(),
      asset_registry: [],
      asset_index: [],
    },
    "trace-test-d-empty"
  );
  assert.equal(packet.ready_to_generate, false);
  assert.ok(
    packet.blockers.some((blocker) => blocker.code === "MISSING_IDENTITY_ANCHOR")
  );
  assert.equal(packet.identity_authority[0]?.primary_identity_anchor, null);
});

test("invalid base_capture_id blocks edit without claiming the renderer is unavailable", async () => {
  const result = await handlersFor(authoritySnapshot()).prepareGeneration({
    project: "TEST-NATIVE-HANDOFF",
    subjects: ["David"],
    user_instruction: "Change only the background to night.",
    mode: "EDIT",
    base_capture_id: "CAP-MISSING",
    generator: "CHATGPT_IMAGE",
    trace_id: "trace-test-invalid-base",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ready_to_generate, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === "INVALID_BASE_CAPTURE"));
  assert.equal(result.host_handoff.action, "DO_NOT_INVOKE_GENERATOR");
  assert.doesNotMatch(
    JSON.stringify(result),
    /image generator is not enabled|renderer unavailable|generation is not available in this MCP/i
  );
});

test("Test E — original 13 tools remain registered with the same Apps Script actions", async () => {
  const source = await readFile("src/index.ts", "utf8");
  const tools = [
    ["visual_get_system_status", 'appsScriptGet("status")'],
    ["visual_list_pending_batches", 'appsScriptGet("batches")'],
    ["visual_get_batch", 'appsScriptGet("batch"'],
    ["visual_list_recent_captures", 'appsScriptGet("captures"'],
    ["visual_get_capture", "safeReadHandlers.getCapture"],
    ["visual_detect_orphan_captures", "safeReadHandlers.detectOrphanCaptures"],
    ["visual_list_batches_by_project", "safeReadHandlers.listBatchesByProject"],
    ["visual_create_session", 'action: "create_session"'],
    ["visual_close_session", 'action: "close_session"'],
    ["visual_create_request", 'action: "create_request"'],
    ["visual_cancel_request", 'action: "cancel_request"'],
    ["visual_submit_decision", 'action: "submit_decision"'],
    ["visual_promote_asset", 'action: "promote_asset"'],
  ] as const;
  for (const [tool, action] of tools) {
    assert.match(source, new RegExp(`registerTool\\(\\s*"${tool}"`));
    assert.equal(source.includes(action), true, `${tool} must keep ${action}`);
  }
  assert.match(
    source,
    /This MCP never renders images and must not be interpreted as image generation being unavailable/
  );
  assert.match(
    source,
    /visual_create_request[\s\S]*does not render an image/
  );
  assert.match(
    source,
    /READY_TO_GENERATE and request_id are control-plane outputs/
  );
  assert.doesNotMatch(
    source,
    /image generator is not enabled|I cannot generate the image|renderer unavailable/
  );
});

test("idempotent prepare reuses an existing request for the same trace_id", async () => {
  const writes: Record<string, unknown>[] = [];
  const snapshot = authoritySnapshot();
  snapshot.requests = [
    {
      request_id: "REQ-EXISTING",
      notes: "trace_id=trace-idempotent; prepared_by=visual_prepare_generation",
    },
  ];
  const result = await handlersFor(snapshot, writes).prepareGeneration({
    project: "TEST-NATIVE-HANDOFF",
    subjects: ["David"],
    user_instruction: "Create one photorealistic portrait of David by a Bogotá window.",
    generator: "CHATGPT_IMAGE",
    trace_id: "trace-idempotent",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ready_to_generate, true);
  assert.equal(result.request_id, "REQ-EXISTING");
  assert.equal(writes.length, 0);
});

test("P1 — candidate identity without approval is not ready", () => {
  const packet = prepareGenerationPacket(
    {
      project: "TEST-NATIVE-HANDOFF",
      subjects: ["David"],
      user_instruction: "Create one photorealistic portrait of David.",
      scene: "",
      generator: "CHATGPT_IMAGE",
      mode: "GENERATE",
      base_capture_id: "",
      parent_request_id: "",
      source_result_id: "",
      iteration: 1,
      trace_id: "trace-p1-candidate",
    },
    {
      ...authoritySnapshot(),
      asset_index: [],
      asset_registry: [
        {
          asset_id: "AST-DAVID-CANDIDATE",
          subjects: "David",
          scope: "Identity Anchor",
          status: "ACTIVE",
          source_file_id: "FILE-DAVID-CANDIDATE",
          file_name: "DAVID_CANDIDATE.png",
          notes: "Priority 0 identity",
        },
      ],
    },
    "trace-p1-candidate"
  );
  assert.equal(packet.ready_to_generate, false);
  assert.equal(
    packet.identity_authority[0]?.primary_identity_anchor?.verification_status,
    "CANDIDATE"
  );
  assert.ok(
    packet.blockers.some((blocker) => blocker.code === "UNVERIFIED_IDENTITY_AUTHORITY")
  );
  assert.equal(packet.host_handoff.action, "DO_NOT_INVOKE_GENERATOR");
});

test("P1 — required anchor is attached to files and prompt", async () => {
  const result = await handlersFor(authoritySnapshot()).prepareGeneration({
    project: "TEST-NATIVE-HANDOFF",
    subjects: ["David"],
    user_instruction: "Create one photorealistic full-body portrait of David.",
    required_anchor_ids: ["AST-DAVID-BODY"],
    generator: "CHATGPT_IMAGE",
    trace_id: "trace-p1-required",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ready_to_generate, true);
  assert.equal(
    result.reference_files.some((anchor) => anchor.asset_id === "AST-DAVID-BODY"),
    true
  );
  assert.match(result.final_generation_prompt, /REQUIRED REFERENCES/);
  assert.match(result.final_generation_prompt, /AST-DAVID-BODY|DAVID_BODY_ANCHOR/);
});

test("P1 — missing edit parent is not ready and does not emit SCENE", async () => {
  const result = await handlersFor(authoritySnapshot()).prepareGeneration({
    project: "TEST-NATIVE-HANDOFF",
    subjects: ["David"],
    user_instruction: "Change only David's shirt to a white linen shirt.",
    mode: "EDIT",
    parent_request_id: "REQ-NOT-FOUND",
    generator: "CHATGPT_IMAGE",
    trace_id: "trace-p1-missing-parent",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ready_to_generate, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === "INVALID_EDIT_SOURCE"));
  assert.equal(result.final_generation_prompt, "");
  assert.doesNotMatch(result.final_generation_prompt, /SCENE:/);
});

test("P1 — valid edit parent freezes the source with PRESERVE and CHANGE ONLY", async () => {
  const result = await handlersFor(authoritySnapshot()).prepareGeneration({
    project: "TEST-NATIVE-HANDOFF",
    subjects: ["David"],
    user_instruction: "Change only David's shirt to a white linen shirt.",
    mode: "EDIT",
    parent_request_id: "REQ-PARENT-001",
    generator: "CHATGPT_IMAGE",
    trace_id: "trace-p1-valid-parent",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ready_to_generate, true);
  assert.match(result.final_generation_prompt, /EDIT BASE: REQ-PARENT-001/);
  assert.match(result.final_generation_prompt, /PRESERVE:/);
  assert.match(result.final_generation_prompt, /CHANGE ONLY:/);
  assert.doesNotMatch(result.final_generation_prompt, /\nSCENE:/);
});

test("P2 — unknown subject with regex metacharacters does not throw", () => {
  assert.doesNotThrow(() => {
    prepareGenerationPacket(
      {
        project: "TEST-NATIVE-HANDOFF",
        subjects: ["["],
        user_instruction: "Create one photorealistic portrait.",
        scene: "",
        generator: "CHATGPT_IMAGE",
        mode: "GENERATE",
        base_capture_id: "",
        parent_request_id: "",
        source_result_id: "",
        iteration: 1,
        trace_id: "trace-p2-regex",
      },
      authoritySnapshot(),
      "trace-p2-regex"
    );
  });
});

test("P2 — scene anchors are filtered to the mentioned location", () => {
  const withBogota = prepareGenerationPacket(
    {
      project: "TEST-NATIVE-HANDOFF",
      subjects: ["David"],
      user_instruction: "Create one photorealistic portrait of David by a Bogotá window.",
      scene: "",
      generator: "CHATGPT_IMAGE",
      mode: "GENERATE",
      base_capture_id: "",
      parent_request_id: "",
      source_result_id: "",
      iteration: 1,
      trace_id: "trace-p2-scene-bogota",
    },
    authoritySnapshot(),
    "trace-p2-scene-bogota"
  );
  assert.equal(
    withBogota.location_anchors.some((anchor) => anchor.asset_id === "AST-ROOM-BOGOTA"),
    true
  );
  assert.equal(
    withBogota.location_anchors.some((anchor) => anchor.asset_id === "AST-ROOM-MIAMI"),
    false
  );

  const generic = prepareGenerationPacket(
    {
      project: "TEST-NATIVE-HANDOFF",
      subjects: ["David"],
      user_instruction: "Create one photorealistic portrait of David.",
      scene: "",
      generator: "CHATGPT_IMAGE",
      mode: "GENERATE",
      base_capture_id: "",
      parent_request_id: "",
      source_result_id: "",
      iteration: 1,
      trace_id: "trace-p2-scene-generic",
    },
    authoritySnapshot(),
    "trace-p2-scene-generic"
  );
  assert.equal(generic.location_anchors.length, 0);
});
