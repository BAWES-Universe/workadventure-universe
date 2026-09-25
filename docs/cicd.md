# Universe — CI/CD Overview

## Checks on Pull Requests

When you open a PR against `universe`, several CI checks run. Not all
of them are relevant to this fork.

### Upstream WorkAdventure checks (informational only)

The upstream WorkAdventure repo includes E2E and integration tests that
require a full local Docker stack (ejabberd, Redis, back, front, play,
etc.). **These checks will fail on every PR in this fork** because that
Docker stack is not available in GitHub Actions here.

**These failures do not block merging** — they are informational.
Do not spend time debugging upstream E2E failures unless you have
specifically changed a component those tests cover.

Checks to ignore:
- `e2e` / Playwright tests against the local stack
- Docker Compose integration checks
- Any check prefixed `wa-` that requires service URLs

### Checks that ARE required for Universe PRs

| Check | What it covers |
|-------|----------------|
| TypeScript build (`tsc --noEmit`) | Type errors in changed files |
| ESLint | Code style in changed files |
| Desktop release dry-run | `electron-builder --dir` smoke check (runs on `feat/electron-*`) |

## Desktop Release Workflow

File: `.github/workflows/desktop-release.yml`

Triggered by:
- A pushed tag matching `v*.*.*` (e.g. `v1.0.0`)
- Manual `workflow_dispatch` with a version input

Builds artifacts for Windows, macOS, and Linux in parallel, then
attaches them to the GitHub Release.

See `docs/releases.md` for the full release runbook.

## Secrets Required for Desktop Releases

| Secret | Required for | Notes |
|--------|-------------|-------|
| `GITHUB_TOKEN` | All platforms | Auto-provided by GitHub Actions |
| `APPLE_ID` | macOS notarisation | Your Apple developer email |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS notarisation | App-specific password from Apple ID |
| `APPLE_TEAM_ID` | macOS notarisation | 10-char team ID from developer.apple.com |
| `WIN_CSC_LINK` | Windows code signing | Base64-encoded .p12 cert (optional for v1) |
| `WIN_CSC_KEY_PASSWORD` | Windows code signing | Password for the .p12 cert (optional for v1) |

For the first release, skip Windows signing — remove the `CSC_LINK`
and `CSC_KEY_PASSWORD` env vars from the workflow step and users will
see an "Unknown Publisher" SmartScreen warning which they can bypass.
