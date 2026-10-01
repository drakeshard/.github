# Drakeshard Studios · GitHub Community Health

This repository contains the shared GitHub profile, contribution standards, issue forms, pull request template, security policy, organization automation, and community defaults used across **Drakeshard Studios** repositories.

## Structure

```text
.
├── profile/
│   └── README.md
├── .github/
│   ├── ISSUE_TEMPLATE/
│   └── workflows/
│       └── planning-bootstrap.yml
├── docs/
│   └── planning-bootstrap.md
├── scripts/
│   ├── planning-bootstrap.mjs
│   └── planning-bootstrap.test.mjs
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── PULL_REQUEST_TEMPLATE.md
├── SECURITY.md
└── SUPPORT.md
```

Repository-specific files may override these organization defaults when a project needs different requirements.

The planning bootstrap workflow executes approved, AI-generated project-management requests against Drakeshard repositories. It does not replace controlled planning or architecture. See [docs/planning-bootstrap.md](docs/planning-bootstrap.md).

For the public studio profile, see [profile/README.md](profile/README.md).
