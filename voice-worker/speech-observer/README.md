# The speech observer's runtime

What the voice worker's speech observer (`../src/speechObserver.ts`) needs to run its detector, kept apart from the
worker's own dependencies so that nothing in the worker's `package.json` or lockfile changes for it:

| file | what it is |
| --- | --- |
| `silero_vad_v6.2.3.onnx` | Silero VAD v6.2.3, `src/silero_vad/data/silero_vad.onnx` (MIT). sha256 `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`. The loader refuses any other file, and the image build checks it too. |
| `package.json`, `package-lock.json` | `onnxruntime-node` pinned to exactly 1.31.1 (MIT), with the registry's integrity hashes. Installed with `--ignore-scripts`: its install script (which fetches GPU libraries) never runs. |
| `licenses/` | The licences of both, and ONNX Runtime's third-party notices. |
| `check.mts`, `checkDetector.mts` | Checks the detector as a built image holds it. Prints one line of JSON and exits with 1 when the check fails, so it can be a build or deployment step. |

## On by default, with one off switch for engineers

The image carries all of this, and the observer is on: the worker turns it on wherever the model is set, and the image
sets it, with the other things it needs:

- `ORT_DISABLE_TELEMETRY=1`: the runtime's native library looks up `mobile.events.data.microsoft.com` unless this is
  in the environment before it starts. The loader refuses to load without it.
- `VOICE_SPEECH_OBSERVER_MODEL` and `VOICE_SPEECH_OBSERVER_RUNTIME`: where the model and the runtime are in the image.

It watches at most `VOICE_SPEECH_OBSERVER_MAX_STREAMS` people at once (default 15, the load it was measured at); anyone
beyond that is not watched, and today's rule decides for them. Nothing is stored anywhere.

**Off switch, for engineers only:** start the worker with `VOICE_SPEECH_OBSERVER=0` (and restart). The observer and the
pause are then off for every bot, and every bot is back to today's rule: the voice stops on any loud sound.

## The pause, for every bot

With the observer on, for every bot, a loud sound while the bot speaks pauses its voice instead of stopping it, and the
voice stops only once the sound is confirmed as speech; it goes on from the same spot after a clean, empty result and
fresh silence, or, while the stretch is still open (a fan), once the detector has followed the person without a break
and heard no speech for 1.5 s since the sound and no words have come: then it keeps watching that stretch and stops as
today on any words, detector speech, failure or loss of view (`../src/yieldControl.ts`). There is no per-bot list and
no user setting. `VOICE_YIELD_POLICY` is `hold` unless set to `confirm` or `dip`, which exist only for comparison. Its
counters are `yield_*` and `playback_hold*`.

## In the image

The Dockerfile keeps only what the detector needs: the two packages, and the native library for the machine the image
is built for (about 46 MB on x64, 25 MB on arm64, out of 294 MB for all platforms).
