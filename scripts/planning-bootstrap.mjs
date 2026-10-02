#!/usr/bin/env node

import process from "node:process";

export const REQUEST_MARKER = "<!-- drakeshard-planning-request:v1 -->";
export const MANAGED_START_PREFIX = "<!-- drakeshard-managed:start";
export const MANAGED_END = "<!-- drakeshard-managed:end -->";
export const WORK_ID_PREFIX = "<!-- drakeshard-work-id:";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function isPlanningRequestBody(body) {
  return typeof body === "string" && body.includes(REQUEST_MARKER);
}

export function isTrustedControlPermission(value) {
  return ["write", "maintain", "admin"].includes(String(value).toLowerCase());
}

export function parsePlanningRequest(body) {
  assert(isPlanningRequestBody(body), "planning request marker is missing");

  const markerIndex = body.indexOf(REQUEST_MARKER);
  const afterMarker = body.slice(markerIndex + REQUEST_MARKER.length);
  const match = afterMarker.match(/\`\`\`json\s*([\s\S]*?)\`\`\`/i);
  assert(match, "planning request must contain one fenced json block after the marker");

  let request;
  try {
    request = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`invalid planning request JSON: ${error.message}`);
  }

  return validatePlanningRequest(request);
}

export function validatePlanningRequest(request) {
  assert(request && typeof request === "object" && !Array.isArray(request), "planning request must be an object");

  if (request.project) {
    assert((request.project.owner ?? "drakeshard") === "drakeshard", "project.owner must be drakeshard");
    assert(
      Number.isInteger(request.project.number) ||
        (typeof request.project.title === "string" && request.project.title.trim()),
      "project.number or project.title is required",
    );
    if (request.project.fields !== undefined) {
      assert(Array.isArray(request.project.fields), "project.fields must be an array");
      for (const [index, field] of request.project.fields.entries()) {
        assert(field && typeof field === "object", `project.fields[${index}] must be an object`);
        assert(typeof field.name === "string" && field.name.trim(), `project.fields[${index}].name is required`);
        assert(
          ["TEXT", "NUMBER", "DATE", "SINGLE_SELECT"].includes(field.dataType),
          `project.fields[${index}].dataType must be TEXT, NUMBER, DATE, or SINGLE_SELECT`,
        );
        if (field.dataType === "SINGLE_SELECT") {
          assert(
            Array.isArray(field.options) &&
              field.options.length > 0 &&
              field.options.every((option) => option && typeof option.name === "string" && option.name.trim()),
            `project.fields[${index}].options must contain named options`,
          );
        }
      }
    }
  }

  const hasRepositoryWork =
    request.repository !== undefined ||
    request.repositoryBootstrap !== undefined ||
    request.milestone !== undefined ||
    request.issues !== undefined;

  if (hasRepositoryWork) {
    assert(
      typeof request.repository === "string" && /^drakeshard\/[A-Za-z0-9_.-]+$/.test(request.repository),
      "repository must target drakeshard/<repo>",
    );

    if (request.repositoryBootstrap !== undefined) {
      const bootstrap = request.repositoryBootstrap;
      assert(bootstrap && typeof bootstrap === "object" && !Array.isArray(bootstrap), "repositoryBootstrap must be an object");
      assert(bootstrap.visibility !== "private", "public planning bootstrap cannot create private repositories");
      if (bootstrap.visibility !== undefined) {
        assert(bootstrap.visibility === "public", "repositoryBootstrap.visibility must be public");
      }
      if (bootstrap.files !== undefined) {
        assert(Array.isArray(bootstrap.files), "repositoryBootstrap.files must be an array");
        for (const [index, file] of bootstrap.files.entries()) {
          assert(file && typeof file === "object", `repositoryBootstrap.files[${index}] must be an object`);
          assert(typeof file.path === "string" && file.path.trim(), `repositoryBootstrap.files[${index}].path is required`);
          assert(!file.path.startsWith("/") && !file.path.includes(".."), `repositoryBootstrap.files[${index}].path must be repository-relative`);
          assert(typeof file.content === "string", `repositoryBootstrap.files[${index}].content must be a string`);
        }
      }
    }

    const hasIssueWork = request.milestone !== undefined || request.issues !== undefined;
    if (hasIssueWork) {
      assert(
        request.milestone && typeof request.milestone.title === "string" && request.milestone.title.trim(),
        "milestone.title is required",
      );
      assert(Array.isArray(request.issues) && request.issues.length > 0, "issues must contain at least one work item");
    }
  } else {
    assert(request.project, "planning request must contain project or repository work");
  }

  const ids = new Set();
  for (const [index, issue] of (request.issues ?? []).entries()) {
    assert(issue && typeof issue === "object", `issues[${index}] must be an object`);
    assert(typeof issue.workId === "string" && /^[A-Z][A-Z0-9-]*[0-9][A-Z0-9-]*$/.test(issue.workId), `issues[${index}].workId is invalid`);
    assert(!ids.has(issue.workId), `duplicate workId: ${issue.workId}`);
    ids.add(issue.workId);
    assert(typeof issue.title === "string" && issue.title.trim(), `issues[${index}].title is required`);
    assert(typeof issue.body === "string" && issue.body.trim(), `issues[${index}].body is required`);

    if (issue.issueNumber !== undefined) {
      assert(Number.isInteger(issue.issueNumber) && issue.issueNumber > 0, `issues[${index}].issueNumber must be a positive integer`);
    }
    if (issue.labels !== undefined) {
      assert(
        Array.isArray(issue.labels) &&
          issue.labels.every(
            (label) =>
              (typeof label === "string" && label.trim()) ||
              (label &&
                typeof label === "object" &&
                typeof label.name === "string" &&
                label.name.trim()),
          ),
        `issues[${index}].labels must contain non-empty strings or label objects with a name`,
      );
    }
    if (issue.projectFields !== undefined) {
      assert(issue.projectFields && typeof issue.projectFields === "object" && !Array.isArray(issue.projectFields), `issues[${index}].projectFields must be an object`);
    }
  }

  return request;
}

export function managedIssueBody(workId, generatedBody, existingBody = "") {
  const start = `${MANAGED_START_PREFIX} work-id=${workId} -->`;
  const managed = [
    `${WORK_ID_PREFIX} ${workId} -->`,
    start,
    generatedBody.trim(),
    MANAGED_END,
  ].filter((line) => line !== null).join("\n");

  const startIndex = existingBody.indexOf(MANAGED_START_PREFIX);
  const endIndex = existingBody.indexOf(MANAGED_END);

  if (startIndex >= 0 && endIndex > startIndex) {
    const before = existingBody
      .slice(0, startIndex)
      .replace(workIdMarker(workId), "")
      .replace(/\s+$/, "");
    const after = existingBody.slice(endIndex + MANAGED_END.length).replace(/^\s+/, "");
    return [before, managed, after].filter(Boolean).join("\n\n");
  }

  if (!existingBody.trim()) return managed;
  return `${managed}\n\n## Existing notes\n\n${existingBody.trim()}`;
}

export function workIdMarker(workId) {
  return `${WORK_ID_PREFIX} ${workId} -->`;
}

function headers(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "drakeshard-planning-bootstrap",
  };
}

