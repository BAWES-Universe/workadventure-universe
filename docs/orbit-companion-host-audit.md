# Orbit companion: host audit

## UX decisions

- Preserve the existing game geometry: 33% desktop panel; 80% width, capped at 400px, below 992px. A 390px phone therefore gives Orbit a 312px viewport.
- Preserve the game's close/maximize controls. Compact controls remain outside the frame on its left; full-screen controls remain at the upper right. Orbit's secondary view action belongs in its navigation menu, away from the host controls.
- Preserve the bridge and held-movement reset from #525. Change page URLs in the existing frame, retaining the view, launcher, and authenticated bridge window.
- Give every opening a distinct history marker. An old opening must never prevent Back from closing a new one.

## Baseline and comparison

The branch starts at `universe-quests` commit `b2444024b1d28f831bd1fb77546768d430852a8c` and reuses the functional changes from PR #525, commit `bd86c294061d92cd7aee4786643514dd83509d39`. It is a separate alternative branch; it does not modify #525.

A final comparison also inspected #525 at `eed2f1f7e30c2300292a93068264828aec286b11`. That follow-up removes iframe view requests but changes neither history helpers nor modal navigation; both findings below still apply. This alternative retains the secondary view action in Orbit's menu because the host's maximize button is hidden on phones.

| Area | Verdict | Evidence and change |
| --- | --- | --- |
| Browser Back after close/reopen | Regression in #525 | Its history marker is the same `{ orbit: true }` for every opening (`admin-api/index.ts`, history helpers). A real Chromium probe reproduced: open → navigate inside iframe → X → reopen → Back leaves Orbit open. Unique `orbitVisit` IDs make that same sequence close the new opening. |
| Page change while Orbit is open | Existing defect retained by #525 | `openOrbitPage` synchronously toggled visibility false/true, which Svelte batches. The modal retained its original non-reactive `modalUrl` while its bridge window was cleared. The new source replaces the URL in place and makes `modalUrl` reactive. A rendered `Modal.svelte` regression test failed on the old source and passes now. |
| Full-screen view during game-directed navigation | Regression avoided | The old close/reopen path reset the full-screen store. In-place replacement retains it; the integration test checks the view, bridge window, visibility, and one history marker. |
| Host controls | Improvement | Existing close and view buttons now have accessible names and tooltips. The modal is named Orbit. Dimensions and button placement are unchanged. |
| Bridge | Preserved | Version 1; exact origin/window checks; room-revision guard on navigation/event acknowledgements. The inherited `view` capability and `visit-card` intent remain. Closing and room visits still use `WA.*`. |
| Escape | Preserved boundary | Keyboard events inside an iframe do not bubble to the host. Orbit owns its internal dialog/menu/field layers and invokes `WA.ui.modal.closeModal()` at the outer layer. The host handles Escape while focus is in the game. |

Source areas: `play/src/front/external-modules/admin-api/index.ts`, `orbitBridge.ts`, `play/src/front/Components/Modal/Modal.svelte`, and `play/src/front/Components/MainLayout.svelte`.

## Browser evidence

An isolated HTTP fixture ran the actual history helpers extracted from each source version, with a real iframe and browser joint session history in Chromium `153.0.8010.0`. It simulated mounting/teardown of the iframe; it was **not a live authenticated game session**.

| Sequence | #525 | This branch |
| --- | --- | --- |
| Navigate inside iframe → X → reopen → browser Back | Orbit remains open (failure) | Orbit closes |
| Navigate inside iframe → browser Back | Internal route returns; Orbit stays open | Same |
| Then browser Back at opening boundary | Orbit closes | Same |

The component test renders the actual `Modal.svelte` in jsdom and verifies that a source change navigates the same iframe element. The integration tests separately verify that the registered window is not cleared and full-screen mode is preserved.

**History limitation:** closing an iframe after internal navigations can leave a stale parent marker in joint session history. The host recognizes and skips stale markers when they are reached; it does not claim that X erases every iframe history entry immediately. Blindly jumping by an iframe depth would risk skipping unrelated history. No such jump was added.

## Checks

CI prerequisites were generated with `messages/npm run ts-proto` and `play/npm run typesafe-i18n`. No generated files, lockfiles, or package manifests changed.

- Focused modal, integration, and bridge suites: **36 passed**.
- Complete `play` test suite: **96 files passed; 746 tests passed, 9 skipped**.
- `npm run typecheck`: four errors for `MediaStreamAudioTrack` / `MediaStreamVideoTrack` in unchanged `RemotePeer.ts`. A separate checkout of `b2444024` reproduced the same four errors with the same dependencies.
- `svelte-check --fail-on-warnings` with the requested compiler exclusions: the same four `RemotePeer.ts` errors, zero warnings; no changed-file diagnostics.
- ESLint on every changed source/test file: zero errors, two existing Svelte import-resolution warnings. The baseline modal reproduces both warnings.
- Prettier on every changed source/test file: passed.

The environment uses Node 24 and the repository-pinned TypeScript 5.8.3. Repository CI uses Node 22; CI remains the final environment gate.

## Rollback and merge order

No feature flag, database/schema change, or stored user-data migration. Revert this host PR to undo it. It is paired with the competing Orbit companion PR: merge **Orbit first, game second**. Do not merge both alternative implementations without reconciling their shared changes.
