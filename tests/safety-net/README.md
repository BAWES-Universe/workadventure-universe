# Safety net

One checklist of every action a player can take in Universe, and a Playwright suite that runs every row it can,
as a phone (428x926, touch) and as a desktop (1440x900), before a build goes on dev.

- `checklist.json`: the master checklist. Each row has the action, the expected result on the current dev build,
  its source (`prod`, or the approval it comes from, with the date), and whether it can run on the local stack
  (`runs`: `yes`, or what it needs: `needs-orbit`, `needs-chat`, `needs-device`, `needs-livekit`, `needs-uploader`).
  A few rows that could run locally are still checked by hand; `handReason` says why.
  Rows whose expected result says KNOWN GAP or KNOWN FAIL (`knownGap: true`) describe approved behaviour the build
  does not do yet. They fail until the owning fix lands, and the summary lists them apart from new failures.
- `specs/`: the checks. A test title starts with the row IDs it covers (`JN-012 JN-013 ...`); that is how results map
  back to rows. Tests tagged `@local` reach into the game's own modules and only run against the local vite stack.
- `lib/`: shared helpers (`game.ts`) and one helper file per area.
- `stack/`: a Docker-free game stack (maps, back, map-storage, pusher, vite front, gateway) built from any checkout.
- `report.mjs`: turns a run into the summary line for the go-live note.
- `tools/render-checklist.mjs`: renders the checklist (and, given a results file, each row's last result) as markdown.

## Running it on a candidate build

```sh
# once per container
cd tests/safety-net && npm ci
cd <checkout of the candidate build> && npm ci

# start the build under test (state, logs and caches go to STATE_DIR, outside the checkout)
export GAME_DIR=<checkout of the candidate build> STATE_DIR=/tmp/safety-net-stack
bash tests/safety-net/stack/stack.sh setup     # proto + i18n generation, scripting API bundle
bash tests/safety-net/stack/stack.sh start
bash tests/safety-net/stack/stack.sh wait      # waits for the stack, then loads the WAM test maps

# run and summarise
cd tests/safety-net
SAFETY_NET_WORKERS=3 npx playwright test
node report.mjs --build <commit>               # writes results/summary.md, exits 1 on a new failure
```

The game opens at http://localhost:8000. Every test makes its own room (a fresh public room, or a copy of a WAM test
map in map-storage), so tests never meet each other. Use `stack.sh restart` between builds.

The summary starts with the line for the go-live note, for example
"**409 of 412 checks pass** on 86bc8b264 (phone 205/206, desktop 204/206)", then the number of rows checked by hand
and why, then each failure with its row, expected result, error and screenshot.

## How much to run: skip, quick or full

A full run takes about 3 hours, so `tools/pick-tier.mjs` decides from the files a candidate changes. It is plain git and
the checklist, with no model and no cost:

```sh
node tools/pick-tier.mjs --game-dir <candidate checkout> --base <build on dev now> --head <candidate> \
    [--ci-green] [--owner-checked] [--daily]
```

- **skip**: no game file changed, or a small look-only change (3 files or fewer, 80 lines or fewer, only `.svelte`,
  `.scss`, `.css` or English text) that no checklist row names. The second case needs `--ci-green` and
  `--owner-checked` (the owning thread ran its phone and desktop check on the candidate); without them it runs quick.
- **quick** (about 20-30 minutes): the rows that name a changed file (the Hooks, Expected and Action columns), plus the
  smoke set in `smoke.json` (join, walk, chat, editor and Broadcast each open). The script prints the exact
  `npx playwright test --grep '...'` line. Report it with `node report.mjs --build <commit> --tier quick`.
- **full** (about 3 hours): two or more PRs bundled, shared code (`back`, `libs`, `messages`, `map-storage`, `uploader`,
  the pusher, `package.json`, build files), a wide change (over 30 files or 1500 lines), or `--daily` (the once-a-day run
  on the dev head).

It prints the tier and why, so the go-live note can say "safety net: quick, 18 min" or "safety net: skipped (why)".
Keep `smoke.json` short and keep the checklist's Hooks column up to date: that column is how a changed file finds its rows.

## What the local stack can't check

There is no Matrix chat server, no Orbit (no login, tags or admin API), no uploader and no LiveKit, and the browser
uses fake camera and microphone devices. Rows that need those stay in the checklist with their `runs` reason and are
checked by hand. Once dev-only test accounts exist, the same specs (minus `@local`) can run against real dev with
`SAFETY_NET_URL=https://dev.bawes.net` after a sign-in step; that is the dev smoke test planned in the
"Faster dev and release flow" thread.

## Keeping it current

- A change Khalid approves that alters an action: update the row's `expected` and `source` in `checklist.json`, and
  the test that covers it, in the same PR as the change.
- A new feature: add rows (next free ID in its area) and tests.
- Never loosen a check to make a build pass. If a build does something no row and no approval describes, that is a
  question for Khalid, not a new expected result.
