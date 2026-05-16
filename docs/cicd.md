# BAWES Universe CI/CD Pipeline

End-to-end reference for how code on the `universe` branch becomes
running services on **universe.bawes.net**.

## TL;DR

```text
PR → universe-ci.yml (typecheck/lint/test)
       │
       └─► merge to `universe`
              │
              ├─► build-universe-images.yml ──► ghcr.io/BAWES-Universe/<svc>-universe:universe(-<sha>)
              │
              ├─► test-universe-images.yml (Playwright on freshly-built images)
              │
              └─► deploy-universe.yml ──► Coolify webhook ──► universe.bawes.net
                                                     │
                                                     └─► /ping health check ──► Discord notify
```

## Pipeline stages

### Stage 1 — PR validation (every PR to `universe`)

| Workflow | What it runs | When |
|---|---|---|
| `universe-ci.yml` | `play`, `back`, `map-storage` typecheck + lint + unit tests | every PR / push to `universe` |
| `mobile-ci.yml`   | mobile/Capacitor checks (added by PR #9)                     | every PR touching `mobile/` |

> **Why a separate `universe-ci.yml`?** The upstream `continuous_integration.yml`
> only triggers on `master` / `develop` / all PRs (upstream branches). It does
> *not* fire on PRs targeting `universe`. We add a focused PR-validation
> workflow rather than editing the upstream file (avoids merge conflicts when
> we sync from `workadventure/workadventure`).

### Stage 2 — Build (merge to `universe`)

`build-universe-images.yml` builds **all six** services in parallel and pushes
to GHCR. Triggered by:

- `push` to `universe` matching `play/**`, `back/**`, `map-storage/**`,
  `uploader/**`, `discord-bot/**`, `bots/**`, `libs/**`, `messages/**`, or the
  workflow file itself.
- `workflow_dispatch` with a service selector for one-off rebuilds.

Tagging strategy (via `docker/metadata-action`):

| Tag                              | Meaning                                |
|----------------------------------|----------------------------------------|
| `universe`                       | "current" pointer (Coolify pulls this) |
| `universe-<short-sha>`           | immutable pointer per commit           |
| `latest`                         | only when default branch (no-op here)  |

Images live at `ghcr.io/BAWES-Universe/<service>-universe`.

### Stage 3 — Test (post-build)

`test-universe-images.yml` runs on `workflow_run: completed` of Stage 2. It
pulls the freshly-built `universe`-tagged images, brings up
`docker-compose.universe.yaml`, and runs WorkAdventure's existing Playwright
suite (`npm run test-single-domain-install`) in 2 shards.

### Stage 4 — Deploy (post-build, success-only)

`deploy-universe.yml` runs on `workflow_run: completed` of Stage 3 (test) and
gates on `conclusion == 'success'`, so we never deploy an image that failed
the Playwright suite. Steps:

1. POST `{ "sha": "<head_sha>" }` to the Coolify webhook. Coolify pulls the
   new `universe`-tagged images.
2. `sleep 30` to let Coolify start the rollout.
3. Poll `https://universe.bawes.net/ping` (the back service's
   `PingController`) every 15 s for up to 5 minutes. First HTTP 200 wins.
4. POST a Discord notification with success / failure + run URL.

Manual trigger via `workflow_dispatch` is also wired up — useful for
re-deploying without rebuilding.

### Stage 5 — Rollback (manual)

`rollback-universe.yml` is `workflow_dispatch`-only. Inputs:

- `target_sha` — the commit SHA you want to revert to (must exist as
  `universe-<sha>` in GHCR; check
  https://github.com/BAWES-Universe/workadventure-universe/pkgs/container/play-universe).
- `reason` — free text, posted to Discord.

It uses `docker buildx imagetools create` to repoint the `universe` tag at
`universe-<sha>` for all four runtime services (`play`, `back`,
`map-storage`, `uploader`), then re-fires the Coolify webhook and runs the
same `/ping` health check.

> **No GHCR retention worries (yet).** GHCR keeps untagged manifests until
> manually pruned, so any historical SHA-tagged image remains rollback-able.
> If/when we add cleanup automation, retain the last 30 SHA tags at minimum.

## Required repository secrets

Set these in **Settings → Secrets and variables → Actions**.

| Secret | Used by | Required? | Purpose |
|---|---|---|---|
| `GITHUB_TOKEN` | all | auto | Built-in, used to push to GHCR |
| `COOLIFY_WEBHOOK_URL` | deploy, rollback | yes | Coolify "Deploy" webhook URL for the universe app |
| `COOLIFY_WEBHOOK_TOKEN` | deploy, rollback | optional | Bearer token if your Coolify webhook expects it |
| `DISCORD_WEBHOOK_URL` | deploy, rollback | optional | Channel webhook for `#deploys` (skipped if unset) |

Both deploy and rollback gracefully `::warning::` and exit if Coolify secrets
are missing — so a fresh fork won't break the build.

## All workflow files (audit)

| File | Trigger | Purpose | Origin |
|---|---|---|---|
| `universe-ci.yml`            | PR/push to `universe`          | Universe-branch PR validation     | Universe (this PR) |
| `mobile-ci.yml`              | PR touching `mobile/`          | Capacitor / mobile lint+build     | Universe (PR #9)   |
| `build-universe-images.yml`  | push to `universe`, manual     | Build & push images to GHCR       | Universe           |
| `test-universe-images.yml`   | workflow_run after build       | Playwright integration tests      | Universe           |
| `deploy-universe.yml`        | workflow_run after test, manual | Coolify trigger + health check   | Universe (this PR) |
| `rollback-universe.yml`      | manual                         | Re-tag + redeploy a known-good SHA| Universe (this PR) |
| `continuous_integration.yml` | push `master`/`develop`, all PRs | Upstream WA CI                  | Upstream WA — keep as-is for upstream merges |
| `build-test-and-deploy.yml`  | upstream                       | Upstream WA build/test/deploy     | Upstream WA — not used by Universe |
| `build-multi-arch-image.yml` | upstream                       | Upstream multi-arch builds        | Upstream WA — not used by Universe |
| `build-single-image.yml`     | upstream                       | Upstream single-image builds      | Upstream WA — not used by Universe |
| `build-and-release-desktop.yml` | upstream                    | Upstream desktop release          | Upstream WA       |
| `build-discord-bot.yml`      | upstream                       | Upstream discord-bot build        | Upstream WA       |
| `cleanup.yml`                | scheduled                      | GHCR cleanup                      | Upstream WA       |
| `codeql-analysis.yml`        | schedule + PR                  | Security scan                     | Upstream WA       |
| `iframe-api-push-to-npm.yml` | tag                            | Publish iframe-api npm package    | Upstream WA       |
| `release-chart.yml`          | tag                            | Helm chart release                | Upstream WA       |
| `room-api-push-to-npm.yml`   | tag                            | Publish room-api npm package      | Upstream WA       |

The four upstream workflows that don't trigger on `universe` are kept
untouched so future merges from `workadventure/workadventure` apply cleanly.

## Health endpoint

The back service exposes `GET /ping` (see
`back/src/Controller/PingController.ts`). All Universe health checks use this
path — do **not** assume `/api/health` (a pre-existing assumption in the spec
that turned out wrong).

## Where things live

```
.github/workflows/   ← all CI/CD definitions (this file documents them)
cd/                  ← upstream Kubernetes templates (not used by Universe)
docs/cicd.md         ← this file
docs/dev-workflow.md ← day-to-day developer guide
```
