# BAWES Universe — Day-to-Day Dev Workflow

Practical guide for contributors. For the full pipeline reference see
[`cicd.md`](./cicd.md).

## TL;DR

```
git checkout universe && git pull
git checkout -b feat/<short-name>
# ... hack hack hack ...
git push origin feat/<short-name>     # opens PR on GitHub
# ... PR runs universe-ci.yml ...
# merge to universe
# ... build → test → deploy fires automatically ...
# ... universe.bawes.net updated ~5-10 min later
```

## Branch naming

Always branch from `universe`. Always PR back to `universe`. Branch prefix
signals intent:

| Prefix | Use for |
|---|---|
| `feat/`  | new feature, addition |
| `fix/`   | bug fix |
| `chore/` | refactor, deps bump, tooling, no behavior change |
| `docs/`  | docs-only changes |
| `ci/`    | workflow / pipeline changes |

Examples: `feat/mobile-update-management`, `fix/svelte-store-leak`,
`ci/add-rollback-workflow`.

## Pull request flow

1. **Open PR against `universe`.** GitHub auto-fills the base when you push
   from a `feat/` branch.
2. **`universe-ci.yml` runs.** Typecheck + lint + unit tests for `play`,
   `back`, `map-storage`. Plus `mobile-ci.yml` if you touched `mobile/`.
3. **Get a green tick before requesting review.** Re-runnable steps:
   ```bash
   docker compose exec play  npm run lint && npm run typecheck && npm test
   docker compose exec back  npm run lint && npm run typecheck && npm test
   ```
4. **Reviewer merges.** Squash or merge commit per maintainer preference; do
   not rebase-and-force-push to a branch under review.
5. **Build → test → deploy fires automatically** within ~30s of merge.

## What happens after merge

| Time after merge | What runs |
|---|---|
| 0 s          | `build-universe-images.yml` triggered by push to `universe` |
| ~3-8 min     | All 6 service images pushed to GHCR with `universe` and `universe-<sha>` tags |
| +0 s         | `test-universe-images.yml` starts on `workflow_run` |
| +5-15 min    | Playwright suite passes (or fails — see Actions logs) |
| +0 s         | `deploy-universe.yml` triggered (only if test workflow succeeded) |
| +30 s        | Coolify webhook fired |
| +30 s to 5 min | `/ping` health check polls `universe.bawes.net` |
| immediately on result | Discord `#deploys` notification posted |

Total typical merge → live time: **~10-20 min**.

## Local development

The repo uses the upstream WorkAdventure docker-compose stack. From the repo
root:

```bash
docker compose up -d         # bring up play, back, map-storage, uploader, etc.
docker compose logs -f play  # tail logs for any service
```

Common iterative commands while developing inside a service:

```bash
# Inside play/, back/, etc.
npm run lint           # ESLint
npm run lint-fix       # ESLint + autofix
npm run typecheck      # tsc --noEmit
npm run pretty-check   # Prettier check (no rewrite)
npm test               # Jest / Vitest unit tests
```

For Universe-specific Docker image builds (e.g., to verify a `Dockerfile.universe`
change before pushing):

```bash
./scripts/build-universe.sh  --docker-username <you>
./scripts/verify-universe.sh --docker-username <you>
./scripts/push-universe.sh   --docker-username <you>
# OR all-in-one:
./scripts/deploy-universe.sh --docker-username <you> --version latest
```

See `.github/workflows/README-UNIVERSE.md` for the local-script reference.

## Checking deploy status

- **Live build / test / deploy runs:**
  https://github.com/BAWES-Universe/workadventure-universe/actions
- **Latest images in GHCR:**
  https://github.com/BAWES-Universe?tab=packages
- **Production health:**
  ```bash
  curl -i https://universe.bawes.net/ping
  ```
  Expected: `HTTP/2 200`.
- **Discord `#deploys`** (if `DISCORD_WEBHOOK_URL` secret is set): every
  deploy / rollback posts here.

## How to roll back

When a bad change reaches production:

1. Find the last known-good commit SHA (typically the merge commit before
   the bad one). Confirm `universe-<sha>` exists at
   https://github.com/BAWES-Universe/workadventure-universe/pkgs/container/play-universe.
2. **Actions → "Rollback Universe Deploy" → "Run workflow"**.
3. Fill in:
   - `target_sha` — the SHA from step 1 (short or full).
   - `reason` — short text, surfaces in the Discord notification.
4. Workflow re-tags `universe-<sha>` as `universe` for all four runtime
   services and re-fires the Coolify webhook.
5. Wait for the `/ping` health check to go green (or fail loud — check the
   run logs and Discord).

If the workflow itself is the broken thing (worst case), the same steps work
manually:

```bash
SHA=<known-good-sha>
for svc in play back map-storage uploader; do
  docker buildx imagetools create \
    --tag  ghcr.io/BAWES-Universe/$svc-universe:universe \
           ghcr.io/BAWES-Universe/$svc-universe:universe-$SHA
done
# Then trigger Coolify deploy from the Coolify UI.
```

## Required secrets (one-time setup)

For the deploy + rollback workflows to actually do anything, configure under
**Settings → Secrets and variables → Actions**:

| Secret | Required | Notes |
|---|---|---|
| `COOLIFY_WEBHOOK_URL`   | yes      | Found in Coolify app's "Webhooks" page |
| `COOLIFY_WEBHOOK_TOKEN` | optional | Only if your Coolify webhook expects an `Authorization: Bearer …` |
| `DISCORD_WEBHOOK_URL`   | optional | Skipping this just suppresses notifications |

Workflows are written to degrade gracefully — missing secrets emit a GitHub
Actions warning rather than failing the build.

## Linting + commit hygiene

Before pushing, install the precommit hook once:

```bash
npm install
npm run prepare
```

Conventional Commits encouraged:

```
feat(play): add mobile update banner
fix(back): handle missing version env vars
chore(ci): bump setup-node to v4
docs(cicd): add rollback procedure
```
