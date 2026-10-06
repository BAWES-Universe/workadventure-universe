# Disposable menu/search experiment — 2026-10-06

This branch is an experiment, not approved for merge or deployment.

## Baseline and paired branch

Dev is running unmerged PR builds. This experiment starts at the game deployment receipt for PR #642:
`6e427331382cabf2b4933f3bec4bdb9a5f2accf6`.

Use together with `experiment/unified-menu-search` in `BAWES-Universe/workadventure-universe-admin`, based on its dev receipt for PR #251:
`0ef59231d479dc3a2a389da16319402aa827f1cd`.

The default `universe-develop` branch does not contain the complete UI being tested on dev. Neither default development branch was changed.

## First slice

- Cmd/Ctrl+K over the signed-in game opens Orbit's existing menu. It does not navigate away from an already-open Orbit page.
- The existing profile dropdown has a Menu & search entry pointing to that same surface.
- The paired Orbit change adds real people/place searches to its existing menu and keeps all section/tool links reachable.
- No permanent top bar, permanent search input, duplicate profile, invented imagery, schema changes, map edits, or persisted experimental preferences.
- Existing identity/status, A/V, editor, People/Chat, room details, and page-specific search controls remain intact. Consolidating those controls further is a later design decision; this is not yet the complete navigation redesign.
- Guests and integrations without Orbit retain their existing controls. Older Orbit builds ignore the new capability: the game opens Orbit normally and does not send an unsupported menu message.

## Verification

Setup: `npm ci --ignore-scripts`; in `messages`, `npm ci` then `npm run ts-proto` (create `libs/messages/src/ts-proto-generated` first if needed); `npm run typesafe-i18n --workspace=play`.

From the repository root:

```sh
npx vitest run --config scripts/unified-menu.vitest.mts
```

Result: **57 tests passed**, covering the bridge, authentication, lifecycle, menu queuing, old-peer capability behavior, keyboard repeat/composition and preservation of an open Orbit page. Targeted ESLint also passed after generating i18n files.

The regular play test command could not start here under Node 24: its existing Vite configuration imports `sveltePreprocess` as an unavailable named CommonJS export. The focused configuration runs the actual bridge tests without loading that unrelated build configuration. No full game build or live/browser playthrough is claimed.

Manual review still required on a disposable environment with BOTH branches:
1. Open via game keyboard, game Menu & search entry, and Orbit button; confirm one menu implementation.
2. Open it over a room/world detail page; dismiss and retain that page, focus and current game location.
3. Search a person/room; inspect the existing detail page; explicitly visit only when intended.
4. Exercise People/Chat, A/V, editor, mobile portrait and short landscape. Existing edit dialogs must not be covered.

## Discard

No changes have been merged or deployed, and no database migration or application data change is part of this experiment. Delete `experiment/unified-menu-search` in both repositories to discard it. Keep working from the original dev builds.

Do not add `on-dev`, dispatch deployment workflows or merge this branch without Khalid choosing to test/promote it. The current dev label holders remain untouched.
