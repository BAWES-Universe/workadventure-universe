# BAWES Universe CI/CD Pipeline

This document describes the Continuous Integration and Continuous Deployment (CI/CD) architecture for the `universe` and `universe-develop` branches of `BAWES-Universe/workadventure-universe`.

---

## Pipeline Overview

```
Pull Request ──► Stage 1: PR Validation
                 ├── continuous_integration.yml (Play, Back, Pusher, Map-Storage, Uploader, Bots, Libs)
                 ├── voice-worker-ci.yml        (Voice worker lint, build, Vitest + LiveKit)
                 └── mobile-ci.yml              (Capacitor config + Fastlane validation when mobile/** changes)
                        │
                        ▼ (merge to `universe`)
Push to `universe` ──► Stage 2: Version & Build (build-universe-images.yml)
                       ├── get-version: Calculates next semver (vX.Y.Z) from VERSION + git tags
                       └── Builds & pushes 7 Docker images to GHCR (ghcr.io/bawes-universe/*-universe)
                              │
                              ├──► Stage 2b: E2E Image Verification (test-universe-images.yml)
                              │    └── 2-shard Playwright suite against docker-compose.prod.yaml + docker-compose.universe.yaml
                              │
                              ▼
                       Stage 3: Release & Deploy (build-universe-images.yml)
                       ├── release: Creates git tag vX.Y.Z, GitHub Release, and Sentry release
                       ├── deploy: Sequential Coolify rollout (back → map-storage → play → voice-worker → bot-server → discord-bot → uploader)
                       ├── health check: Verifies https://universe.bawes.net/ping, /ping-backs, and /server.json
                       └── records GitHub production deployment + Sentry deploy
                              │
                              ▼ (on incident / manual trigger)
Manual Dispatch ──► Stage 4: Rollback (build-universe-images.yml `rollback` job)
                    ├── Resolves release tag (vX.Y.Z) or image tag (universe-<sha7>)
                    ├── Verifies target images in GHCR and retags :universe + :latest
                    └── Redeploys all Coolify services in dependency order + runs post-rollback health checks
```

---

## Workflow Inventory

### Active Universe Workflows

| Workflow File | Trigger | Purpose |
|---|---|---|
| [`.github/workflows/continuous_integration.yml`](../.github/workflows/continuous_integration.yml) | Every `push` and `pull_request` | Runs unit tests, TypeScript type checks, ESLint, and Prettier checks across `play` (including `pusher`), `back`, `uploader`, `messages`, `map-storage`, `bots`, shared `libs/*`, desktop apps, and E2E test lint. |
| [`.github/workflows/voice-worker-ci.yml`](../.github/workflows/voice-worker-ci.yml) | `push`/`pull_request` touching `voice-worker/**` | Runs ESLint, TypeScript build, and Vitest integration tests against a local `livekit/livekit-server` container, verifying zero skipped tests. |
| [`.github/workflows/mobile-ci.yml`](../.github/workflows/mobile-ci.yml) | `push`/`pull_request` to `universe` touching `mobile/**` | Validates `mobile/capacitor.config.js` (`appId`, `server.url`), runs `npx @capacitor/cli doctor`, and verifies Ruby 3.2 + Fastlane Bundler setup. |
| [`.github/workflows/build-universe-images.yml`](../.github/workflows/build-universe-images.yml) | `push` to `universe` or `universe-develop` (app paths), or `workflow_dispatch` | Computes release version, builds and pushes all 7 Universe Docker images to GHCR, tags GitHub/Sentry releases on `universe`, deploys `universe-develop` to `dev.bawes.net` (when free), deploys `universe` to `universe.bawes.net` via Coolify, runs post-deploy health checks, and provides manual `rollback_tag` dispatch. |
| [`.github/workflows/test-universe-images.yml`](../.github/workflows/test-universe-images.yml) | `workflow_run` after `Build Universe Images for Coolify` completes on `universe`, or `workflow_dispatch` | Boots the production Compose stack (`contrib/docker/docker-compose.prod.yaml` + `docker-compose.universe.yaml` + `tests/docker-compose.test.yaml`) using the built GHCR images and runs the 2-shard Playwright E2E suite. |
| [`.github/workflows/dev-server.yml`](../.github/workflows/dev-server.yml) | `pull_request` (`labeled`, `unlabeled`, `synchronize`, `closed` with `on-dev`) or `workflow_dispatch` | Builds a PR branch (or uses an existing GHCR tag) and switches `https://dev.bawes.net` to run that PR's images; returns dev to `universe-develop` when unlabeled, merged, or closed. |
| [`.github/workflows/dev-server-switch.yml`](../.github/workflows/dev-server-switch.yml) | `workflow_call` from `dev-server.yml` and `build-universe-images.yml` | Re-points the Coolify dev applications (`DEV_COOLIFY_*_UUID`) to the requested image tag, waits for each deployment to finish, cleans unused Docker images on the dev host, and posts a receipt comment on the PR. |
| [`.github/workflows/prune-images.yml`](../.github/workflows/prune-images.yml) | Scheduled / manual | Prunes stale container package versions in GHCR. |
| [`.github/workflows/codeql-analysis.yml`](../.github/workflows/codeql-analysis.yml) | `push`/`pull_request` to `master`/`develop`, weekly schedule | Runs GitHub CodeQL static security analysis for JavaScript/TypeScript. |

