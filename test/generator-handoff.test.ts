import assert from "node:assert/strict";
import test from "node:test";
import { readGenerationHandoff } from "../src/generator-handoff.js";

function envelope() {
  const packet = { ok: true, ready_to_generate: true, request_id: "REQ-EXACT",
    final_generation_prompt: "One portrait",
    identity_authority: [{ primary_identity_anchor: { file_id: "FILE-PRIMARY" } }],
    reference_delivery: { status: "ATTACHED", count: 1, required_count: 1,
      attached: ["FILE-PRIMARY"], failed: [] } };
  return { structuredContent: packet, content: [
    { type: "text", text: JSON.stringify(packet) },
    { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
  ] };
}

test("host reads structured or JSON text packets and forwards the exact physical block", () => {
  const input = envelope();
  const output = readGenerationHandoff(input);
  assert.equal(output.request_id, "REQ-EXACT");
  assert.equal(output.references[0].image_block, input.content[1]);
  assert.equal(output.references[0].source_file_id, "FILE-PRIMARY");
  assert.equal(output.references[0].byte_length, 5);
  assert.equal(output.generator_consumption, "NOT_VERIFIED");
  assert.equal(readGenerationHandoff({ content: input.content }).request_id, "REQ-EXACT");
});

test("ATTACHED without a physical bitmap blocks before a generator invocation", () => {
  const input = envelope();
  input.content.pop();
  assert.throws(() => readGenerationHandoff(input), /BLOCKED_REFERENCE_DELIVERY/);
});

test("malformed content and non-JSON error text produce explicit blockers instead of map TypeError", () => {
  assert.throws(() => readGenerationHandoff({ content: {} }), /BLOCKED_INVALID_MCP_ENVELOPE/);
  assert.throws(() => readGenerationHandoff({ content: [{ type: "text", text: "tool call error" }] }), /BLOCKED_INVALID_GENERATION_PACKET/);
});

test("other image bytes cannot substitute for a missing primary or a mismatched manifest", () => {
  const input = envelope();
  input.structuredContent.reference_delivery.attached = ["FILE-OTHER"];
  assert.throws(() => readGenerationHandoff(input), /BLOCKED_PRIMARY_BITMAP_MISSING/);
  const other = envelope();
  Object.assign(other.structuredContent.reference_delivery, { manifest: [{ file_id: "FILE-PRIMARY", sha256: "wrong" }] });
  assert.throws(() => readGenerationHandoff(other), /BLOCKED_REFERENCE_MANIFEST_MISMATCH/);
});