export async function githubRequest(token, path, options = {}) {
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: headers(token),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = data?.message ?? text ?? response.statusText;
    throw new Error(`GitHub API ${response.status} ${options.method ?? "GET"} ${path}: ${detail}`);
  }
  return data;
}

async function graphql(token, query, variables = {}) {
  const data = await githubRequest(token, "/graphql", {
    method: "POST",
    body: { query, variables },
  });
  if (data.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${data.errors.map((error) => error.message).join("; ")}`);
  }
  return data.data;
}

function splitRepo(repository) {
  const [owner, repo] = repository.split("/");
  return { owner, repo };
}

async function listAll(token, path) {
  const separator = path.includes("?") ? "&" : "?";
  return githubRequest(token, `${path}${separator}per_page=100`);
}

export function desiredRepositorySettings(repository, bootstrap = {}) {
  const { repo } = splitRepo(repository);
  return {
    name: repo,
    description: bootstrap.description ?? "",
    private: false,
    has_issues: bootstrap.hasIssues ?? true,
    has_projects: false,
    has_wiki: bootstrap.hasWiki ?? false,
    has_downloads: false,
    has_discussions: bootstrap.hasDiscussions ?? false,
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    allow_auto_merge: true,
    allow_update_branch: true,
    delete_branch_on_merge: true,
  };
}

async function findRepository(token, repository) {
  try {
    return await githubRequest(token, `/repos/${repository}`);
  } catch (error) {
    if (String(error.message).includes("GitHub API 404")) return null;
    throw error;
  }
}

async function ensureRepositoryFile(token, repository, file, dryRun) {
  const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
  let existing = null;
  try {
    existing = await githubRequest(token, `/repos/${repository}/contents/${encodedPath}?ref=main`);
  } catch (error) {
    if (!String(error.message).includes("GitHub API 404")) throw error;
  }

  if (dryRun) {
    return { path: file.path, action: existing ? "would-update" : "would-create" };
  }

  const payload = {
    message: file.message ?? `bootstrap: sync ${file.path}`,
    content: Buffer.from(file.content, "utf8").toString("base64"),
    branch: "main",
  };
  if (existing?.sha) payload.sha = existing.sha;

  await githubRequest(token, `/repos/${repository}/contents/${encodedPath}`, {
    method: "PUT",
    body: payload,
  });
  return { path: file.path, action: existing ? "updated" : "created" };
}

async function ensureMainRuleset(token, repository, rulesetConfig, dryRun) {
  if (!rulesetConfig) return null;
  const rulesets = await githubRequest(token, `/repos/${repository}/rulesets`);
  const desiredName = rulesetConfig.name ?? "Protect main";
  const existing = rulesets.find((candidate) => candidate.name === desiredName);

  const payload = {
    name: desiredName,
    target: "branch",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: ["~DEFAULT_BRANCH"],
        exclude: [],
      },
    },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: ["squash"],
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: (rulesetConfig.requiredStatusChecks ?? ["Quality", "Dependency Review"]).map((context) => ({ context })),
        },
      },
      { type: "required_linear_history" },
    ],
    bypass_actors: [],
  };

  if (dryRun) return { name: desiredName, action: existing ? "would-update" : "would-create" };

  if (existing) {
    await githubRequest(token, `/repos/${repository}/rulesets/${existing.id}`, {
      method: "PUT",
      body: payload,
    });
    return { name: desiredName, action: "updated" };
  }

  await githubRequest(token, `/repos/${repository}/rulesets`, {
    method: "POST",
    body: payload,
  });
  return { name: desiredName, action: "created" };
}

export async function ensureRepository(token, repository, bootstrap = {}, dryRun = false) {
  assert(/^drakeshard\/[A-Za-z0-9_.-]+$/.test(repository), "repository must target drakeshard/<repo>");
  assert(bootstrap.visibility !== "private", "public planning bootstrap cannot create private repositories");

  let state = await findRepository(token, repository);
  let created = false;

  if (!state) {
    assert(bootstrap.createIfMissing === true, `repository "${repository}" not found and createIfMissing is not true`);
    if (dryRun) {
      state = { full_name: repository, visibility: "public", default_branch: "main", dryRun: true };
    } else {
      const { owner } = splitRepo(repository);
      assert(owner === "drakeshard", "repository owner must be drakeshard");
      const desired = desiredRepositorySettings(repository, bootstrap);
      state = await githubRequest(token, "/orgs/drakeshard/repos", {
        method: "POST",
        body: {
          ...desired,
          auto_init: true,
        },
      });
      created = true;
    }
  }

  assert(state.visibility === "public" || state.private === false, "planning bootstrap supports public target repositories only");

  if (!dryRun) {
    const desired = desiredRepositorySettings(repository, bootstrap);
    state = await githubRequest(token, `/repos/${repository}`, {
      method: "PATCH",
      body: desired,
    });
  }

  const files = [];
  for (const file of bootstrap.files ?? []) {
    files.push(await ensureRepositoryFile(token, repository, file, dryRun));
  }

  const ruleset = await ensureMainRuleset(token, repository, bootstrap.mainRuleset, dryRun);

  return {
    repository: state.full_name ?? repository,
    created,
    visibility: state.visibility ?? "public",
    defaultBranch: state.default_branch ?? "main",
    files,
    ruleset,
  };
}

export async function ensureMilestone(token, repository, milestone, dryRun) {
  const { owner, repo } = splitRepo(repository);
  const milestones = await listAll(token, `/repos/${owner}/${repo}/milestones?state=all`);
  const existing = milestones.find((item) => item.title === milestone.title);

  if (existing) {
    const desired = {
      title: milestone.title,
      description: milestone.description ?? existing.description ?? "",
      due_on: milestone.dueOn ?? existing.due_on ?? null,
      state: milestone.state ?? existing.state ?? "open",
    };
    const changed =
      existing.description !== desired.description ||
      existing.due_on !== desired.due_on ||
      existing.state !== desired.state;

    if (changed && !dryRun) {
      return githubRequest(token, `/repos/${owner}/${repo}/milestones/${existing.number}`, {
        method: "PATCH",
        body: desired,
      });
    }
    return existing;
  }

  if (dryRun) return { number: -1, title: milestone.title, dryRun: true };

  return githubRequest(token, `/repos/${owner}/${repo}/milestones`, {
    method: "POST",
    body: {
      title: milestone.title,
      description: milestone.description ?? "",
      due_on: milestone.dueOn ?? null,
      state: milestone.state ?? "open",
    },
  });
}

export async function ensureLabel(token, repository, label, dryRun) {
  const { owner, repo } = splitRepo(repository);
  const name = typeof label === "string" ? label : label.name;
  const color = typeof label === "string" ? "D4C5F9" : (label.color ?? "D4C5F9").replace("#", "");
  const description = typeof label === "string" ? "" : (label.description ?? "");

  try {
    const existing = await githubRequest(token, `/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`);
    const changed = existing.color.toLowerCase() !== color.toLowerCase() || (existing.description ?? "") !== description;
    if (changed && !dryRun) {
      await githubRequest(token, `/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, {
        method: "PATCH",
        body: { new_name: name, color, description },
      });
    }
    return name;
  } catch (error) {
    if (!String(error.message).includes("GitHub API 404")) throw error;
  }

  if (!dryRun) {
    await githubRequest(token, `/repos/${owner}/${repo}/labels`, {
      method: "POST",
      body: { name, color, description },
    });
  }
  return name;
}

