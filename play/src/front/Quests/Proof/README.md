# Quest #511 competing proof

This is a local UX comparison, not the quest engine. The game and the standalone comparison render the same `QuestProof.svelte` component.

## Enable in the game

Run the normal Vite development game and append `?questProof=1` (or `&questProof=1`) to its URL. `import.meta.env.DEV` is mandatory. The query cannot enable this in a production build. There is no pusher feature flag, deployment setting or backend change.

A development-only proof toolbar exposes bot host, area host, no host and empty fixtures. Reset clears this proof's earned state. Meet needs sent and received messages in the same simulated session. The objective card includes a clearly marked practice preview, so the main next action works without opening developer controls. Scene/room players, roles and map data are not used as hidden fixtures. No bot is guessed to be a host. Only the bot fixture has an explicitly safe practice building target.

The profile menu adds Quests only when this development proof is enabled. The log is explicitly opened, takes focus and gives focus back to the profile trigger. The shared component accepts `controller`, `copy`, `suppressed`, `embedded`, `showScenarios`, `bottomClearance` and `returnFocus`. It has no game imports.

## Boundaries

- No real messages, map edits, preference writes, analytics events, account rewards, authentication or partner calls.
- State uses `universe.quest-proof.codex.v1` only. It is local to the proof browser, not a player/account identifier. Clear/reset the proof when comparing users.
- Accepted progress survives return and simulated reconnect. Partial conversations never span a new session. Accepted but untracked quests complete quietly.
- Automatic UI defers during chat, calls, DND, Orbit/modals, editor mode, Express and existing typing focus stores. The game waits 1.5 seconds after its loaded signal. A deliberately opened log remains usable.
- The mount reads the Express/Explorer column's size to place wide phone cards above it. It does not resize the game, alter the action bar, add viewport/touch guards or change browser zoom.
- Key releases propagate. The game mount clears held movement when entering an interactive quest card and uses a unique control-lock reason for the modal log. It observes successor scenes and releases only its own lock.
- English player copy lives in `i18n/en-US/questsProof.ts`, using the existing translation generator/fallback. Other translations, including Arabic copy, remain release work. Logical CSS properties support RTL layout but do not prove Arabic usability.

## Proof limitations to carry into consensus

This is simulated evidence. Real target discovery, access checks, configured host bindings, movement markers/Walk there, guest/account merge, Orbit synchronization and engine detectors remain later work. This proof cannot certify a production game or real iPhone/Android keyboard, call and zoom behavior.

The log has visible Close and scoped Escape. It does not add browser history entries. There is no shared generic modal-history hook in the inspected game; Orbit owns its own history behavior. Phone browser Back behavior therefore remains a gate before a real-player rollout, not a claim made by this proof. The appointment toolbar is an explicit arrival scenario, not a detector for real invitations/deep links.

## Tests

`QuestProof.test.ts` checks the 60-second idle dot, its accessible label and wake action, focused-button behavior, timer cleanup, external log focus, key-release propagation, the actual two-message practice completion and deferred payoff rendering. The dot keeps a 48px target and the same anchor.

`QuestProofModel.test.ts` covers same-session exchange, stale messages, reconnect, return, decline, missing/optional targets, no credit before acceptance, untracked completion, no interruptions during suppression, restoring another tracked quest, reset and blocked/isolated storage.

Run from `play`: `PLAY_URL=http://play.workadventure.localhost ADMIN_URL= npx vitest run src/front/Quests/Proof/QuestProofModel.test.ts`.

The visual harness and browser checks are documented in `design/quests-proof-alternative`. They test the actual shared component. Hardware keyboard/zoom/call checks still need the game environment.
