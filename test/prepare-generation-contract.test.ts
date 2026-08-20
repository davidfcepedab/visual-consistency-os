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

test("P0 — a Status-only approval convention (no human_anchor_approval column) is honored as verified", () => {
  // Regression for the real 13_Asset_Index schema, which has no
  // human_anchor_approval/approved_by column at all -- only a Status
  // string. "ACTIVE" alone must stay unverified (previous test); the
  // specific approval-outcome statuses below must not.
  for (const status of ["PRIORITY_0_PRIMARY", "PRIORITY_0_APPROVED", "APPROVED_TOP", "APPROVED_GOOD"]) {
    const packet = prepareGenerationPacket(
      {
        project: "TEST-STATUS-CONVENTION",
        subjects: ["David"],
        user_instruction: "Create one photorealistic portrait of David.",
        scene: "",
        generator: "CHATGPT_IMAGE",
        mode: "GENERATE",
        base_capture_id: "",
        parent_request_id: "",
        source_result_id: "",
        iteration: 1,
        trace_id: `trace-status-${status}`,
      },
      {
        ...authoritySnapshot(),
        asset_index: [
          {
            Asset: "DAVID_APPROVED_ANCHOR_STATUS_TEST.jpeg",
            "Character / Area": "David",
            Status: status,
            "Drive Link": "https://drive.google.com/file/d/FILE-DAVID-STATUS-TEST/view",
            Folder: "David/01. Priority 0 | Approved Identity Anchors/DAVID_APPROVED_ANCHOR_STATUS_TEST.jpeg",
            Notes: "Anchor",
          },
        ],
        asset_registry: [],
      },
      `trace-status-${status}`
    );
    assert.equal(
      packet.identity_authority[0]?.primary_identity_anchor?.verification_status,
      "VERIFIED_SOURCE",
      `Status=${status} should be treated as human-verified`
    );
  }
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

test("P0 FIX 1 — David duplicate registry (same pack in asset_registry + asset_index) is NOT ambiguous", () => {
  const packet = prepareGenerationPacket(
    {
      project: "TEST-CANONICAL-PACK",
      subjects: ["David"],
      user_instruction: "Create one photorealistic portrait of David.",
      scene: "",
      generator: "CHATGPT_IMAGE",
      mode: "GENERATE",
      base_capture_id: "",
      parent_request_id: "",
      source_result_id: "",
      iteration: 1,
      trace_id: "trace-p0-canonical-mirror",
    },
    {
      ...authoritySnapshot(),
      asset_registry: [
        {
          asset_id: "DAVID-MIRROR-1",
          subjects: "David",
          scope: "Identity Anchor",
          status: "PRIORITY_0_PRIMARY",
          source_file_id: "FILE-DAVID-CANONICAL",
          file_name: "DAVID_APPROVED_ANCHOR_CANONICAL.jpeg",
          approved_by: "David",
        },
      ],
      asset_index: [
        {
          Asset: "DAVID_APPROVED_ANCHOR_CANONICAL.jpeg",
          "Character / Area": "David",
          Status: "PRIORITY_0_PRIMARY",
          "Drive Link": "https://drive.google.com/file/d/FILE-DAVID-CANONICAL/view",
          Notes: "Mirror of asset_registry entry",
        },
      ],
    },
    "trace-p0-canonical-mirror"
  );
  assert.equal(packet.ready_to_generate, true);
  assert.ok(
    !packet.blockers.some((b) => b.code === "AMBIGUOUS_IDENTITY_AUTHORITY"),
    "Mirroring same canonical pack should NOT be ambiguous"
  );
});

test("P0 FIX 2 — Juan approved + Drive 404 excluded, does not block if alternative exists", () => {
  const packet = prepareGenerationPacket(
    {
      project: "TEST-404-EXCLUSION",
      subjects: ["Juan"],
      user_instruction: "Create one photorealistic portrait of Juan.",
      scene: "",
      generator: "CHATGPT_IMAGE",
      mode: "GENERATE",
      base_capture_id: "",
      parent_request_id: "",
      source_result_id: "",
      iteration: 1,
      trace_id: "trace-p0-404",
    },
    {
      ...authoritySnapshot(),
      asset_index: [
        {
          Asset: "JUAN_BROKEN_404.png",
          "Character / Area": "Juan",
          Status: "ACTIVE",
          "Drive Link": "https://drive.google.com/file/d/FILE-BROKEN/view",
          physical_status: "NOT_FOUND",
          Notes: "Marked as 404",
        },
        {
          Asset: "JUAN_APPROVED_VALID.jpeg",
          "Character / Area": "Juan",
          Status: "PRIORITY_0_APPROVED",
          "Drive Link": "https://drive.google.com/file/d/FILE-JUAN-VALID/view",
          Notes: "Real approved file",
        },
      ],
      asset_registry: [],
    },
    "trace-p0-404"
  );
  const juan = packet.identity_authority.find((a) => a.subject === "Juan");
  assert.ok(juan?.primary_identity_anchor !== null);
  assert.notEqual(juan?.primary_identity_anchor?.asset_id, "JUAN_BROKEN_404.png");
});

test("P0 FIX 3 — SalaTV Identity Anchor does NOT satisfy location request (role enforcement)", () => {
  // REGRESSION: scene matching filters by role, NOT just name matching.
  // An Identity Anchor with "SalaTV" in the filename should NOT be returned
  // when requesting Room Anchors, even if its name matches the scene keyword.
  const minimalSnapshot: GenerationContextSnapshot = {
    revision: "test-rev",
    config: { ACTIVE_DAVID_MASTER_PACK_ID: "PACK-DAVID" },
    asset_registry: [
      {
        asset_id: "AST-DAVID-IDENTITY",
        file_name: "DAVID_IDENTITY_PHOTO_SALATV.jpeg",
        subjects: "David",
        scope: "Identity Anchor",
        status: "PRIORITY_0_PRIMARY",
        approved_by: "David",
        notes: "Priority 0 identity anchor, SalaTV scene compatible",
      },
      {
        asset_id: "AST-ROOM-SALATV",
        file_name: "SALATV_ROOM_ANCHOR.jpg",
        scope: "Room Anchor",
        status: "APPROVED",
        notes: "SalaTV living room environment",
      },
    ],
    asset_index: [],
    captures: [],
    requests: [],
    result_memory: [],
  };
  const packet = prepareGenerationPacket(
    {
      project: "TEST-ROLE",
      subjects: ["David"],
      user_instruction: "David in the SalaTV living room.",
      scene: "@loc_bog_salatv",
      generator: "CHATGPT_IMAGE",
      mode: "GENERATE",
      base_capture_id: "",
      parent_request_id: "",
      source_result_id: "",
      iteration: 1,
      trace_id: "trace-p0-role",
    },
    minimalSnapshot,
    "trace-p0-role"
  );
  // Verify: Room Anchor selected, Identity Anchor rejected
  assert.ok(
    packet.location_anchors.some((a) => a.asset_id === "AST-ROOM-SALATV"),
    "Room Anchor should be selected"
  );
  assert.ok(
    !packet.location_anchors.some((a) => a.asset_id === "AST-DAVID-IDENTITY"),
    "Identity Anchor must NOT be selected, role mismatch overrides name match"
  );
});

function generationInput(
  overrides: Partial<{
    project: string;
    subjects: string[];
    user_instruction: string;
    scene: string;
    required_anchor_ids: string[];
    trace_id: string;
  }> = {}
) {
  return {
    project: overrides.project || "TEST-READINESS",
    subjects: overrides.subjects || ["David"],
    user_instruction:
      overrides.user_instruction ||
      "Create one photorealistic portrait of David.",
    scene: overrides.scene || "",
    generator: "CHATGPT_IMAGE",
    mode: "GENERATE" as const,
    base_capture_id: "",
    parent_request_id: "",
    source_result_id: "",
    iteration: 1,
    required_anchor_ids: overrides.required_anchor_ids,
    trace_id: overrides.trace_id || "trace-readiness",
  };
}

test("allows generation when David has deterministic P0 authority plus provenance warning", () => {
  const packet = prepareGenerationPacket(
    generationInput({
      project: "TEST-P0-PROVENANCE-WARNING",
      user_instruction:
        "Create one photorealistic portrait of David with Priority 0 identity.",
      scene: "",
      trace_id: "trace-p0-provenance-warning",
    }),
    {
      ...authoritySnapshot(),
      asset_registry: [
        {
          asset_id: "AST-DAVID-P0-PRIMARY",
          subjects: "David",
          scope: "Identity Anchor",
          status: "PRIORITY_0_PRIMARY",
          source_file_id: "FILE-DAVID-CANONICAL",
          file_name: "DAVID_APPROVED_ANCHOR_01.jpeg",
          approved_by: "David",
          provenance: "conflict: duplicate registry row for the same canonical pack",
        },
        {
          asset_id: "AST-DAVID-P0-02",
          subjects: "David",
          scope: "Identity Anchor",
          status: "PRIORITY_0_APPROVED",
          source_file_id: "FILE-DAVID-REF-02",
          file_name: "DAVID_APPROVED_ANCHOR_02.jpeg",
          approved_by: "David",
        },
        {
          asset_id: "AST-DAVID-P0-03",
          subjects: "David",
          scope: "Identity Anchor",
          status: "PRIORITY_0_APPROVED",
          source_file_id: "FILE-DAVID-REF-03",
          file_name: "DAVID_APPROVED_ANCHOR_03.jpeg",
          approved_by: "David",
        },
        {
          asset_id: "AST-DAVID-P0-04",
          subjects: "David",
          scope: "Identity Anchor",
          status: "PRIORITY_0_APPROVED",
          source_file_id: "FILE-DAVID-REF-04",
          file_name: "DAVID_APPROVED_ANCHOR_04.jpeg",
          approved_by: "David",
        },
        {
          asset_id: "AST-DAVID-P0-05",
          subjects: "David",
          scope: "Identity Anchor",
          status: "PRIORITY_0_APPROVED",
          source_file_id: "FILE-DAVID-REF-05",
          file_name: "DAVID_APPROVED_ANCHOR_05.jpeg",
          approved_by: "David",
        },
        {
          asset_id: "AST-DAVID-P0-06",
          subjects: "David",
          scope: "Identity Anchor",
          status: "PRIORITY_0_APPROVED",
          source_file_id: "FILE-DAVID-REF-06",
          file_name: "DAVID_APPROVED_ANCHOR_06.jpeg",
          approved_by: "David",
        },
        {
          asset_id: "AST-DAVID-P0-07",
          subjects: "David",
          scope: "Identity Anchor",
          status: "PRIORITY_0_APPROVED",
          source_file_id: "FILE-DAVID-REF-07",
          file_name: "DAVID_APPROVED_ANCHOR_07.jpeg",
          approved_by: "David",
        },
      ],
      asset_index: [
        {
          Asset: "DAVID_APPROVED_ANCHOR_01.jpeg",
          "Character / Area": "David",
          Status: "PRIORITY_0_PRIMARY",
          "Drive Link": "https://drive.google.com/file/d/FILE-DAVID-CANONICAL/view",
          Notes: "conflict: mirrored asset_index row of the canonical pack",
        },
      ],
    },
    "trace-p0-provenance-warning"
  );

  assert.equal(packet.ready_to_generate, true);
  assert.deepEqual(packet.blockers, []);
  assert.ok(
    packet.warnings.some(
      (warning) =>
        warning.code === "PROVENANCE_CONFLICT" && warning.subject === "David"
    )
  );
  assert.equal(packet.host_handoff.action, "INVOKE_NATIVE_IMAGE_GENERATOR");
  assert.equal(packet.host_handoff.same_turn, true);
});

test("uses TEXT_FALLBACK when optional Room Anchor is missing", () => {
  const snapshot = authoritySnapshot();
  snapshot.asset_registry = snapshot.asset_registry.filter(
    (record) =>
      !["AST-ROOM-BOGOTA", "AST-ROOM-MIAMI"].includes(String(record.asset_id))
  );
  const packet = prepareGenerationPacket(
    generationInput({
      project: "TEST-LOCATION-FALLBACK",
      user_instruction: "Create one photorealistic portrait of David in SalaTV.",
      scene: "@loc_bog_salatv",
      trace_id: "trace-location-fallback",
    }),
    snapshot,
    "trace-location-fallback"
  );

  assert.equal(packet.ready_to_generate, true);
  assert.equal(packet.location_anchors.length, 0);
  assert.ok(
    packet.warnings.some(
      (warning) =>
        warning.code === "LOCATION_TEXT_FALLBACK" &&
        warning.location === "@loc_bog_salatv"
    )
  );
  assert.ok(
    !packet.blockers.some(
      (blocker) => blocker.code === "REQUIRED_LOCATION_ANCHOR_MISSING"
    )
  );
  assert.equal(packet.host_handoff.action, "INVOKE_NATIVE_IMAGE_GENERATOR");
  assert.equal(packet.host_handoff.same_turn, true);
});

test("blocks genuinely competing unresolved identity authorities", () => {
  const packet = prepareGenerationPacket(
    generationInput({
      project: "TEST-COMPETING-AUTHORITIES",
      user_instruction: "Create one photorealistic portrait of David.",
      trace_id: "trace-competing-authorities",
    }),
    {
      ...authoritySnapshot(),
      config: {
        ...authoritySnapshot().config,
        ACTIVE_DAVID_MASTER_PACK_ID: "PACK-UNMATCHED",
      },
      asset_registry: [
        {
          asset_id: "AST-DAVID-PACK-A",
          subjects: "David",
          scope: "Identity Anchor",
          status: "PRIORITY_0_PRIMARY",
          source_file_id: "FILE-DAVID-PACK-A",
          file_name: "DAVID_PACK_A_PRIMARY.jpeg",
          approved_by: "David",
          notes: "Priority 0 identity pack A",
        },
        {
          asset_id: "AST-DAVID-PACK-B",
          subjects: "David",
          scope: "Identity Anchor",
          status: "PRIORITY_0_PRIMARY",
          source_file_id: "FILE-DAVID-PACK-B",
          file_name: "DAVID_PACK_B_PRIMARY.jpeg",
          approved_by: "David",
          notes: "Priority 0 identity pack B",
        },
      ],
      asset_index: [],
    },
    "trace-competing-authorities"
  );

  assert.equal(packet.ready_to_generate, false);
  assert.ok(
    packet.blockers.some(
      (blocker) =>
        blocker.code === "AMBIGUOUS_IDENTITY_AUTHORITY" &&
        blocker.subject === "David"
    )
  );
  assert.equal(packet.host_handoff.action, "DO_NOT_INVOKE_GENERATOR");
  assert.equal(packet.host_handoff.same_turn, false);
});

test("blocks when an explicitly required approved Room Anchor is missing", () => {
  const snapshot = authoritySnapshot();
  snapshot.asset_registry = snapshot.asset_registry.filter(
    (record) =>
      !["AST-ROOM-BOGOTA", "AST-ROOM-MIAMI"].includes(String(record.asset_id))
  );
  const packet = prepareGenerationPacket(
    generationInput({
      project: "TEST-REQUIRED-ROOM-ANCHOR",
      user_instruction:
        "Create one photorealistic portrait of David using the required approved Room Anchor.",
      scene: "@loc_bog_salatv",
      required_anchor_ids: ["@loc_bog_salatv"],
      trace_id: "trace-required-room-anchor",
    }),
    snapshot,
    "trace-required-room-anchor"
  );

  assert.equal(packet.ready_to_generate, false);
  assert.ok(
    packet.blockers.some(
      (blocker) =>
        blocker.code === "REQUIRED_LOCATION_ANCHOR_MISSING" &&
        blocker.location === "@loc_bog_salatv"
    )
  );
  assert.ok(
    !packet.blockers.some(
      (blocker) => blocker.code === "MISSING_REQUIRED_REFERENCE"
    )
  );
  assert.equal(packet.host_handoff.action, "DO_NOT_INVOKE_GENERATOR");
});