async function fetchIssue(token, repository, number) {
  const { owner, repo } = splitRepo(repository);
  return githubRequest(token, `/repos/${owner}/${repo}/issues/${number}`);
}

async function findIssueByWorkId(token, repository, workId) {
  const { owner, repo } = splitRepo(repository);
  const query = `repo:${repository} is:issue in:body "${workIdMarker(workId)}"`;
  const result = await githubRequest(token, `/search/issues?q=${encodeURIComponent(query)}&per_page=20`);
  const matches = result.items.filter((item) => item.repository_url.endsWith(`/${owner}/${repo}`));
  if (matches.length > 1) throw new Error(`multiple issues contain workId ${workId}`);
  return matches[0] ?? null;
}

export async function upsertIssue(token, request, item, milestoneNumber, dryRun) {
  const repository = request.repository;
  const { owner, repo } = splitRepo(repository);
  const labels = [];
  for (const label of item.labels ?? []) {
    labels.push(await ensureLabel(token, repository, label, dryRun));
  }

  let existing = null;
  if (item.issueNumber) {
    existing = await fetchIssue(token, repository, item.issueNumber);
    assert(!existing.pull_request, `issueNumber ${item.issueNumber} points to a pull request`);
  } else {
    existing = await findIssueByWorkId(token, repository, item.workId);
  }

  const body = managedIssueBody(item.workId, item.body, existing?.body ?? "");
  const existingLabels =
    existing?.labels
      ?.map((label) => (typeof label === "string" ? label : label.name))
      .filter(Boolean) ?? [];
  const mergedLabels = [...new Set([...existingLabels, ...labels])];
  const payload = {
    title: item.title,
    body,
    labels: mergedLabels,
    milestone: milestoneNumber > 0 ? milestoneNumber : null,
  };

  if (existing) {
    if (!dryRun) {
      existing = await githubRequest(token, `/repos/${owner}/${repo}/issues/${existing.number}`, {
        method: "PATCH",
        body: payload,
      });
    }
    return { action: "updated", issue: existing, body, payload };
  }

  if (dryRun) {
    return {
      action: "would-create",
      issue: { number: -1, html_url: `https://github.com/${repository}/issues/new`, node_id: null },
      body,
      payload,
    };
  }

  const created = await githubRequest(token, `/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: payload,
  });
  return { action: "created", issue: created, body, payload };
}

async function queryProjectByNumber(token, owner, number) {
  const data = await graphql(
    token,
    `query($owner:String!, $number:Int!) {
      organization(login:$owner) {
        projectV2(number:$number) {
          id number title
          fields(first:100) {
            nodes {
              __typename
              ... on ProjectV2Field { id name dataType }
              ... on ProjectV2SingleSelectField { id name options { id name } }
              ... on ProjectV2IterationField { id name configuration { iterations { id title startDate duration } } }
            }
          }
          items(first:100) {
            nodes {
              id
              content { ... on Issue { id number url } }
            }
          }
        }
      }
    }`,
    { owner, number },
  );
  return data.organization?.projectV2 ?? null;
}

async function createProject(token, project) {
  const owner = project.owner ?? "drakeshard";
  const ownerData = await graphql(
    token,
    `query($owner:String!) { organization(login:$owner) { id } }`,
    { owner },
  );
  const ownerId = ownerData.organization?.id;
  assert(ownerId, `organization "${owner}" not found`);

  const created = await graphql(
    token,
    `mutation($owner:ID!, $title:String!) {
      createProjectV2(input:{ownerId:$owner, title:$title}) {
        projectV2 { id number title }
      }
    }`,
    { owner: ownerId, title: project.title },
  );
  assert(created.createProjectV2?.projectV2, `failed to create project "${project.title}"`);
  return created.createProjectV2.projectV2;
}

async function createProjectField(token, projectId, field) {
  const variables = {
    project: projectId,
    name: field.name,
    dataType: field.dataType,
  };

  let query;
  if (field.dataType === "SINGLE_SELECT") {
    variables.options = field.options.map((option) => ({
      name: option.name,
      description: option.description ?? "",
      color: option.color ?? "GRAY",
    }));
    query = `mutation(
      $project:ID!,
      $name:String!,
      $dataType:ProjectV2CustomFieldType!,
      $options:[ProjectV2SingleSelectFieldOptionInput!]
    ) {
      createProjectV2Field(
        input:{
          projectId:$project,
          name:$name,
          dataType:$dataType,
          singleSelectOptions:$options
        }
      ) { projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name } } } }
    }`;
  } else {
    query = `mutation($project:ID!, $name:String!, $dataType:ProjectV2CustomFieldType!) {
      createProjectV2Field(input:{projectId:$project, name:$name, dataType:$dataType}) {
        projectV2Field { ... on ProjectV2Field { id name dataType } }
      }
    }`;
  }

  const data = await graphql(token, query, variables);
  assert(data.createProjectV2Field?.projectV2Field, `failed to create project field "${field.name}"`);
}

async function ensureProjectFields(token, project, requestedFields = []) {
  if (!requestedFields.length) return project;
  const existingNames = new Set(project.fields.nodes.filter(Boolean).map((field) => field.name));

  for (const field of requestedFields) {
    if (existingNames.has(field.name)) continue;
    await createProjectField(token, project.id, field);
  }

  return queryProjectByNumber(token, "drakeshard", project.number);
}

async function ensureProject(token, project, dryRun = false) {
  const owner = project.owner ?? "drakeshard";
  if (project.number) {
    const found = await queryProjectByNumber(token, owner, project.number);
    assert(found, `project #${project.number} not found`);
    return dryRun ? found : ensureProjectFields(token, found, project.fields ?? []);
  }

  const data = await graphql(
    token,
    `query($owner:String!) {
      organization(login:$owner) {
        projectsV2(first:100) { nodes { id number title } }
      }
    }`,
    { owner },
  );
  const match = data.organization?.projectsV2?.nodes?.find((candidate) => candidate.title === project.title);

  if (match) {
    const found = await queryProjectByNumber(token, owner, match.number);
    return dryRun ? found : ensureProjectFields(token, found, project.fields ?? []);
  }

  assert(project.createIfMissing === true, `project "${project.title}" not found and createIfMissing is not true`);
  if (dryRun) {
    return { id: null, number: -1, title: project.title, fields: { nodes: [] }, items: { nodes: [] }, dryRun: true };
  }

  const created = await createProject(token, project);
  const found = await queryProjectByNumber(token, owner, created.number);
  return ensureProjectFields(token, found, project.fields ?? []);
}

