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
  assert(typeof request.repository === "string" && /^drakeshard\/[A-Za-z0-9_.-]+$/.test(request.repository), "repository must target drakeshard/<repo>");
  assert(request.milestone && typeof request.milestone.title === "string" && request.milestone.title.trim(), "milestone.title is required");
  assert(Array.isArray(request.issues) && request.issues.length > 0, "issues must contain at least one work item");

  if (request.project) {
    assert((request.project.owner ?? "drakeshard") === "drakeshard", "project.owner must be drakeshard");
    assert(Number.isInteger(request.project.number) || (typeof request.project.title === "string" && request.project.title.trim()), "project.number or project.title is required");
  }

  const ids = new Set();
  for (const [index, issue] of request.issues.entries()) {
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
  ].join("\n");

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

async function resolveProject(token, project) {
  if (project.number) {
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
      { owner: project.owner ?? "drakeshard", number: project.number },
    );
    assert(data.organization?.projectV2, `project #${project.number} not found`);
    return data.organization.projectV2;
  }

  const data = await graphql(
    token,
    `query($owner:String!) {
      organization(login:$owner) {
        projectsV2(first:100) { nodes { id number title } }
      }
    }`,
    { owner: project.owner ?? "drakeshard" },
  );
  const match = data.organization?.projectsV2?.nodes?.find((candidate) => candidate.title === project.title);
  assert(match, `project "${project.title}" not found`);
  return resolveProject(token, { owner: project.owner ?? "drakeshard", number: match.number });
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
  const repositoryState = await githubRequest(token, `/repos/${request.repository}`);
  assert(
    repositoryState.visibility === "public",
    "v1 planning bootstrap only supports public target repositories because the control request is stored in the public drakeshard/.github repository",
  );
  const milestone = await ensureMilestone(token, request.repository, request.milestone, dryRun);
  const project = request.project && !dryRun ? await resolveProject(token, request.project) : null;
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
    milestone: milestone.title,
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
    `Repository: \`${summary.repository}\``,
    `Milestone: \`${summary.milestone}\``,
    "",
    "| Work ID | Result | Issue |",
    "| --- | --- | --- |",
    rows,
  ].join("\n");
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

  assert(["OWNER", "MEMBER"].includes(controlIssue.author_association), "planning request author must be an organization OWNER or MEMBER");

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
