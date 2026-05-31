# BAWES Universe CI/CD

This document audits the Universe build, test, and deployment path for the `universe` branch.

## Summary

BAWES Universe uses a dedicated GitHub Actions path for the `universe` branch:

1. Pull requests to `universe` run the upstream WorkAdventure CI plus the mobile shell validation when `mobile/**` changes.
2. Pushes to `universe` build Universe Docker images and publish them to GitHub Container Registry.
3. A follow-up workflow tests the published Universe images with the production docker-compose test stack.
4. After the image tests pass, GitHub Actions can trigger the production host through `UNIVERSE_DEPLOY_WEBHOOK`.

The repository does not currently contain SSH host, user, or key secrets for a direct production deploy from GitHub Actions. Adding a blind SSH deploy job would create an untestable deployment path, so the safe handoff is to publish and test immutable images, then notify the production host through a deploy webhook when that secret is configured.

## Workflow Inventory

### `.github/workflows/continuous_integration.yml`

Runs on all pull requests and on pushes to `master` and `develop`.

Important validation jobs:

- `continuous-integration-play`: installs the `workadventure-play` workspace, builds `play`, runs typecheck, Svelte check, lint, prettier, and unit tests.
- `continuous-integration-back`: installs `workadventureback`, builds messages, then runs typecheck, lint, unit tests, and prettier in `back`.
- `continuous-integration-uploader`: runs lint and tests in `uploader`.
- `continuous-integration-map-storage`: builds messages, then runs typecheck, lint, tests, and prettier in `map-storage`.
- `continuous-integration-end-to-end-tests`: validates the end-to-end test package and Play API typings.

This workflow is the PR validation gate for the web/backend services. It does not deploy.

### `.github/workflows/mobile-ci.yml`

Runs on pull requests and pushes to `universe` that touch `mobile/**` or the workflow itself.

Validation jobs:

- `validate`: checks that `mobile/capacitor.config.js` is loadable and has the required app id and server URL.
- `fastlane-setup`: installs Ruby dependencies from `mobile/Gemfile` and verifies Fastlane is available.

`npx cap doctor` is intentionally informational because the scaffold stage does not commit native `android/` or `ios/` folders.

### `.github/workflows/build-universe-images.yml`

Runs on pushes to `universe` when service, shared library, message, Universe compose, Universe script, or workflow files change. It can also be launched manually.

Image build jobs:

- `build-play`: builds `play/Dockerfile.universe` and pushes `ghcr.io/<owner>/play-universe`.
- `build-back`: builds `back/Dockerfile.universe` and pushes `ghcr.io/<owner>/back-universe`.
- `build-map-storage`: builds `map-storage/Dockerfile.universe` and pushes `ghcr.io/<owner>/map-storage-universe`.
- `build-uploader`: builds `uploader/Dockerfile.universe` and pushes `ghcr.io/<owner>/uploader-universe`.
- `build-discord-bot`: builds `discord-bot/Dockerfile` and pushes `ghcr.io/<owner>/discord-bot-universe`.
- `build-bot-server`: builds `bots/Dockerfile` and pushes `ghcr.io/<owner>/bot-server-universe`.

The issue mentions `pusher`, but this fork does not have a standalone `pusher/` package or Dockerfile. The browser-facing service is built through `play`.

The workflow publishes branch tags such as `universe` and SHA tags such as `universe-<sha>`. It only publishes `latest` when `universe` is the repository default branch, so manual tests should default to the `universe` tag instead of `latest`.

### `.github/workflows/test-universe-images.yml`

Runs after `Build Universe Images for Coolify` completes successfully on `universe`, or manually with a selected Docker tag.

The workflow:

- Checks out the exact commit that triggered the build workflow.
- Installs the Playwright test package and Room API client dependencies.
- Starts the production docker-compose stack with `contrib/docker/docker-compose.universe.yaml` image overrides.
- Runs `npm run test-single-domain-install` in two shards.
- Uploads the Playwright report and docker-compose logs on failure.
- Runs a single `deploy-universe` job after all shards pass. This job calls `UNIVERSE_DEPLOY_WEBHOOK` when configured and otherwise exits successfully with a notice.

Manual runs are test-only by default. To intentionally deploy after a manual image test, launch the workflow with the `deploy` input set to `true`.

### `.github/workflows/build-test-and-deploy.yml`

This is the upstream WorkAdventure build/test/deploy workflow for `master`, `develop`, releases, and labeled pull requests. It builds the upstream `workadventure/*` images, runs production-like tests, can trigger GitLab SaaS tests, and can deploy preview environments with Helm.