async function ensureProjectItem(token, project, issueNodeId, issueUrl) {
  const existing = project.items.nodes.find((item) => item.content?.id === issueNodeId);
  if (existing) return existing.id;

  const data = await graphql(
    token,
    `mutation($project:ID!, $content:ID!) {
      addProjectV2ItemById(input:{projectId:$project, contentId:$content}) {
        item { id }
      }
    }`,
    { project: project.id, content: issueNodeId },
  );
  assert(data.addProjectV2ItemById?.item?.id, `failed to add ${issueUrl} to project`);
  return data.addProjectV2ItemById.item.id;
}

function fieldValueFor(field, rawValue) {
  if (field.__typename === "ProjectV2SingleSelectField") {
    const option = field.options.find((candidate) => candidate.name === String(rawValue));
    assert(option, `project field "${field.name}" has no option "${rawValue}"`);
    return { singleSelectOptionId: option.id };
  }

  if (field.__typename === "ProjectV2IterationField") {
    const iteration = field.configuration.iterations.find((candidate) => candidate.title === String(rawValue));
    assert(iteration, `project field "${field.name}" has no iteration "${rawValue}"`);
    return { iterationId: iteration.id };
  }

  const type = field.dataType;
  if (type === "NUMBER") {
    const number = Number(rawValue);
    assert(Number.isFinite(number), `project field "${field.name}" requires a number`);
    return { number };
  }
  if (type === "DATE") return { date: String(rawValue) };
  if (type === "TEXT") return { text: String(rawValue) };

  throw new Error(`unsupported project field type for "${field.name}": ${type ?? field.__typename}`);
}

