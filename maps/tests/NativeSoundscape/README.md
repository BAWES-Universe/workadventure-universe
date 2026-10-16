# Opt-in proximity ambience alongside native music

This is a **new optional feature**, not a claim that WorkAdventure lacks audio.
The existing player already loops music, preserves same-URL playback, crossfades
music changes for 1.6 seconds where supported, and provides native volume, mute,
pause, Stop, talking ducking and autoplay retry. This feature adds one independently
distance-attenuated ambience layer governed by those same controls.

## Exact scope and affected version

- Repository: `BAWES-Universe/workadventure-universe`.
- Intended review/merge base: **`universe-develop`**, pinned at
  `d2bc57b63b4abab9303fb3cbcecf1a0450fd15cc`.
- That commit and the earlier tested `universe` commit
  `f00b3482f23c51976b4b339d7a891cad683d6498` share the identical Git tree
  `d4b5d2e04ba2f510c786f6d46c3630120659bfc4`. The earlier branch was wrong;
  the corrected PR must contain only this feature, tests and documentation,
  without the 61 unrelated release-history commits.
- This PR does not merge, activate a map, add deployment labels, change deployment
  configuration, or modify PR712. Only the repository owner decides whether to
  merge after review. `universe` is production and is not this PR's target.

## Why existing audio is insufficient for this particular effect

At the pinned base, `AudioPlayback` owns one selected music source (two elements
only while crossfading), and same-URL metadata updates do not restart it. Native
controls are already connected through `AudioPlayer.svelte`.

`WA.sound` can load, play with an initial configuration, and stop sounds. Its
iframe handler routes to a separate Phaser `SoundManager`, which calls
`sound.play(config)`. There is no exposed continuous gain-update method or native
AudioManager control binding for that separate channel. Repeated `play` calls are
not a supported continuous spatial-mixer API. A baked music-plus-water file also
cannot independently attenuate water without attenuating the music.

The specific missing behavior is therefore **continuous music plus independently
player-distance-dependent ambience under one set of native controls**. This does
not justify an audio rewrite for ordinary background music or area crossfades.

Pinned source references:

