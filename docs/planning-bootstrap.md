# Planning Bootstrap Automation

## Purpose

The organization planning bootstrap turns an already-approved planning interpretation into GitHub management objects. It is a mechanical executor, not a planning or architecture authority.

Google Drive remains authoritative for controlled Drakeshard governance, architecture, roadmaps, risks, incubation/extraction decisions, and Working Context. Target GitHub repositories remain authoritative for executable issues, pull requests, CI, releases, and repository state.

The expected flow is:

1. an engineering assistant reads the canonical controlled Drive sources and the live target repository;
2. the assistant resolves the approved work and produces a planning request issue in `drakeshard/.github`;
3. this workflow validates the request and can explicitly create/reuse a public Drakeshard repository, seed its approved baseline files/ruleset, create/reuse an organization Project v2, create supported custom Project fields, and upsert GitHub milestones, labels, issues, Project membership, and Project field values;
4. generated work is keyed by stable Drakeshard work IDs so reruns update instead of duplicating;
5. controlled documentation is reconciled separately when material state or governance changes.

## GitHub App setup

Create an organization GitHub App, for example **Drakeshard Planning Bot**, and install it on `drakeshard/.github` plus every repository that planning bootstrap may manage.

Minimum repository permissions for ordinary issue/milestone synchronization:

- **Issues: Read and write**
- **Metadata: Read**

Additional repository permissions for repository bootstrap:

- **Administration: Read and write** — create/configure repositories and rulesets;
- **Contents: Read and write** — seed/update repository files;
- **Workflows: Read and write** — seed/update files under `.github/workflows/`.

For true zero-touch creation of future repositories, install the Planning Bot for **All repositories** in the Drakeshard organization. If it is installed only on selected repositories, a newly created repository must be added to the App installation before later synchronization can manage it.

Minimum organization permission:

- **Projects: Read and write**

If the App is later used for capabilities outside this workflow, expand permissions only through a separate review.

Configure these in `drakeshard/.github` Actions settings:

- repository variable `PLANNING_APP_CLIENT_ID`: the App client ID;
- repository secret `PLANNING_APP_PRIVATE_KEY`: the App private key PEM.

Never commit the private key.

The workflow creates a short-lived installation token with `actions/create-github-app-token` and scopes it to the Drakeshard organization installation. The repository-scoped workflow `GITHUB_TOKEN` has read-only Issues access and is used only to read the control request and verify the request author's permission on `drakeshard/.github`. Only authors with `write`, `maintain`, or `admin` permission are accepted, which works consistently for UI-created and connector-created issues. All cross-repository writes use the Planning Bot installation token.

## Request format

Create an issue in `drakeshard/.github` authored by an organization OWNER or MEMBER. The body must contain:

```markdown
<!-- drakeshard-planning-request:v1 -->

```json
{
  "repository": "drakeshard/rpg",
  "milestone": {
    "title": "RPG v0.2 Incubation",
    "description": "Approved v0.2 incubation work."
  },
  "project": {
    "owner": "drakeshard",
    "number": 1
  },
  "issues": [
    {
      "workId": "RPG-I10",
      "title": "Incubate example mechanism",
      "body": "## Objective\\n\\nImplement the approved mechanism.",
      "labels": [
        {
          "name": "type:feature",
          "color": "0E8A16",
          "description": "New capability"
        }
      ],
      "projectFields": {
        "Status": "Ready",
        "Priority": "P1",
        "Sprint": "Sprint 05",
        "Effort": 3
      }
    }
  ]
}
```
```

Opening, editing, or reopening a trusted issue with the marker triggers the workflow.

## Repository bootstrap

Repository creation is never inferred from a missing repository. It requires an explicit `repositoryBootstrap.createIfMissing: true` request and is restricted to public `drakeshard/*` repositories because the control request is public.

Example:

```json
{
  "repository": "drakeshard/tactical",
  "repositoryBootstrap": {
    "createIfMissing": true,
    "visibility": "public",
    "description": "renderer-neutral discrete-battlefield tactical domain library for Drakeshard games",
    "files": [
      { "path": "README.md", "content": "# Drakeshard Tactical" }
    ],
    "mainRuleset": {
      "requiredStatusChecks": ["Quality", "Dependency Review"]
    }
  }
}
```

Existing repositories are reused and their requested settings/files/ruleset are reconciled idempotently. Repository bootstrap does not authorize stable package exports or publication.

## Idempotency

Every generated target issue receives:

```html
<!-- drakeshard-work-id: RPG-I10 -->
```

The bootstrap searches for this marker before creating a new issue.

For an existing legacy issue that predates the marker, supply:

```json
"issueNumber": 10
```

The bootstrap adopts that issue, adds the stable marker, and subsequently finds it by work ID.

Issue text generated from planning is wrapped in:

```html
<!-- drakeshard-managed:start work-id=RPG-I10 -->
...
<!-- drakeshard-managed:end -->
```

Reruns replace only that managed region. Text outside it is retained.

## Project fields

The bootstrap supports these Project v2 field kinds when the named field exists:

- single-select fields by option name;
- iteration fields by iteration title;
- number fields;
- text fields;
- date fields.

Unknown fields, unsupported field types, unknown select options, and unknown iterations fail the request rather than silently inventing data.

Use a Project number when practical because it is an unambiguous stable lookup. A Project title is also accepted.

To bootstrap a Project before its target repository exists, submit a project-only request:

```json
{
  "project": {
    "owner": "drakeshard",
    "title": "Drakeshard Tactical v0.1",
    "createIfMissing": true,
    "fields": [
      {
        "name": "Readiness",
        "dataType": "SINGLE_SELECT",
        "options": [
          { "name": "Ready", "color": "GREEN" },
          { "name": "Backlog", "color": "GRAY" },
          { "name": "Blocked", "color": "RED" }
        ]
      },
      { "name": "Work ID", "dataType": "TEXT" },
      { "name": "Effort", "dataType": "NUMBER" }
    ]
  }
}
```

Project field creation currently supports `TEXT`, `NUMBER`, `DATE`, and `SINGLE_SELECT`. Existing fields are reused by name; missing requested fields are created. Iteration-field creation/configuration remains outside v1 because GitHub's iteration configuration requires separate lifecycle handling.

## Dry run and retry

Use **Actions → Planning Bootstrap → Run workflow** with:

- the request issue number;
- `dry_run=true` to validate and print the intended issue operations without writes;
- `dry_run=false` to retry a trusted request.

Automatic issue-event execution is non-dry-run and closes the request issue after successful application.

## Security boundaries

- target repositories must be under `drakeshard/*`;\n- v1 accepts only public target repositories because the planning request body is stored in the public `drakeshard/.github` control repository; use a separately approved private control channel before managing private/proprietary repositories;
- Project owner must be `drakeshard`;
- automatic execution only accepts request issues whose author has write, maintain, or admin permission on `drakeshard/.github`;
- architecture decisions, package publication/stable API admission, releases, merges, and dependency-unblocking policy are outside this workflow;
- repository creation is allowed only when the approved planning request explicitly authorizes a public `drakeshard/*` repository with `repositoryBootstrap.createIfMissing: true`;
- Project v2 creation is allowed only for the `drakeshard` organization and only when the request explicitly sets `createIfMissing: true`;
- GitHub App credentials exist only in Actions configuration.

## v1 non-goals

Planning Bootstrap v1 intentionally does not:

- parse Google Drive;
- maintain a second roadmap database;
- decide library ownership;
- invent repository authorization or package-publication authorization;
- infer missing dependencies;
- automatically promote blocked work to Ready;
- merge implementation pull requests;
- publish releases.
