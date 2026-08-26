import assert from "node:assert/strict";
import test from "node:test";

import {
  createPrepareGenerationHandlers,
  prepareGenerationPacket,
  PrepareGenerationInputSchema,
  type GenerationContextSnapshot,
} from "../src/prepare-generation-tools.js";

/**
 * Visual Identity OS V6.1 Phase 1 Tests
 *
 * Tests for:
 * 1. NEW without request_id → auto-generate
 * 2. REGENERATE from zero without base → normalize to GENERATE
 * 3. EDIT with valid base → unchanged
 * 4. EDIT without base → blocker (no fallback)
 * 5. Reference delivery minimum (ECONOMY)
 * 6. Hard block on missing P0
 * 7. Hard block on unverified authority
 */

function testSnapshot(): GenerationContextSnapshot {
  return {
    revision: "generation-rev-1",
    config: {
      ACTIVE_DAVID_MASTER_PACK_ID: "PACK-DAVID-V5",
      ACTIVE_JUAN_MASTER_PACK_ID: "PACK-JUAN-V4",
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
        status: "PRIORITY_0_PRIMARY",
        source_file_id: "FILE-DAVID-P0",
        file_name: "DAVID_PRIORITY_0_IDENTITY.png",
        approved_by: "David",
        human_anchor_approval: "APPROVED",
      },
      {
        asset_id: "AST-JUAN-P0",
        subjects: "Juan",
        scope: "Identity Anchor",
        status: "PRIORITY_0_PRIMARY",
        source_file_id: "FILE-JUAN-P0",
        file_name: "JUAN_PRIORITY_0_IDENTITY.png",
        approved_by: "David",
        human_anchor_approval: "APPROVED",
      },
      {
        asset_id: "AST-UNVERIFIED",
        subjects: "David",
        scope: "Identity Anchor",
        status: "ACTIVE",
        source_file_id: "FILE-UNVERIFIED",
        file_name: "UNVERIFIED_ANCHOR.png",
      },
    ],
    asset_index: [],
    captures: [
      {
        capture_id: "CAP-001",
        file_id: "FILE-CAP-001",
        identity_subjects: "David",
        project: "TEST",
        status: "APPROVED",
      },
    ],
    requests: [
      {
        request_id: "REQ-PARENT-001",
        status: "READY_TO_GENERATE",
        project: "TEST",
        prompt: "Original portrait.",
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

// ===== TEST 1: NEW without request_id → auto-generate =====
test("T1: NEW mode without request_id auto-generates ID and adds REQUEST_CREATED resolution", () => {
  const snapshot = testSnapshot();
  const packet = prepareGenerationPacket(
    PrepareGenerationInputSchema.parse({
      project: "TEST",
      subjects: ["David"],
      user_instruction: "Portrait of David",
      scene: "",
      generator: "CHATGPT_IMAGE",
      mode: "GENERATE",
      iteration: 1,
    }),
    snapshot,
    "trace-t1-001"
  );

  assert.equal(packet.ok, true);
  assert(packet.request_id !== "", "request_id should not be empty");
  assert(packet.request_id.startsWith("REQ-"), "request_id should start with REQ-");
  assert.deepEqual(packet.auto_resolutions, ["REQUEST_CREATED"]);
  assert.equal(packet.mode, "GENERATE");
  assert(packet.warnings.some((w) => w.code === "REQUEST_CREATED"));
});

// ===== TEST 2: REGENERATE from zero without base → normalize to GENERATE =====
test("T2: REGENERATE from zero without base normalizes to GENERATE with warning", () => {
  const snapshot = testSnapshot();
  const packet = prepareGenerationPacket(
    PrepareGenerationInputSchema.parse({
      project: "TEST",
      subjects: ["David"],
      user_instruction: "Different pose",
      scene: "",
      generator: "CHATGPT_IMAGE",
      mode: "REGENERATE", // ← no base_capture_id, etc.
      iteration: 2,
    }),
    snapshot,
    "trace-t2-001"
  );

  assert.equal(packet.mode, "GENERATE", "mode should normalize to GENERATE");
  assert(
    packet.auto_resolutions?.includes("MODE_REGENERATE_TO_GENERATE"),
    "should include MODE_REGENERATE_TO_GENERATE resolution"
  );
  assert(
    packet.auto_resolutions?.includes("REQUEST_CREATED"),
    "should also auto-create request_id when normalizing to GENERATE"
  );
  assert(
    packet.warnings.some((w) => w.code === "MODE_NORMALIZED"),
    "should have MODE_NORMALIZED warning"
  );
  assert(packet.ready_to_generate, "should still be ready if authority OK");
});

// ===== TEST 3: EDIT with valid base → unchanged =====
test("T3: EDIT with valid base_capture_id preserves EDIT mode", () => {
  const snapshot = testSnapshot();
  const packet = prepareGenerationPacket(
    PrepareGenerationInputSchema.parse({
      project: "TEST",
      subjects: ["David"],
      user_instruction: "Adjust lighting",
      scene: "",
      generator: "CHATGPT_IMAGE",
      mode: "EDIT",
      base_capture_id: "CAP-001", // ← valid
      iteration: 1,
    }),
    snapshot,
    "trace-t3-001"
  );

  assert.equal(packet.mode, "EDIT", "mode should stay EDIT");
  assert(!packet.auto_resolutions?.includes("MODE_REGENERATE_TO_GENERATE"));
  assert(
    !packet.warnings.some((w) => w.code === "MODE_NORMALIZED"),
    "should not normalize if base exists"
  );
  assert(packet.ready_to_generate, "should be ready with valid base");
});

// ===== TEST 4: EDIT without base → blocker (no fallback) =====
test("T4: EDIT without base_capture_id blocks generation (no fallback)", () => {
  const snapshot = testSnapshot();
  const packet = prepareGenerationPacket(
    PrepareGenerationInputSchema.parse({
      project: "TEST",
      subjects: ["David"],
      user_instruction: "Adjust colors",
      scene: "",
      generator: "CHATGPT_IMAGE",
      mode: "EDIT", // ← no base_capture_id
      iteration: 1,
    }),
    snapshot,
    "trace-t4-001"
  );

  assert.equal(packet.mode, "EDIT", "mode should stay EDIT");
  assert(!packet.ready_to_generate, "should not be ready without base");
  assert(
    packet.blockers.some((b) => b.code === "MISSING_EDIT_BASE"),
    "should have MISSING_EDIT_BASE blocker"
  );
});

// ===== TEST 5: Reference delivery minimum (ECONOMY mode implicit) =====
test("T5: Reference delivery minimum selects only primary P0 per subject (ECONOMY)", () => {
  const snapshot = testSnapshot();
  const packet = prepareGenerationPacket(
    PrepareGenerationInputSchema.parse({
      project: "TEST",
      subjects: ["David", "Juan"],
      user_instruction: "Couple portrait with many anchors",
      scene: "",
      generator: "CHATGPT_IMAGE",
      mode: "GENERATE",
      iteration: 1,
    }),
    snapshot,
    "trace-t5-001"
  );

  assert.equal(packet.ok, true);
  // In ECONOMY mode, should have David P0 and Juan P0 as minimal references
  const primaryRefs = packet.reference_files.filter(
    (ref) =>
      ref.role === "Identity Anchor" && ref.verification_status === "VERIFIED_SOURCE"
  );
  assert(
    primaryRefs.length >= 2,
    "should have at least 2 verified primary identity anchors (David + Juan)"
  );
  // Verify unverified and detail locks are NOT included in the default set
  const unverified = packet.reference_files.filter(
    (ref) => ref.verification_status === "CANDIDATE"
  );
  assert.equal(
    unverified.length,
    0,
    "should not include unverified references in ECONOMY delivery"
  );
});

// ===== TEST 6: Hard block on missing P0 =====
test("T6: Hard block when subject has no Priority 0 identity anchor", () => {
  const snapshot = testSnapshot();
  // Remove ALL David anchors from registry (both verified and unverified)
  snapshot.asset_registry = snapshot.asset_registry.filter(
    (r) => r.asset_id !== "AST-DAVID-P0" && r.asset_id !== "AST-UNVERIFIED"
  );

  const packet = prepareGenerationPacket(
    PrepareGenerationInputSchema.parse({
      project: "TEST",
      subjects: ["David"],
      user_instruction: "Portrait without P0",
      scene: "",
      generator: "CHATGPT_IMAGE",
      mode: "GENERATE",
      iteration: 1,
    }),
    snapshot,
    "trace-t6-001"
  );

  assert(!packet.ready_to_generate, "should block when P0 missing");
  assert(
    packet.blockers.some((b) => b.code === "MISSING_IDENTITY_ANCHOR"),
    "should have MISSING_IDENTITY_ANCHOR blocker"
  );
});

// ===== TEST 7: Hard block on unverified authority =====
test("T7: Hard block when subject identity is CANDIDATE (unverified)", () => {
  const snapshot = testSnapshot();
  // Remove verified P0, keep only unverified
  snapshot.asset_registry = snapshot.asset_registry.filter(
    (r) => r.asset_id !== "AST-DAVID-P0"
  );
  // Keep unverified as the only anchor
  snapshot.asset_registry = snapshot.asset_registry.filter(
    (r) =>
      r.asset_id === "AST-UNVERIFIED" ||
      (typeof r.subjects === "string" && r.subjects.includes("Juan"))
  );

  const packet = prepareGenerationPacket(
    PrepareGenerationInputSchema.parse({
      project: "TEST",
      subjects: ["David"],
      user_instruction: "Use unverified identity",
      scene: "",
      generator: "CHATGPT_IMAGE",
      mode: "GENERATE",
      iteration: 1,
    }),
    snapshot,
    "trace-t7-001"
  );

  assert(!packet.ready_to_generate, "should block on unverified authority");
  assert(
    packet.blockers.some((b) => b.code === "UNVERIFIED_IDENTITY_AUTHORITY"),
    "should have UNVERIFIED_IDENTITY_AUTHORITY blocker"
  );
});

// ===== Regression: Ensure existing behavior preserved =====
test("Regression: Normal NEW generation with valid P0 succeeds", () => {
  const snapshot = testSnapshot();
  const packet = prepareGenerationPacket(
    PrepareGenerationInputSchema.parse({
      project: "TEST",
      subjects: ["David", "Juan"],
      user_instruction: "Couple portrait in a beach scene",
      scene: "Sunny beach with ocean",
      generator: "CHATGPT_IMAGE",
      mode: "GENERATE",
      iteration: 1,
    }),
    snapshot,
    "trace-regression-001"
  );

  assert.equal(packet.ok, true);
  assert(packet.ready_to_generate, "should be ready with valid P0 for both");
  assert.equal(packet.subjects.length, 2);
  assert(packet.request_id !== "", "should have auto-generated request_id");
  assert.equal(packet.mode, "GENERATE");
});