### Legacy Upstream WorkAdventure Workflows

These workflows are inherited from upstream WorkAdventure (`master` / `develop`) and do **not** deploy `universe`:

| Workflow File | Upstream Scope | Notes |
|---|---|---|
| [`.github/workflows/build-test-and-deploy.yml`](../.github/workflows/build-test-and-deploy.yml) | `push` to `master`, `develop` | Upstream multi-arch build and Kubernetes deployment (`cd/`). Guarded by `github.repository_owner == 'workadventure'` for registry pushes. |
| [`.github/workflows/build-multi-arch-image.yml`](../.github/workflows/build-multi-arch-image.yml) | Reusable workflow called by `build-test-and-deploy.yml` | Builds `amd64`/`arm64` images from upstream Dockerfiles (`play/Dockerfile`, `back/Dockerfile`, etc.). |
| [`.github/workflows/build-single-image.yml`](../.github/workflows/build-single-image.yml) | Reusable workflow | Single-architecture helper used by upstream workflows. |
| [`.github/workflows/release-chart.yml`](../.github/workflows/release-chart.yml) | Helm chart release | Publishes upstream Kubernetes Helm charts (`charts/`). |
| [`.github/workflows/cleanup.yml`](../.github/workflows/cleanup.yml) | PR close | Cleans up upstream Kubernetes preview namespaces. |

---

## Stage-by-Stage Pipeline Reference

### Stage 1 — PR Validation (Every PR to `universe`)

Every pull request targeting `universe` runs:

1. **`continuous_integration.yml`**:
   - **`continuous-integration-play`**: Installs dependencies, compiles protobuf definitions (`messages`), builds `iframe-api`, runs `typesafe-i18n`, `npm run build`, `npm run typecheck` (covering both `play/src/front` and `play/src/pusher`), `npm run svelte-check`, `npm run lint`, `npm run pretty-check`, and `npm run test` (Vitest).
   - **`continuous-integration-back`**: Compiles protobuf messages and runs `typecheck`, `lint`, `test`, and `pretty-check` in `back/`.
   - **`continuous-integration-uploader`**: Runs `lint`, `test`, and `pretty-check` in `uploader/`.
   - **`continuous-integration-messages`**: Verifies protobuf generation in `messages/`.
   - **`continuous-integration-map-editor` / `math-utils` / `store-utils` / `shared-utils` / `room-api-client-js`**: Builds, typechecks, lints, and tests shared libraries in `libs/`.
   - **`continuous-integration-bots`**: Compiles protobufs and runs Vitest in `bots/`.
   - **`continuous-integration-end-to-end-tests`**: Builds typings and lints the Playwright suite in `tests/`.
2. **`voice-worker-ci.yml`** (when `voice-worker/**` changes):
   - Lints, compiles TypeScript, boots `livekit/livekit-server:v1.8.4`, and runs Vitest with a strict check that zero tests are skipped.
3. **`mobile-ci.yml`** (when `mobile/**` changes):
   - Verifies `mobile/capacitor.config.js` and Fastlane Bundler installation.

### Stage 2 — Version Calculation & GHCR Image Build

When a commit is pushed to `universe` or `universe-develop` (touching `play/**`, `back/**`, `map-storage/**`, `uploader/**`, `discord-bot/**`, `bots/**`, `voice-worker/**`, `libs/**`, `messages/**`, or `.github/workflows/build-universe-images.yml`):

1. **Concurrency Lock**:
   - `concurrency.group: ${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: false` serializes runs per branch so concurrent merges to `universe` never race on version calculation or cancel an in-flight release between `git push origin "$VERSION"` and `gh release create`.
