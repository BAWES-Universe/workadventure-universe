# Universe Development Workflow

This document explains the day-to-day development loop for the `universe` branch.

## Branches

Start all Universe work from the `universe` branch unless an issue says otherwise.

Recommended branch names:

- `feat/<short-description>` for new features.
- `fix/<short-description>` for bug fixes.
- `chore/<short-description>` for maintenance and documentation.

Example:

```bash
git checkout universe
git pull
git checkout -b feat/cicd-universe-pipeline
```

## Pull Requests

Open pull requests against `universe`.

Before requesting review:

1. Keep the change inside the issue's path ownership.
2. Fill out the test checklist in the PR description.
3. Include screenshots, logs, or a short demo video when the issue asks for proof.
4. Make sure GitHub Actions has started.

For the mobile epic, avoid touching unrelated areas:

- Mobile scaffold work owns `mobile/` and `.github/workflows/mobile-ci.yml`.
- PWA branding owns `play/public/` and the HTML entry metadata.
- CI/CD work owns `.github/workflows/build-*`, `cd/`, `docs/cicd.md`, and this workflow documentation.

## CI Expectations

General pull requests run the regular WorkAdventure CI workflow.

Mobile pull requests also run `mobile-ci.yml` when they touch `mobile/**`.

For merges into `universe`, the Universe image workflow builds Docker images for GHCR. The image test workflow then starts those images with the production compose stack and runs Playwright tests.

## Local Development

Use the repository's existing local setup for WorkAdventure development. The issue-specific CI/CD work does not require changing application runtime behavior.

For workflow-only or documentation-only changes, local verification can be limited to:

```bash
git diff --check
```

For workflow YAML changes, also review the changed files in GitHub's Actions tab after opening the PR because GitHub validates workflow syntax when the PR is created.

## Deployment Flow

The current Universe deployment flow is:

1. PR targets `universe`.
2. CI validates the PR.
3. Maintainers merge the PR.
4. `build-universe-images.yml` builds and pushes Universe images.
5. `test-universe-images.yml` verifies those images.
6. The hosting platform pulls the approved GHCR image tags.

The repository does not currently include a direct production SSH deployment job for `universe.bawes.net`.

## Checking Deployment Status

After a merge to `universe`:

1. Open the repository's Actions tab.
2. Check `Build Universe Images for Coolify`.
3. Check `Test Universe Images`.
4. Confirm the deployment platform has pulled the expected tag.
5. Smoke test `https://universe.bawes.net`.

If deployment fails, use the previous known-good `universe-<sha>` image tag as the rollback target.

