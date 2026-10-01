# Planning Bootstrap Automation

## Purpose

The organization planning bootstrap turns an already-approved planning interpretation into GitHub management objects. It is a mechanical executor, not a planning or architecture authority.

Google Drive remains authoritative for controlled Drakeshard governance, architecture, roadmaps, risks, incubation/extraction decisions, and Working Context. Target GitHub repositories remain authoritative for executable issues, pull requests, CI, releases, and repository state.

The expected flow is:

1. an engineering assistant reads the canonical controlled Drive sources and the live target repository;
2. the assistant resolves the approved work and produces a planning request issue in `drakeshard/.github`;
3. this workflow validates the request and upserts GitHub milestones, labels, issues, Project membership, and Project fields;
4. generated work is keyed by stable Drakeshard work IDs so reruns update instead of duplicating;
5. controlled documentation is reconciled separately when material state or governance changes.

## GitHub App setup

Create an organization GitHub App, for example **Drakeshard Planning Bot**, and install it on `drakeshard/.github` plus every repository that planning bootstrap may manage.

Minimum repository permissions:

- **Issues: Read and write**
- **Metadata: Read**

Minimum organization permission:

- **Projects: Read and write**

If the App is later used for capabilities outside this workflow, expand permissions only through a separate review.

Configure these in `drakeshard/.github` Actions settings:

- repository variable `PLANNING_APP_CLIENT_ID`: the App client ID;
- repository secret `PLANNING_APP_PRIVATE_KEY`: the App private key PEM.

Never commit the private key.

The workflow creates a short-lived installation token with `actions/create-github-app-token` and scopes it to the Drakeshard organization installation. The repository-scoped workflow `GITHUB_TOKEN` has read-only Issues access and is used only to authenticate the control request's author association; all cross-repository writes use the Planning Bot installation token.

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

## Dry run and retry

Use **Actions → Planning Bootstrap → Run workflow** with:

- the request issue number;
- `dry_run=true` to validate and print the intended issue operations without writes;
- `dry_run=false` to retry a trusted request.

Automatic issue-event execution is non-dry-run and closes the request issue after successful application.

## Security boundaries

- target repositories must be under `drakeshard/*`;\n- v1 accepts only public target repositories because the planning request body is stored in the public `drakeshard/.github` control repository; use a separately approved private control channel before managing private/proprietary repositories;
- Project owner must be `drakeshard`;
- automatic execution only accepts request issues authored by organization OWNER or MEMBER accounts;
- architecture decisions, repository/package creation, releases, merges, and dependency-unblocking policy are outside this workflow;
- GitHub App credentials exist only in Actions configuration.

## v1 non-goals

Planning Bootstrap v1 intentionally does not:

- parse Google Drive;
- maintain a second roadmap database;
- decide library ownership;
- authorize a repository or package;
- infer missing dependencies;
- automatically promote blocked work to Ready;
- merge implementation pull requests;
- publish releases.
