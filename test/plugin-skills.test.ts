import assert from "node:assert/strict";
import test from "node:test";

import { loadDirectVisualIdentitySkill } from "../src/plugin-skills.js";

test("direct visual identity skill is complete and content-addressed", () => {
  const skill = loadDirectVisualIdentitySkill();
  assert.equal(skill.entry.frontmatter.name, "direct-visual-identity");
  assert.match(skill.entry.frontmatter.description, /solicitudes persistidas/);
  assert.equal(skill.resources.length, 3);
  assert.equal(skill.entry.resources.length, skill.resources.length);
  for (const resource of skill.resources) {
    assert.match(resource.uri, /^skill:\/\/visual-identity-os\/direct-visual-identity\//);
    assert.match(resource.digest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(resource.text.length > 0);
  }
  const main = skill.resources.find((resource) => resource.uri.endsWith("/SKILL.md"));
  assert.ok(main);
  assert.match(main?.text || "", /visual_execute_request/);
  assert.match(main?.text || "", /ready_to_generate=true/);
});
