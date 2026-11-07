# Universe CI/CD Pipeline

This document describes the current CI/CD flow for the `universe` branch and how it hands off deployment artifacts for `universe.bawes.net`.

## Overview

The Universe branch uses a separate build and test path from the upstream WorkAdventure `master` and `develop` workflows.

| Stage | Workflow | Trigger | Purpose |
| --- | --- | --- | --- |
| PR validation | `.github/workflows/continuous_integration.yml` | Pull requests | Runs the regular WorkAdventure build, typecheck, lint, formatting, and test jobs. |
| Mobile validation | `.github/workflows/mobile-ci.yml` | Pull requests and pushes to `universe` that touch `mobile/**` | Validates the Capacitor config and Fastlane setup introduced for the mobile app work. |
| Universe image build | `.github/workflows/build-universe-images.yml` | Pushes to `universe` that touch application paths, or manual dispatch | Builds the Universe Docker images and pushes them to GitHub Container Registry. |
| Universe image test | `.github/workflows/test-universe-images.yml` | Successful Universe image build, or manual dispatch | Starts the built images with the production compose stack plus test overrides and runs the existing Playwright suite. |

The legacy `.github/workflows/build-test-and-deploy.yml` workflow is still present for the upstream `master` and `develop` branches. It does not deploy the `universe` branch.

## Pull Request Validation

Every pull request runs the general WorkAdventure CI workflow because `continuous_integration.yml` listens to all `pull_request` events.

The workflow validates the main service areas:

- `play`: dependency install, protobuf generation, build, iframe API build, typecheck, Svelte check, lint, formatting, and unit tests.
- `back`: dependency install, protobuf generation, typecheck, lint, tests, and formatting.
- `uploader`: dependency install, lint, and tests.
- shared libraries such as `libs/map-editor`.

Mobile-specific changes are covered by `mobile-ci.yml` when the PR touches `mobile/**` or the workflow file itself.

## Build Stage

`build-universe-images.yml` builds Universe-specific images from the `*.universe` Dockerfiles and pushes them to GHCR under the repository owner's namespace:

- `ghcr.io/BAWES-Universe/play-universe`
- `ghcr.io/BAWES-Universe/back-universe`
- `ghcr.io/BAWES-Universe/map-storage-universe`
- `ghcr.io/BAWES-Universe/uploader-universe`
- `ghcr.io/BAWES-Universe/discord-bot-universe`
- `ghcr.io/BAWES-Universe/bot-server-universe`

The workflow publishes branch and commit-based tags through `docker/metadata-action`. For the `universe` branch, consumers should expect the branch tag and SHA-prefixed tag, for example:

- `universe`
- `universe-<sha>`

If a deployment tool expects a fixed tag such as `latest`, confirm the tag exists in GHCR before wiring production to it.

## Test Stage

`test-universe-images.yml` runs after `build-universe-images.yml` completes successfully.

It:

1. Checks out the repository.
2. Installs the Playwright test dependencies.
3. Creates a production-style `.env` file under `contrib/docker`.
4. Selects the Docker tag from the triggering build branch, falling back to `universe`.
5. Starts the stack with:
   - `docker-compose.prod.yaml`
   - `docker-compose.universe.yaml`
   - `tests/docker-compose.test.yaml`
6. Uploads the test map.
7. Runs `npm run test-single-domain-install` in two Playwright shards.
8. Uploads logs and Playwright reports when tests fail.

## Deployment Handoff

The current repository flow builds and verifies deployable images, then hands deployment off to the hosting layer. The docs under `.github/workflows/README-UNIVERSE.md` describe using Coolify with GHCR images.

There is currently no SSH deployment job or direct `universe.bawes.net` production deployment job in the issue-owned workflow files. Before adding one, confirm:

- the target host or deployment platform;
- the required GitHub secrets;
- the health check URL for `universe.bawes.net`;
- whether deployment should be automatic on every `universe` merge or manually approved.

Until those are confirmed, the safest production path is:

1. Merge into `universe`.
2. Wait for Universe images to build.
3. Wait for Universe image tests to pass.
4. Let Coolify, Watchtower, or the configured deployment platform pull the approved GHCR tags.
5. Verify `https://universe.bawes.net` manually after deployment.

## Rollback

Rollback depends on the deployment platform because this repository currently stops at the image handoff.

Recommended rollback process:

1. Open the GHCR package for the affected service.
2. Identify the previous known-good `universe-<sha>` image tag.
3. Update the deployment platform to that tag.
4. Redeploy the service.
5. Confirm `universe.bawes.net` and service health checks respond.
6. Record the rolled-back SHA and reason in the incident or deployment notes.

If automatic deployment is added later, add a `workflow_dispatch` rollback job that accepts a known-good image tag and updates the production deployment target.

