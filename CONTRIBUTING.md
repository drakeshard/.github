# Contributing to Drakeshard Studios

Thanks for your interest in contributing.

This file provides organization-wide defaults for Drakeshard repositories that do not define their own contribution guide. A repository-specific `CONTRIBUTING.md` always takes precedence.

## Before you start

For non-trivial changes, open an issue or discussion first so the problem, scope, and intended approach are clear before significant implementation work begins.

For small fixes such as typos, documentation corrections, or obvious defects, a focused pull request is welcome.

## Development principles

- Keep changes focused and easy to review.
- Prefer simple solutions over speculative abstractions.
- Match the existing architecture and style of the repository.
- Do not mix unrelated refactors with feature or bug-fix work.
- Add or update tests when the repository has an established test suite.
- Update documentation when behavior, setup, configuration, or public APIs change.
- Never commit credentials, private keys, tokens, signing files, or other secrets.

## Branch naming

Use short, descriptive names:

```text
feature/player-inventory
fix/mobile-input
docs/setup-guide
refactor/save-system
chore/dependency-update
```

## Commits

Write concise, imperative commit messages that explain the change.

Examples:

```text
Add touch controls for mobile
Fix save data migration on startup
Document local development setup
```

## Pull requests

A good pull request should:

1. Explain what changed and why.
2. Link related issues where applicable.
3. Describe how the change was tested.
4. Include screenshots or recordings for meaningful visual changes.
5. Call out known limitations, follow-up work, or migration concerns.
6. Stay scoped to one logical change whenever practical.

Draft pull requests are encouraged for work that needs early feedback.

## Review

Review focuses on correctness, maintainability, player impact, security, performance, and whether the change is appropriately scoped.

Address review comments with follow-up commits or discussion. Resolve conversations only when the concern has been addressed or agreement has been reached.

## Licensing

By contributing, you agree that your contributions may be distributed under the license used by the target repository.

## Conduct

Participation in Drakeshard projects is subject to our [Code of Conduct](CODE_OF_CONDUCT.md).
