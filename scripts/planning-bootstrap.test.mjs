import test from "node:test";
import assert from "node:assert/strict";

import {
  MANAGED_END,
  REQUEST_MARKER,
  managedIssueBody,
  parsePlanningRequest,
  validatePlanningRequest,
  workIdMarker,
} from "./planning-bootstrap.mjs";

function request(overrides = {}) {
  return {
    repository: "drakeshard/rpg",
    milestone: { title: "RPG v0.2 Incubation" },
    project: { owner: "drakeshard", number: 1 },
    issues: [
      {
        workId: "RPG-I10",
        title: "Example",
        body: "## Objective\n\nDo the thing.",
        labels: ["type:feature"],
        projectFields: { Status: "Ready", Priority: "P1", Effort: 3 },
      },
    ],
    ...overrides,
  };
}

test("parses a marked fenced JSON planning request", () => {
  const payload = request();
  const body = `${REQUEST_MARKER}\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
  assert.deepEqual(parsePlanningRequest(body), payload);
});

test("rejects non-drakeshard repositories", () => {
  assert.throws(
    () => validatePlanningRequest(request({ repository: "someone/rpg" })),
    /repository must target drakeshard/,
  );
});

test("rejects duplicate work IDs", () => {
  const payload = request();
  payload.issues.push({ ...payload.issues[0] });
  assert.throws(() => validatePlanningRequest(payload), /duplicate workId/);
});

test("creates stable work ID marker", () => {
  assert.equal(workIdMarker("RPG-I10"), "<!-- drakeshard-work-id: RPG-I10 -->");
});

test("managed body adds markers for a new issue", () => {
  const body = managedIssueBody("RPG-I10", "## Objective\n\nNew.", "");
  assert.match(body, /drakeshard-work-id: RPG-I10/);
  assert.match(body, /drakeshard-managed:start work-id=RPG-I10/);
  assert.ok(body.endsWith(MANAGED_END));
});

test("managed body preserves content outside the managed region", () => {
  const existing = [
    "Human preface",
    "",
    "<!-- drakeshard-managed:start work-id=RPG-I10 -->",
    "Old generated content",
    MANAGED_END,
    "",
    "## Human notes",
    "",
    "Keep me.",
  ].join("\n");

  const updated = managedIssueBody("RPG-I10", "## Objective\n\nNew generated content.", existing);
  assert.match(updated, /Human preface/);
  assert.match(updated, /New generated content/);
  assert.doesNotMatch(updated, /Old generated content/);
  assert.match(updated, /Keep me/);
});

test("legacy unmarked issue body is retained as existing notes", () => {
  const updated = managedIssueBody("RPG-I10", "Generated.", "Legacy human body");
  assert.match(updated, /Generated/);
  assert.match(updated, /## Existing notes/);
  assert.match(updated, /Legacy human body/);
});
