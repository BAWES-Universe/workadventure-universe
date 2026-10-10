# Native 32px click/tap replanning

Fixes [#798](https://github.com/BAWES-Universe/workadventure-universe/issues/798).

## Reproduction and expected behaviour

The bug was first isolated on `b1ca7023fd1d8ddbb20911e5a6234ad5d0bd30af` and reproduced again on the unmodified PR base, `90a148c03e03401e26d236eaac9bea4123b42c57` (`universe-develop`). This is the native 32px movement path, independent of the older 16px body-alignment proposal.

Use an 8×8 map with 32px tiles, a walkable interior, a one-tile solid border, and an empty decorative tile layer `shell/art` in group `shell`. Permanent collision tiles remain visible.

1. Begin at sprite position `(80,192)`.
2. Right-click, or send an accepted mobile tap, at floor position `(80,144)`.
3. The fitted destination is sprite position `(80,128)`, floor tile `(2,4)`.
4. While moving north, at sprite position `(80,141)`, call `WA.room.hideLayer("shell")`.
5. The visibility update rebuilds the identical collision grid and emits `mapChanged`.

Before the fix, the player arrives at `(80,96)`, floor tile `(2,3)`, 32px north of the requested endpoint. After the fix, it arrives at `(80,128)`, retaining tile `(2,4)` and the original fitted endpoint.

Two controls require no visibility updates: start at `(80,141)` or already at `(80,128)` and click `(80,144)`. Both previously moved to `(80,96)`. Both now finish at `(80,128)`; the stationary command stays stationary.

## Root causes

- EasyStar 0.4.4 returns an empty array for `start == end`. Its same-cell shortcut happens before its acceptable-target check. The manager previously interpreted this as no path and searched adjacent tiles. A same-cell target now produces one endpoint only if the current grid says it is traversable. Blocked targets retain nearest-available fallback.
- A one-point path must still receive the ordinary within-tile hitbox fit. Only the first-point start-position replacement needs a multi-point path.
- `Player` stores path endpoints in sprite coordinates after subtracting `body.height / 2 + body.offset.y`. `GameScene.moveTo` consumes floor/click coordinates. The map-change subscriber now adds this offset back exactly once before calling `moveTo`, avoiding repeated upward fitting.
- Rapid visibility changes can overlap asynchronous path results. Cancellation now settles the obsolete calculation and suppresses already queued callbacks. A request generation prevents an obsolete nearest-neighbour search from continuing and cancelling a newer one. `GameScene` only installs its latest request, and a visibility replan uses a newer pending pointer target rather than the previous installed path's target.
- The manager retains the current collision grid after a replacement so same-cell traversability is checked against current data.

The patch does not suppress layer visibility updates, collision-grid rebuilds, map-change events, or path replanning. It preserves the desktop right-click/mobile-tap entry point and blocked-target fallback. No rendering, map geometry, networking, audio, or 16px alignment change is included.

## Automated regressions

From `play/`, with the repository dependencies installed:

```sh
npm test -- --run \
  tests/front/Utils/PathfindingManager.test.ts \
  tests/front/Utils/PathfindingManager.native32.test.ts \
  tests/front/Phaser/Game/NativePathReplanning.test.ts
```

`PathfindingManager.native32.test.ts` imports the production manager and real installed EasyStar. It checks exact same-cell paths, stationary clicks, within-tile edges, all traversable tile types, changed collision grids, blocked-target fallback, cancellation, superseded fallback work, and cleanup.

`NativePathReplanning.test.ts` compiles the actual checked-out `GameScene`, `Player`, `GameMapFrontWrapper`, and pointer-handler method bodies. This avoids loading renderer/network services while preserving the source logic. Fake timers retain asynchronous EasyStar callbacks. Fixtures stub the Phaser body/rendering services only. It checks desktop and mobile inputs, full native visibility/grid rebuilds across all 16 combinations of four decorative groups, fitted endpoints away from tile centres, simultaneous layer changes, newer-pointer interruption, replaced movement promises, and repeated doorway/return commands.

These are unit/source-integration tests, not a live Phaser renderer or device test. To validate visually, repeat the minimal case in a running client using both right-click and touch, then rapidly hide/show decorative groups and interrupt the route with a new target. Verify that controls remain usable and the final command wins.

## Candidate-map evidence

A separate frozen 80×60 native-32px map candidate was tested with 210 hall seats, 24 social anchors, and 14 landmarks. The map and route harness were unchanged for the before/after comparison.

- 8,928 principal route legs: six origins × 248 targets × three click-pixel variants × arrival/return.
- 24 repeated doorway legs, for 8,952 total.
- Before: 213 visibility-induced wrong-tile arrivals and 9 baseline same-cell fallback failures.
- After: zero wrong-tile arrivals and zero endpoint drift across all 8,952 legs.
- After: 25,416,956 samples, zero sampled body/collision penetrations, unwanted meeting-area entries, or loops; 21,258 active replans remained enabled.
- Before: two finite visibility transitions could produce 76.4199px of endpoint drift. The problem was not limited to a 15px within-tile adjustment.
- Every one of the 16 visibility-state collision grids was independently rebuilt and proved identical. During the large route matrix only those numeric grids were memoized; visibility calls, map-change emissions, asynchronous replans and Player promise replacements still executed. The minimal regression uses full unmodified grid rebuilds.

The external candidate-map matrix is supplementary evidence; the committed minimal tests do not depend on that map or any local path. It does not establish deployed, multiuser, network, or live-renderer correctness. The PR is for review only, with no merge or deployment performed.

## Validation status

See the PR description for the exact final commit's command results and any unrelated or environment-blocked full checks. Focused tests and the route matrix are not substitutes for repository-wide CI.