async function setProjectFields(token, project, itemId, values) {
  for (const [name, rawValue] of Object.entries(values ?? {})) {
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const field = project.fields.nodes.find((candidate) => candidate?.name === name);
    assert(field, `project field "${name}" not found`);
    const value = fieldValueFor(field, rawValue);

    await graphql(
      token,
      `mutation($project:ID!, $item:ID!, $field:ID!, $value:ProjectV2FieldValue!) {
        updateProjectV2ItemFieldValue(
          input:{projectId:$project, itemId:$item, fieldId:$field, value:$value}
        ) { projectV2Item { id } }
      }`,
      { project: project.id, item: itemId, field: field.id, value },
    );
  }
}

export async function applyPlanningRequest(token, request, { dryRun = false } = {}) {
  validatePlanningRequest(request);

  const repositoryBootstrap = request.repository
    ? await ensureRepository(token, request.repository, request.repositoryBootstrap ?? {}, dryRun)
    : null;
  const project = request.project ? await ensureProject(token, request.project, dryRun) : null;
  if (!request.repository) {
    return {
      repository: null,
      milestone: null,
      project: project ? { number: project.number, title: project.title } : null,
      dryRun,
      results: [],
    };
  }

  if (!request.milestone && !request.issues) {
    return {
      repository: request.repository,
      repositoryBootstrap,
      milestone: null,
      project: project ? { number: project.number, title: project.title } : null,
      dryRun,
      results: [],
    };
  }

  const milestone = await ensureMilestone(token, request.repository, request.milestone, dryRun);
  const results = [];

  for (const item of request.issues) {
    const result = await upsertIssue(token, request, item, milestone.number, dryRun);

    if (project && result.issue.node_id) {
      const projectItemId = await ensureProjectItem(token, project, result.issue.node_id, result.issue.html_url);
      await setProjectFields(token, project, projectItemId, item.projectFields);
    }

    results.push({
      workId: item.workId,
      action: result.action,
      number: result.issue.number,
      url: result.issue.html_url,
    });
  }

  return {
    repository: request.repository,
    repositoryBootstrap,
    milestone: milestone.title,
    project: project ? { number: project.number, title: project.title } : null,
    dryRun,
    results,
  };
}