2. **`get-version` Job**:
   - Reads the `VERSION` file and compares it against the highest canonical `vMAJOR.MINOR.PATCH` Git tag (filtering out prerelease suffixes via `awk '/^v[0-9]+\.[0-9]+\.[0-9]+$/'`).
   - Computes `new_version` (bumping `PATCH + 1` if `VERSION` matches or lags behind the latest tag, or using `VERSION` directly when manually bumped ahead).
   - Computes `release_version` baked into the images via `ARG RELEASE_VERSION`:
     - On `push` to `refs/heads/universe`: `v<new_version>`
     - On any other ref or `workflow_dispatch`: `<branch>@<sha7>`
3. **Service Build Jobs (`build-*`)**:
   - Builds and pushes 7 images to `ghcr.io/bawes-universe/<service>-universe`:
     - `play-universe` (`./play/Dockerfile.universe`)
     - `back-universe` (`./back/Dockerfile.universe`)
     - `map-storage-universe` (`./map-storage/Dockerfile.universe`)
     - `uploader-universe` (`./uploader/Dockerfile.universe`)
     - `discord-bot-universe` (`./discord-bot/Dockerfile`)
     - `bot-server-universe` (`./bots/Dockerfile`, depends on `build-play`)
     - `voice-worker-universe` (`./voice-worker/Dockerfile`, decoupled from `release.needs` so a voice-worker build failure never blocks a core game release)
   - Each image is tagged by `docker/metadata-action@v6` with:
     - Branch tag: `universe` (or `universe-develop`)
     - Immutable commit SHA tag: `universe-<sha7>` (or `universe-develop-<sha7>`)
     - `latest` (enabled only on the default branch `universe`)

### Stage 3 — Release, Coolify Deployment & Health Check

1. **`release` Job** (runs only on `push` to `refs/heads/universe` after `build-play`, `build-back`, `build-map-storage`, `build-uploader`, `build-discord-bot`, and `build-bot-server` succeed):
   - Creates and pushes the Git tag `v<new_version>`.
   - Creates the GitHub Release with auto-generated release notes (`gh release create`).
   - Registers the release and commit set across the 7 Sentry projects (`bawes-co` org).
2. **`deploy` Job** (runs when `needs.release.outputs.created == 'true'`):
   - Sequentially triggers Coolify deployments (`POST ${COOLIFY_BASE}/api/v1/deploy?uuid=${uuid}`) and polls `GET ${COOLIFY_BASE}/api/v1/deployments/${deployment}` every 10 seconds (up to 20 minutes per service) until `.status == "finished"`.
   - **Strict Dependency Order**:
     1. `back` (`COOLIFY_BACK_UUID`)
     2. `map-storage` (`COOLIFY_MAP_STORAGE_UUID`)
     3. `play` (`COOLIFY_PLAY_UUID` — skipped and marked failed if either `back` or `map-storage` failed, preventing a new `play` from starting against an older backend)
     4. `voice-worker` (`COOLIFY_VOICE_WORKER_UUID` — non-blocking warning on failure so voice bots fall back to text without halting the release)
     5. `bot-server` (`COOLIFY_BOT_SERVER_UUID`)
     6. `discord-bot` (`COOLIFY_DISCORD_BOT_UUID`)
     7. `uploader` (`COOLIFY_UPLOADER_UUID`)
3. **Post-Deploy Health Check (`Verify universe.bawes.net health after deploy`)**:
   - Polls `https://universe.bawes.net` for up to 2 minutes (10s interval) to verify:
     - `GET https://universe.bawes.net/ping` returns HTTP `200` with body `pong` (confirming `play`/pusher HTTP server readiness).
     - `GET https://universe.bawes.net/ping-backs` returns HTTP `200` with body `pong` (confirming `play`/pusher can reach all `back` servers over gRPC).
     - `GET https://universe.bawes.net/server.json` returns HTTP `200` with valid `.domain` and `.version` JSON metadata.
   - Only after all health checks pass does the workflow record the `production` deployment status on GitHub and mark the release deployed in Sentry.

### Stage 4 — Rollback Procedure

Production can be rolled back to any previous release or immutable `universe-<sha7>` build without rebuilding Docker layers:

#### Option A — Automated GitHub Actions Rollback (`workflow_dispatch`)

1. Open **Actions → Build Universe Images for Coolify → Run workflow**.
2. Keep **Use workflow from**: `Branch: universe`.
3. Fill **`rollback_tag`** with either:
   - A release version tag (for example `v0.3.18`), which the workflow resolves via Git tags to its commit `universe-<sha7>`, **or**
   - An immutable production image tag (for example `universe-15a5ef8`).