- [Existing continuity/crossfades](https://github.com/BAWES-Universe/workadventure-universe/blob/d2bc57b63b4abab9303fb3cbcecf1a0450fd15cc/play/src/front/Components/AudioManager/AudioPlayback.ts)
- [Existing native controls](https://github.com/BAWES-Universe/workadventure-universe/blob/d2bc57b63b4abab9303fb3cbcecf1a0450fd15cc/play/src/front/Components/AudioManager/AudioPlayer.svelte)
- [WA.sound methods](https://github.com/BAWES-Universe/workadventure-universe/blob/d2bc57b63b4abab9303fb3cbcecf1a0450fd15cc/play/src/front/Api/Iframe/Sound/Sound.ts)
- [Separate Phaser sound path](https://github.com/BAWES-Universe/workadventure-universe/blob/d2bc57b63b4abab9303fb3cbcecf1a0450fd15cc/play/src/front/Phaser/Game/SoundManager.ts)

## Reproduce the baseline and compare the candidate

Use an authorized local or isolated review frontend; do not change a deployed
world to run this checklist. Follow the repository's Docker development setup.
The usual local map route is:

`http://play.workadventure.localhost/_/global/maps.workadventure.localhost/tests/NativeSoundscape/map.json`

1. Serve this fixture directory and its existing relative assets from the maps
   service. The frontend must be built from the candidate for the new property to
   work. Loading a map alone does not install an engine feature.
2. For the baseline comparison, run the pinned base frontend with `legacy.json`,
   or copy the candidate fixture files onto the base maps service. On the base,
   `nativeSoundscape` is not consumed; `map.json` still provides its ordinary
   `playAudio` bed but no proximity ambience. This baseline statement is supported
   by source inspection, not a claimed before/after live-room recording.
3. Begin in a fresh session. If autoplay is blocked, use the existing native audio
   retry gesture. Do not grant microphone or other permissions for this test.
4. The fixture starts near `(48,176)`. Walk along row `y=176` through `(248,176)` to
   `(400,176)`, then back, using keyboard/joystick and tap movement separately.
5. Listen for a continuous audience bed and a campfire that grows nearer the
   right-hand point. These are **existing repository test clips**, deliberately
   distinguishable; this is not a finished waterfall/music art asset. A waterfall
   map uses its existing pure music and pure waterfall stems instead.
6. Compare `legacy.json`: basic looping bed and native controls still work, but
   walking does not introduce a proximity campfire.

### Expected versus actual

| Scenario                       | Pinned base                              | Candidate expectation                             |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------- |
| Looping bed, same URL          | Already continuous                       | Remains continuous                                |
| Music URL transition           | Existing 1.6-second fade where supported | Reuses it within an opted-in graph session        |
| Independently varying ambience | No native proximity layer                | Water/ambience changes with player distance       |
| Native mute/master/pause/Stop  | Controls existing music channel          | Controls music and ambience together              |
| Moving camera/zoom only        | No proximity implementation              | Must not change gain; player coordinates drive it |

At full master volume and without ducking/fades, bed gain is `0.2`. Ambience gain
is `0` at `(48,176)`, `0.175` at `(248,176)`, and `0.35` at `(400,176)`. User master
multiplies both. Do not infer gain from perceived loudness alone; different audio
files have different loudness. Music time should keep advancing rather than reset
as the character changes distance.

## Authoring contract

Set these **tile-layer properties** on a full-coverage layer active at spawn:

- `playAudio`: pure music/bed URL
- `audioLoop`: `true`
- `audioVolume`: music source gain
- `nativeSoundscape`: a JSON **string**, for example the fixture's value:

```json
{
  "url": "../../assets/audio/campfire.ogg",
  "volume": 0.35,
  "x": 400,
  "y": 176,
  "innerRadius": 48,
  "outerRadius": 256
}
```

Root Tiled map properties are not collected for this feature. The carrier must
have nonzero tiles everywhere the bed is intended to continue. URLs resolve
against the map URL. Only HTTP(S) asset URLs are supported by this graph path;
use same-origin or CORS-enabled media. The descriptor rejects extra fields,
credential-bearing URLs, nonfinite numbers, gains outside `[0,1]`, negative inner
radii, and outer radii not greater than inner radii. Coordinates/radii are pixels
in player/map space, not camera/screen coordinates.

The distance factor is smoothstep from one at the inner radius to zero at the
outer radius. This is **2D distance attenuation**, not stereo/binaural panning,
occlusion, cone effects, reverb, Doppler or a many-emitter engine.

First opt-in must accompany music selection. Adding the first descriptor late to
an already-playing same-URL legacy track is rejected with a warning while keeping
its media/time unchanged. Within an already opted-in session, descriptor changes,
removal and re-addition preserve the music. Keep the descriptor when changing
music URLs for graph-backed crossfades. A new URL without a descriptor explicitly
returns to legacy playback; seamless cross-backend fading is not promised.
Deprecated `playAudioLoop` does not acquire this new feature.

## Controls, interrupted flows and failure reproduction

Use the same fixture, then repeat on a real candidate room when available.

1. Set master to 25%: expected source gains are scaled by `0.25`. Set master to
   zero and mute separately: both channels must be silent. Moving must not unmute.
2. Pause, move and resume: both media pause; movement does not resume them. Stop,
   then move: both stay stopped. An explicit later music-source selection retains
   the existing one-shot Stop-reset semantics. Pause/mute/master preferences persist.
3. From a trusted test-map iframe script after `WA.onInit()`, use the existing
   `WA.room.setProperty("soundscape", "nativeSoundscape", value)` API. Remove with
   `undefined`, replace with the valid JSON string above, and re-add. Music must
   retain its element/time. Do not run repeated `WA.sound.play` calls as a substitute.
4. Set that property to `"{bad"`: the selection fails closed and native error is
   shown. Repair/remove the descriptor without changing `playAudio`: selection
   recovers, while any user Stop/pause/mute remains set. Also test leaving the
   music area, selecting a _new_ malformed source and then repairing it: a stale
   navigation Stop must not prevent that new selection from recovering.
5. Use an invalid emitter geometry or unsupported `data:` music URL in a controlled
   test. It must report an error without throwing into Svelte store dispatch;
   unrelated UI stores and subsequent valid playback must still work. Movement,
   listener clearing and mute must not erase a rejected-emitter error before repair.
6. Replace the emitter URL with a nonexistent file, and separately with a real
   cross-origin asset that lacks CORS. Expect native error/available retry, no
   uncontrolled fallback player, and no restart of already-working music.
7. Rapidly change music A→B→A during a fade; replace emitter URLs repeatedly. At
   most two music resources plus one emitter may be active. Retired elements and
   graphs detach/disconnect; map unload closes only this feature's owned context.
8. Teleport within the same map, then stay still: listener gain must update without
   requiring an extra walking event. Leave/re-enter the map and check cleanup.
9. Background/foreground, block/resume autoplay, and unload during pending play or
   context-resume promises. Late completions must not resurrect audio.

## Design and root causes addressed

The implementation composes the existing `AudioPlayback` for music with one hard-
replaced ambience channel. GainNodes apply source/master/duck/fade gain through
adapters; **real** media elements remain attached to the Svelte component-owned
container. Reusable media keep one source-node association and reconnect safely.
The dedicated context never suspends/closes a voice/WebRTC context.

Problems found during review of this feature, not claims about the released base:

- Descriptor parse failure unloaded music, and the URL guard then ignored repair.
  A per-map rejected-selection marker restores only that selection, preserving controls.
- A late backend switch reset a legacy element from 37 seconds to zero. The bounded
  contract now rejects that unsupported transition rather than pretending it is seamless.
- A new malformed source retained navigation Stop. Its error path unloads first,
  then resets Stop like normal explicit source selection; later user Stop persists.
- Validation could throw from a Svelte subscriber and disrupt shared store dispatch.
  Controller validation is contained and exposes native channel errors instead.
- Listener updates only in the movement-event subscription missed direct same-map
  teleport calls. They now live in the canonical movement handler.
- Repeated distance updates could clear a rejected-emitter error. Rejected metadata
  remains an error until explicit removal/repair.

## Tests, results and evidence boundaries

Run from the repository root after the standard dependency/messages/i18n setup:

```sh
npm test --workspace=workadventure-play -- --run tests/front/Components/AudioManager tests/front/Stores/AudioManagerStore.test.ts
npm run typecheck --workspace=workadventure-play
npm run svelte-check --workspace=workadventure-play
npm run lint --workspace=workadventure-play
npm run pretty-check --workspace=workadventure-play
PUSHER_URL=//localhost:3000 ADMIN_URL=//localhost:80 npm run build --workspace=workadventure-play
```

The fixture test checks full tile coverage at spawn, existing relative assets,
strict descriptor parsing, documented distance points, and the legacy comparison.
It is a structural test, **not proof that this new map has been played in-game**.
The movement regression extracts and executes the actual canonical method in a
minimal scene harness; it is not a full running Phaser scene.

See [evidence and acceptance](EVIDENCE.md) for exact counts, before/after observations,
public CI links, and the distinction between source/controller, actual browser,
actual game and physical-device evidence. Re-run checks on the corrected-base head;
old-head CI is not automatically a new-head CI pass.

## Risks, rollback and remaining limits

- Web Audio requires working CORS and real browser autoplay permission. Context
  resume is attempted only through the existing native gesture/retry route.
- GainNodes avoid reliance on mutable HTML media volume, but **physical iPhone/Safari
  compatibility is unverified**. Test initial gesture, zero/mute, background audio,
  interruptions, failed resume and cleanup on real devices before acceptance.
- Existing music has a legacy volume-support fallback; this opt-in uses a graph.
  Maps using unsupported schemes must stay on legacy or provide HTTP(S) assets.
- One ambience emitter, no stereo positioning, and no arbitrary late first opt-in.
  Existing native music behavior does not require opting in.
- Per-map proximity is not a claim of gapless compressed-file loop boundaries.
- No production/live map or account was changed by this fixture or PR.
- Map rollback: remove `nativeSoundscape` and reload the map/session. Removal alone
  keeps an already opted-in same-URL session graph-backed to avoid restarting music.
- Code rollback: revert this feature's commit on the appropriate development branch
  through the owner's normal review process. No dependency or schema migration is needed.
