# BAWES Universe Developer Workflow

This guide explains the day-to-day engineering loop for contributing to `BAWES-Universe/workadventure-universe`: branch naming, running locally with Docker Compose, validating changes, previewing PRs on `dev.bawes.net`, and shipping to `universe.bawes.net`.

---

## 1. Branching Model & Naming Conventions

- **`universe`** is the production branch deployed to `https://universe.bawes.net`.
- **`universe-develop`** is the integration branch deployed to `https://dev.bawes.net` whenever no open pull request holds the `on-dev` label.
- Create feature and fix branches from `universe` (or `universe-develop` when specified by the issue) using a descriptive prefix:
  - `feat/<short-slug>` — new features or capabilities (e.g., `feat/cicd-universe-pipeline`)
  - `fix/<short-slug>` — bug fixes (e.g., `fix/mobile-webview-permissions`)
  - `chore/<short-slug>` — maintenance, dependency updates, or documentation

```bash
git checkout universe
git pull origin universe
git checkout -b feat/your-feature-name
```

> **Note:** Never name a branch `universe`, `latest`, or `universe-<7-hex-chars>`, as those tag names are reserved for production images in GHCR and are rejected by `dev-server.yml`.

---

## 2. Running Locally with `docker-compose.yaml`

### Prerequisites

- Docker Engine & Docker Compose (`docker compose version`)
- Node.js 20+ / 22+ and `npm` (when running individual workspace checks outside Docker)
- `protoc` 3.x (when regenerating gRPC/protobuf definitions in `messages/` locally)

### Start the Local Stack

From the repository root:

```bash
docker compose up -d
```

Watch logs for a specific service (`play`, `back`, `map-storage`, `uploader`, `icon`, `redis`):

```bash
docker compose logs -f play back
```

Once the containers finish booting, open `http://play.workadventure.localhost` in your browser.

To stop the local environment:

```bash
docker compose down
```

### Local Type Checks, Linting & Unit Tests

Before pushing a branch, run the checks corresponding to the workspaces you touched:

```bash
# Generate protobuf types (required before typechecking play, back, map-storage, or bots)
npm --prefix messages run ts-proto

# Play (frontend + pusher)
npm --prefix play run typecheck
npm --prefix play run lint
npm --prefix play run pretty-check
npm --prefix play test

# Back
npm --prefix back run typecheck
npm --prefix back run lint
npm --prefix back test

# Bots
npm --prefix bots test

# Voice Worker
npm --prefix voice-worker run lint
npm --prefix voice-worker run build

# Mobile shell (Capacitor)
node -e "const c = require('./mobile/capacitor.config.js'); console.log(c.appId, c.server.url);"

# Check for whitespace / patch formatting issues
git diff --check
```

---

## 3. Pull Request Flow & Previewing on `dev.bawes.net`

1. **Open a Pull Request** targeting `universe` (or `universe-develop` if instructed by the issue).
2. **Automated PR Checks**:
   - `.github/workflows/continuous_integration.yml` runs TypeScript type checks, ESLint, Prettier, and unit tests.
   - `.github/workflows/mobile-ci.yml` runs if `mobile/**` was modified.
   - `.github/workflows/voice-worker-ci.yml` runs if `voice-worker/**` was modified.
3. **Previewing a PR on `https://dev.bawes.net` (`on-dev` label)**:
   - Add the `on-dev` label to an internal PR to trigger `.github/workflows/dev-server.yml`.
   - The workflow builds your branch's images, switches the Coolify dev applications (`https://dev.bawes.net`) to your branch tag (`<branch>-<sha7>`), and comments on the PR with a switch receipt.
   - Removing `on-dev`, merging, or closing the PR automatically returns `dev.bawes.net` to `universe-develop`.

---

## 4. Merge to `universe` & Auto-Deploy

When a pull request is merged into `universe`:

1. **`build-universe-images.yml`** automatically:
   - Computes the next semantic version (`vX.Y.Z`) in `get-version`.
   - Builds and pushes all 7 Universe Docker images (`play`, `back`, `map-storage`, `uploader`, `discord-bot`, `bot-server`, `voice-worker`) to `ghcr.io/bawes-universe/*-universe` tagged with `universe`, `universe-<sha7>`, and `latest`.
   - Creates the Git tag `vX.Y.Z`, GitHub Release, and Sentry release.
   - Deploys all services sequentially to Coolify (`back` → `map-storage` → `play` → `voice-worker` → `bot-server` → `discord-bot` → `uploader`).
   - Verifies production health on `https://universe.bawes.net/ping`, `https://universe.bawes.net/ping-backs`, and `https://universe.bawes.net/server.json`.
   - Records the deployment in GitHub Deployments (`production`) and Sentry.
2. **`test-universe-images.yml`** triggers via `workflow_run` once the image build completes and executes the 2-shard Playwright E2E test suite against the newly published GHCR images.

---

## 5. Checking Deploy Status & Rolling Back

### Check Live Production Status

1. **GitHub Actions**: Inspect the latest run of **Build Universe Images for Coolify** under the **Actions** tab (`https://github.com/BAWES-Universe/workadventure-universe/actions/workflows/build-universe-images.yml`).
2. **GitHub Deployments**: Check the `production` environment history on the repository's **Deployments** page.
3. **Live Health Endpoints**:
   ```bash
   # Front / pusher HTTP liveness (expects "pong")
   curl -fsS https://universe.bawes.net/ping

   # Pusher -> Back gRPC health check (expects "pong")
   curl -fsS https://universe.bawes.net/ping-backs

   # Server metadata
   curl -fsS https://universe.bawes.net/server.json | jq .
   ```

### Roll Back a Production Release

To roll `https://universe.bawes.net` back to a previous release tag (e.g. `v0.3.18`) or commit image tag (e.g. `universe-15a5ef8`):

```bash
gh workflow run build-universe-images.yml --ref universe -f rollback_tag=v0.3.18
```

Or trigger **Actions → Build Universe Images for Coolify → Run workflow** on `universe` and enter the target tag in `rollback_tag`. See [`docs/cicd.md`](./cicd.md#stage-4--rollback-procedure) for full details.