4. Click **Run workflow** (or run from the CLI):
   ```bash
   gh workflow run build-universe-images.yml --ref universe -f rollback_tag=v0.3.18
   ```
5. What the `rollback` job does:
   - Skips `get-version` and all `build-*` jobs.
   - Resolves `rollback_tag` to the immutable `universe-<sha7>` tag.
   - Inspects GHCR via `docker buildx imagetools inspect` to confirm all 6 core service images (`back`, `map-storage`, `play`, `bot-server`, `discord-bot`, `uploader`) exist for `universe-<sha7>` before modifying any tag.
   - Retags `ghcr.io/bawes-universe/<service>-universe:universe` and `:latest` to point to `universe-<sha7>` using `docker buildx imagetools create` (preserving Coolify's standard `:universe` / `:latest` tracking so subsequent normal releases continue to work without manual tag resets).
   - Redeploys all services in Coolify in dependency order (`back` → `map-storage` → `play` → `voice-worker` → `bot-server` → `discord-bot` → `uploader`).
   - Runs the `/ping`, `/ping-backs`, and `/server.json` health checks against `https://universe.bawes.net`.
   - Records the rollback in GitHub Deployments (`production`).

#### Option B — Emergency Coolify UI Rollback

If GitHub Actions is unavailable during an incident:

1. Identify the target `universe-<sha7>` tag from GHCR packages (`https://github.com/orgs/BAWES-Universe/packages`) or recent commits on `universe`.
2. In Coolify, redeploy the services in dependency order (`back`, `map-storage`, `play`, `voice-worker`, `bot-server`, `discord-bot`, `uploader`).
3. Verify recovery with:
   ```bash
   curl -fsS https://universe.bawes.net/ping
   curl -fsS https://universe.bawes.net/ping-backs
   curl -fsS https://universe.bawes.net/server.json | jq .
   ```

---

## Required Secrets and Variables

### Production (`build-universe-images.yml`)

| Name | Type | Description |
|---|---|---|
| `GITHUB_TOKEN` | Built-in token | Pushes images to GHCR (`packages: write`), creates tags/releases (`contents: write`), and records deployments (`deployments: write`). |
| `COOLIFY_BASE` | Secret | Base URL of the Coolify instance managing `universe.bawes.net`. |
| `COOLIFY_TOKEN` | Secret | Coolify API bearer token (requires `read` and `deploy` permissions). |
| `COOLIFY_BACK_UUID` | Secret | Coolify application UUID for `back-universe`. |
| `COOLIFY_MAP_STORAGE_UUID` | Secret | Coolify application UUID for `map-storage-universe`. |
| `COOLIFY_PLAY_UUID` | Secret | Coolify application UUID for `play-universe`. |
| `COOLIFY_VOICE_WORKER_UUID` | Secret | Coolify application UUID for `voice-worker-universe` (optional). |
| `COOLIFY_BOT_SERVER_UUID` | Secret | Coolify application UUID for `bot-server-universe`. |
| `COOLIFY_DISCORD_BOT_UUID` | Secret | Coolify application UUID for `discord-bot-universe`. |
| `COOLIFY_UPLOADER_UUID` | Secret | Coolify application UUID for `uploader-universe`. |
| `SENTRY_AUTH_TOKEN` | Secret | Sentry API token for registering releases and deployments under the `bawes-co` org. |

### Dev Server (`dev-server.yml` & `dev-server-switch.yml`)

| Name | Type | Description |
|---|---|---|
| `DEV_COOLIFY_TOKEN` | Secret | Coolify API token scoped to the `Universe Dev` team (`read`, `write`, `deploy`). |
| `DEV_COOLIFY_BASE` | Variable | Base URL of the Coolify instance for `dev.bawes.net`. |
| `DEV_COOLIFY_BACK_UUID` | Variable | Dev Coolify UUID for `back-universe`. |
| `DEV_COOLIFY_MAP_STORAGE_UUID` | Variable | Dev Coolify UUID for `map-storage-universe`. |
| `DEV_COOLIFY_UPLOADER_UUID` | Variable | Dev Coolify UUID for `uploader-universe`. |
| `DEV_COOLIFY_BOT_SERVER_UUID` | Variable | Dev Coolify UUID for `bot-server-universe`. |
| `DEV_COOLIFY_PLAY_UUID` | Variable | Dev Coolify UUID for `play-universe`. |
| `DEV_COOLIFY_VOICE_WORKER_UUID` | Variable | Dev Coolify UUID for `voice-worker-universe` (optional). |
| `DEV_COOLIFY_SERVER_UUID` | Variable | Dev Coolify host UUID used to trigger post-switch unused image cleanup. |
