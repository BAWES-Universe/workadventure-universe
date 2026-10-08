# Native map audio review and acceptance

This change keeps the existing music channel and controls. It does not change WA.sound, add a new scripting API, implement a spatial/stem mixer, activate a map, or deploy anything.

## Behavior

- The persisted user master volume/mute and session pause are independent of map-authored source gain. Effective gain is master × source × talking duck (0.5) × fade envelope.
- An omitted/invalid authored gain defaults to 1; zero is honored; numeric gain is clamped to [0, 1].
- URL changes crossfade for 1.6 seconds after the incoming media starts, with at most two reusable HTMLAudioElements. Rapid changes retain the more audible viable slot and discard stale targets. Same-URL gain/loop changes do not reload or restart.
- Pause, Stop, unload, hidden tabs and destruction silence the relevant media and cancel fades. Stop retains its existing one-shot semantics: a later explicit source can start again. Pause/mute/master remain unchanged.
- Hidden-tab one-shot cues are skipped on return. Looping beds resume only if not user-paused/stopped.
- Autoplay-blocked incoming media preserves an already-playing outgoing track until the existing native retry gesture starts the latest target. Retired elements are reused to retain per-element browser permission where supported.
- Resource errors expose the existing native retry control; only media/network-error retry reloads the source. Autoplay retry calls play synchronously without a tick/await/load.
- Legacy playAudioLoop and ordinary playAudio both respect blockAudio.

## Focused checks

From repository root, using the repository's Node 22 CI environment:

```sh
npm ci --workspace=workadventure-play
(cd messages && npm ci && npm run ts-proto)
npm run typesafe-i18n --workspace=workadventure-play
npm test --workspace=workadventure-play -- --run tests/front/Components/AudioManager/AudioPlayback.test.ts tests/front/Stores/AudioManagerStore.test.ts
npm run typecheck --workspace=workadventure-play
npm run svelte-check --workspace=workadventure-play
npm run lint --workspace=workadventure-play
npm run pretty-check --workspace=workadventure-play
npm test --workspace=workadventure-play -- --run --maxWorkers=2
PUSHER_URL=//localhost:3000 ADMIN_URL=//localhost:80 npm run build --workspace=workadventure-play
```

Unit tests use deterministic media doubles and animation timers. They prove state/lifecycle behavior, not decoding, hearing, device autoplay grants or in-game integration.

## Manual regression checklist

Use the existing AllowAudio/map.json and map-audio-not-found.json fixtures, and a development map with adjacent playAudio regions using different URLs. The same audio URL with different query strings can exercise a source transition without adding assets.

1. Set the native master to 80%, mute it, then cross several regions. Both slots stay muted. Unmute and use authored gains 0.2, then 0.6; output follows 0.16 then 0.48 while the master stays 80%. Reload and confirm the persisted preference.
2. Change only audioVolume through WA.room.setProperty on the current audio layer, including 0 and removal. It must update active gain without restarting the media. Change only audioLoop and confirm the next end behaves accordingly.
3. Switch A → B → C immediately, and again midway through a fade. A still-audible source must not be discarded for a zero-gain pending source. Confirm only two media resources exist and retired src attributes are removed.
4. Pause, mute, Stop, leave the audio layer, enable blockAudio and leave the map during fades. No retired source may restart from a late play promise.
5. Talk/stop talking repeatedly and move the master slider while ducked. Gain must not drift or permanently lower the master.
6. Test a nonlooping clip ending, outgoing clip ending during a fade, a failed URL and a restored source. The native retry control must recover a transient resource failure. Merely changing volume must not replay a finished clip.
7. Background/foreground during playback and a fade; change position/source while hidden. Looping beds resume only when permitted. Missed one-shots must not play late.
8. On a fresh Safari/iOS session, trigger playback without a gesture, allow it through the native control, then cross into a second source outside a gesture. Verify the outgoing source remains audible if the second element needs permission; allow the latest source and cross regions repeatedly. Repeat on Android Chrome and desktop browsers.

## Map ownership and asset paths

GameScene.cleanupClosingScene calls audioManagerFileStore.unloadAudio. That publishes an undefined source synchronously: the native player cancels its fade, pauses both elements, clears their handlers/src attributes, and invalidates pending play attempts before any new-map source is loaded. Regression tests cover both a pending old-map play promise and an active old-map fade, followed by v2 playback and stale v1 callbacks. Only the new map source remains. This boundary is a hard reset, not a cross-map crossfade.

Asset version folders still need separate URLs (for example /v1/assets/audio/ and /v2/assets/audio/). Directory names prevent asset collisions; playback cleanup prevents runtime overlap. This PR changes no map folder or asset. Custom WA.sound/script effects are a separate path and are not claimed to be owned by this native music controller.

## Required before merge

Physical Safari/iOS and Android gesture/volume behavior, full-game campfire/legacy/blockAudio flows, real hidden-tab behavior, codec/loop seams and listening checks need explicit runtime verification. WebKit grants can be per element; reusing two elements mitigates repeated prompts but does not prove the second element is unlocked. HTMLAudioElement volume support also differs by device. Do not infer mobile acceptance from jsdom or desktop-only tests.

No merge, deployment, automatic merge, deploy labels, manual workflow runs, or changes to credentials/permissions are authorized by this draft.