It is not the Universe production pipeline because it does not run on pushes to `universe` and it publishes upstream image names instead of the `*-universe` GHCR images. Keeping Universe deployment in the dedicated workflows avoids accidental deployment to upstream WorkAdventure infrastructure.

## Deployment Contract

The GitHub-side contract for `universe.bawes.net` is:

- `ghcr.io/<owner>/play-universe:universe`
- `ghcr.io/<owner>/back-universe:universe`
- `ghcr.io/<owner>/map-storage-universe:universe`
- `ghcr.io/<owner>/uploader-universe:universe`

`discord-bot-universe` and `bot-server-universe` are built by the Universe image workflow for auxiliary bot deployments, but they are intentionally excluded from this `universe.bawes.net` production contract because the current `contrib/docker/docker-compose.universe.yaml` runtime override only wires `play-universe`, `back-universe`, `map-storage-universe`, and `uploader-universe`.

The production host should watch those tags or the matching `universe-<sha>` tags. A typical Coolify setup should point each service to the GHCR image, keep the runtime environment variables in Coolify, and expose a deploy webhook saved in GitHub as `UNIVERSE_DEPLOY_WEBHOOK`.

If the project later wants direct SSH deployment from GitHub Actions instead of the webhook handoff, add it as a separate explicit job after these secrets exist:

- `UNIVERSE_DEPLOY_HOST`
- `UNIVERSE_DEPLOY_USER`
- `UNIVERSE_DEPLOY_KEY`
- `UNIVERSE_DEPLOY_PATH`

Do not add a production SSH job before those secrets and rollback steps are documented.

## Rollback Contract

The build workflow publishes immutable `universe-<sha>` tags in addition to the moving `universe` branch tag. Rollbacks should use those immutable tags so the production host can return to a known image set.

Current rollback procedure:

1. Identify the last successful `Build Universe Images for Coolify` run before the bad deploy.
2. Copy its commit SHA and use the matching `universe-<sha>` tag for each production service.
3. In Coolify or the host deployment configuration, point these runtime images back to that tag:
   - `ghcr.io/<owner>/play-universe:universe-<sha>`
   - `ghcr.io/<owner>/back-universe:universe-<sha>`
   - `ghcr.io/<owner>/map-storage-universe:universe-<sha>`
   - `ghcr.io/<owner>/uploader-universe:universe-<sha>`
4. Trigger the host deploy through Coolify or the configured host webhook.
5. Confirm `universe.bawes.net` and the backend health endpoint after the rollout.

The GitHub workflow intentionally does not include a blind SSH rollback job yet. The repository does not currently define production SSH secrets or a tested rollback script, and the webhook contract does not currently accept a tag payload. Once the production receiver supports tag-specific deploys, a separate `workflow_dispatch` rollback job can be added to validate the requested tag and call that receiver.

## Operational Checklist

Before merging into `universe`:

- CI passes for touched web/backend packages.
- `mobile-ci.yml` passes when `mobile/**` is touched.
- No unrelated service files are changed.
- For daily development steps, use `docs/dev-workflow.md`.

After merging into `universe`:

- `Build Universe Images for Coolify` completes successfully.
- `Test Universe Images` runs against the same triggering commit and the `universe` image tag.
- GHCR contains the updated `*-universe:universe` images.
- `Deploy Universe` either calls `UNIVERSE_DEPLOY_WEBHOOK` successfully after a `workflow_run`, or after a manual `workflow_dispatch` only when the `deploy` input is set to `true`.
- The production host reports a successful rollout of the new image set after the webhook is configured.
- If rollback is needed, redeploy the last known good `universe-<sha>` image set from the production host.

## Audit Notes

- `test-universe-images.yml` now checks out the triggering build commit on `workflow_run`, which keeps the test compose files aligned with the images under test.
- Manual Universe image tests default to the `universe` tag because `latest` is not guaranteed unless `universe` is the default branch.
- `build-universe-images.yml` now also triggers when the Universe compose override or Universe helper scripts change.
- `test-universe-images.yml` now has a post-test `deploy-universe` job that triggers a configured production deploy webhook exactly once after all image-test shards pass.
- The deploy handoff is protected with the `production` GitHub Environment, serialized through the `deploy-universe` concurrency group, disabled by default for manual test dispatches, and bounded with curl timeout/retry flags.
- `docs/dev-workflow.md` now documents branch naming, PR flow, local docker-compose smoke tests, deploy status checks, and host-side rollback.
