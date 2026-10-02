import test from "node:test";
import assert from "node:assert/strict";

import {
  MANAGED_END,
  REQUEST_MARKER,
  isPlanningRequestBody,
  isTrustedControlPermission,
  managedIssueBody,
  parsePlanningRequest,
  sharedLibraryMainRuleset,
  sharedLibraryRepositorySettings,
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


test("accepts rich label objects", () => {
  const payload = request();
  payload.issues[0].labels = [{ name: "type:feature", color: "0E8A16", description: "Feature" }];
  assert.equal(validatePlanningRequest(payload), payload);
});

test("managed body rerun keeps exactly one work ID marker", () => {
  const first = managedIssueBody("RPG-I10", "First generated.", "");
  const second = managedIssueBody("RPG-I10", "Second generated.", first);
  const occurrences = second.split(workIdMarker("RPG-I10")).length - 1;
  assert.equal(occurrences, 1);
  assert.match(second, /Second generated/);
  assert.doesNotMatch(second, /First generated/);
});


test("detects planning request marker without parsing", () => {
  assert.equal(isPlanningRequestBody(`x\n${REQUEST_MARKER}\ny`), true);
  assert.equal(isPlanningRequestBody("ordinary issue"), false);
});


test("trusts only control-repo write-or-higher permissions", () => {
  assert.equal(isTrustedControlPermission("admin"), true);
  assert.equal(isTrustedControlPermission("maintain"), true);
  assert.equal(isTrustedControlPermission("write"), true);
  assert.equal(isTrustedControlPermission("triage"), false);
  assert.equal(isTrustedControlPermission("read"), false);
  assert.equal(isTrustedControlPermission("none"), false);
});


test("accepts project-only bootstrap requests", () => {
  const payload = {
    project: {
      owner: "drakeshard",
      title: "Drakeshard Tactical v0.1",
      createIfMissing: true,
      fields: [
        {
          name: "Readiness",
          dataType: "SINGLE_SELECT",
          options: [{ name: "Ready" }, { name: "Backlog" }, { name: "Blocked" }],
        },
        { name: "Work ID", dataType: "TEXT" },
        { name: "Effort", dataType: "NUMBER" },
      ],
    },
  };
  assert.equal(validatePlanningRequest(payload), payload);
});

test("rejects unsupported project field types", () => {
  const payload = {
    project: {
      owner: "drakeshard",
      title: "Bad Project",
      createIfMissing: true,
      fields: [{ name: "Iteration", dataType: "ITERATION" }],
    },
  };
  assert.throws(() => validatePlanningRequest(payload), /dataType must be/);
});


test("accepts existing-repository file bootstrap", () => {
  const payload = {
    repository: "drakeshard/tactical",
    repositoryBootstrap: {
      visibility: "public",
      files: [{ path: "README.md", content: "# Tactical" }],
    },
  };
  assert.equal(validatePlanningRequest(payload), payload);
});

test("rejects repository creation requests", () => {
  const payload = {
    repository: "drakeshard/tactical",
    repositoryBootstrap: { createIfMissing: true, visibility: "public" },
  };
  assert.throws(() => validatePlanningRequest(payload), /repository creation is owner-only/);
});

test("rejects repository bootstrap file path traversal", () => {
  const payload = {
    repository: "drakeshard/tactical",
    repositoryBootstrap: {
      files: [{ path: "../secret", content: "no" }],
    },
  };
  assert.throws(() => validatePlanningRequest(payload), /repository-relative/);
});



test("milestone due dates are optional by contract", () => {
  const payload = request();
  delete payload.milestone.dueOn;
  assert.equal(validatePlanningRequest(payload), payload);
});


test("label upsert contract remains valid for shared label reuse", () => {
  const payload = request();
  payload.issues[0].labels = [
    { name: "type:feature", color: "0E8A16", description: "Feature" },
    { name: "area:core", color: "0052CC", description: "Core" },
  ];
  assert.equal(validatePlanningRequest(payload), payload);
});


test("accepts the fixed shared-library existing-repo admin profile", () => {
  const payload = {
    repository: "drakeshard/tactical",
    repositoryBootstrap: {
      visibility: "public",
      adminProfile: "shared-library-v1",
    },
  };
  assert.equal(validatePlanningRequest(payload), payload);
});

test("rejects arbitrary repository admin profiles", () => {
  const payload = {
    repository: "drakeshard/tactical",
    repositoryBootstrap: {
      visibility: "public",
      adminProfile: "anything-goes",
    },
  };
  assert.throws(() => validatePlanningRequest(payload), /adminProfile must be/);
});

test("shared-library repository settings are narrow and squash-only", () => {
  assert.deepEqual(sharedLibraryRepositorySettings(), {
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    allow_auto_merge: true,
    allow_update_branch: true,
    delete_branch_on_merge: true,
  });
});

test("shared-library main ruleset protects main with required checks", () => {
  const ruleset = sharedLibraryMainRuleset();
  assert.equal(ruleset.name, "Protect main");
  assert.deepEqual(ruleset.conditions.ref_name.include, ["~DEFAULT_BRANCH"]);
  const pullRequest = ruleset.rules.find((rule) => rule.type === "pull_request");
  assert.deepEqual(pullRequest.parameters.allowed_merge_methods, ["squash"]);
  assert.equal(pullRequest.parameters.required_review_thread_resolution, true);
  const checks = ruleset.rules.find((rule) => rule.type === "required_status_checks");
  assert.deepEqual(
    checks.parameters.required_status_checks.map((item) => item.context),
    ["Dependency Review", "Quality"],
  );
  assert.equal(checks.parameters.strict_required_status_checks_policy, true);
  assert.ok(ruleset.rules.some((rule) => rule.type === "deletion"));
  assert.ok(ruleset.rules.some((rule) => rule.type === "non_fast_forward"));
  assert.ok(ruleset.rules.some((rule) => rule.type === "required_linear_history"));
});


test("project select field requests may include a completed state", () => {
  const payload = {
    project: {
      owner: "drakeshard",
      title: "Drakeshard Tactical v0.1",
      createIfMissing: true,
      fields: [
        {
          name: "Readiness",
          dataType: "SINGLE_SELECT",
          options: [
            { name: "Ready", color: "GREEN" },
            { name: "Backlog", color: "GRAY" },
            { name: "Blocked", color: "RED" },
            { name: "Done", color: "PURPLE" }
          ]
        }
      ]
    }
  };
  assert.equal(validatePlanningRequest(payload), payload);
});