function summaryMarkdown(summary) {
  const rows = summary.results
    .map((item) => `| ${item.workId} | ${item.action} | ${item.number > 0 ? `#${item.number}` : "—"} |`)
    .join("\n");
  return [
    `## Planning bootstrap ${summary.dryRun ? "dry run" : "completed"}`,
    "",
    summary.repository ? `Repository: \`${summary.repository}\`` : null,
    summary.repositoryBootstrap
      ? `Repository bootstrap: \`${summary.repositoryBootstrap.created ? "created" : "reused"}\``
      : null,
    summary.milestone ? `Milestone: \`${summary.milestone}\`` : null,
    summary.project ? `Project: \`#${summary.project.number} ${summary.project.title}\`` : null,
    "",
    "| Work ID | Result | Issue |",
    "| --- | --- | --- |",
    rows,
  ].filter((line) => line !== null).join("\n");
}

async function main() {
  const token = process.env.GH_TOKEN;
  const controlToken = process.env.CONTROL_GH_TOKEN;
  const controlRepo = process.env.GITHUB_REPOSITORY;
  const issueNumber = Number(process.env.REQUEST_ISSUE);
  const dryRun = String(process.env.DRY_RUN ?? "false").toLowerCase() === "true";

  assert(token, "GH_TOKEN is required");
  assert(controlToken, "CONTROL_GH_TOKEN is required");
  assert(controlRepo === "drakeshard/.github", "workflow must run from drakeshard/.github");
  assert(Number.isInteger(issueNumber) && issueNumber > 0, "REQUEST_ISSUE must be a positive integer");

  const controlIssue = await fetchIssue(controlToken, controlRepo, issueNumber);
  if (!isPlanningRequestBody(controlIssue.body ?? "")) {
    console.log(`Issue #${issueNumber} is not a planning request; nothing to do.`);
    return;
  }

  const authorLogin = controlIssue.user?.login;
  assert(authorLogin, "planning request issue has no author login");
  const { owner: controlOwner, repo: controlRepoName } = splitRepo(controlRepo);
  const permissionState = await githubRequest(
    controlToken,
    `/repos/${controlOwner}/${controlRepoName}/collaborators/${encodeURIComponent(authorLogin)}/permission`,
  );
  assert(
    isTrustedControlPermission(permissionState.permission),
    "planning request author must have write, maintain, or admin permission on drakeshard/.github",
  );

  const request = parsePlanningRequest(controlIssue.body ?? "");
  const summary = await applyPlanningRequest(token, request, { dryRun });

  const { owner, repo } = splitRepo(controlRepo);
  if (!dryRun) {
    await githubRequest(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
      method: "POST",
      body: { body: summaryMarkdown(summary) },
    });
    await githubRequest(token, `/repos/${owner}/${repo}/issues/${issueNumber}`, {
      method: "PATCH",
      body: { state: "closed", state_reason: "completed" },
    });
  } else {
    console.log(summaryMarkdown(summary));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
