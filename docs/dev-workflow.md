# BAWES Universe Developer Workflow

This document describes the day-to-day development loop for the `universe` branch.

## Branching

Use short branch prefixes that describe the kind of work:

- `feat/<topic>` for new product or infrastructure behavior.
- `fix/<topic>` for bug fixes.
- `chore/<topic>` for maintenance-only changes.

Create branches from `universe` for Universe-specific work:

```bash
git checkout universe
git pull --ff-only origin universe
git checkout -b feat/my-universe-change
```

## Pull Requests

Open pull requests against `universe`.

Every pull request to `universe` should keep unrelated upstream WorkAdventure changes out of scope. The normal validation path is:

1. Update the code, docs, workflow, or mobile files required by the task.
2. Run the smallest relevant local checks before pushing.
3. Open a PR against `universe`.
4. Wait for GitHub Actions and review feedback.
5. Address review comments with small follow-up commits.

When `mobile/**` changes, the mobile validation workflow checks the Capacitor config and Fastlane setup. Web/backend changes are covered by the existing WorkAdventure CI jobs.

## Local Docker Smoke Test

For production-image smoke tests, use the Universe compose override with the production compose file:

```bash
cd contrib/docker
export GITHUB_REPOSITORY_OWNER=BAWES-Universe
export VERSION=universe
docker compose -f docker-compose.prod.yaml -f docker-compose.universe.yaml up -d
docker compose -f docker-compose.prod.yaml -f docker-compose.universe.yaml ps
```

The automated image-test workflow adds `tests/docker-compose.test.yaml` and runs the WorkAdventure Playwright single-domain install tests after the images are published.

## Merge And Deploy

After a PR is merged into `universe`:

1. `Build Universe Images for Coolify` builds the `*-universe` GHCR images.
2. `Test Universe Images` checks out the same commit and tests those images.
3. `Deploy Universe` calls `UNIVERSE_DEPLOY_WEBHOOK` if the secret is configured.

Manual image tests are safe by default. A manual `workflow_dispatch` run only deploys when the `deploy` input is explicitly set to `true`.

## Checking Deploy Status

Check GitHub first:

- `Build Universe Images for Coolify` completed successfully.
- `Test Universe Images` completed successfully.
- `Deploy Universe` either called the webhook or logged the notice that `UNIVERSE_DEPLOY_WEBHOOK` is not configured.

Then check the production host:

- Coolify or the host deployment log shows a rollout for the new `universe` or `universe-<sha>` tag.
- `https://universe.bawes.net` responds.
- The backend health endpoint used by the host responds successfully.

## Rollback

The image workflow publishes both the moving `universe` tag and immutable `universe-<sha>` tags. Prefer immutable tags for rollback records.

To roll back from the production host:

1. Find the last known good `universe-<sha>` tag in GHCR or the previous successful GitHub Actions run.
2. In Coolify or the host service configuration, point each runtime service back to the matching tag:
   - `ghcr.io/<owner>/play-universe:universe-<sha>`
   - `ghcr.io/<owner>/back-universe:universe-<sha>`
   - `ghcr.io/<owner>/map-storage-universe:universe-<sha>`
   - `ghcr.io/<owner>/uploader-universe:universe-<sha>`
3. Trigger the host deploy from Coolify or the configured host webhook.
4. Confirm the site and backend health endpoint after the rollout.

Do not add a GitHub-hosted SSH rollback job until the production SSH secrets, rollback path, and receiver behavior are documented and tested. The current GitHub-side contract is a webhook handoff, so tag selection remains host-side.
