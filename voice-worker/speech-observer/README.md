# The speech observer's runtime

What the voice worker's speech observer (`../src/speechObserver.ts`) needs to run its detector, kept apart from the
worker's own dependencies so that nothing in the worker's `package.json` or lockfile changes for it:

| file | what it is |
| --- | --- |
| `silero_vad_v6.2.3.onnx` | Silero VAD v6.2.3, `src/silero_vad/data/silero_vad.onnx` (MIT). sha256 `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`. The loader refuses any other file, and the image build checks it too. |
| `package.json`, `package-lock.json` | `onnxruntime-node` pinned to exactly 1.31.1 (MIT), with the registry's integrity hashes. Installed with `--ignore-scripts`: its install script (which fetches GPU libraries) never runs. |
| `licenses/` | The licences of both, and ONNX Runtime's third-party notices. |
| `check.mts`, `checkDetector.mts` | Checks the detector as a built image holds it. Prints one line of JSON and exits with 1 when the check fails, so it can be a build or deployment step. |

## Off unless switched on

The image carries all of this, and the observer stays off. It is on only when the worker is started with
`VOICE_SPEECH_OBSERVER=1`. The image already sets the other three things it needs:

- `ORT_DISABLE_TELEMETRY=1`: the runtime's native library looks up `mobile.events.data.microsoft.com` unless this is
  in the environment before it starts. The loader refuses to load without it.
- `VOICE_SPEECH_OBSERVER_MODEL` and `VOICE_SPEECH_OBSERVER_RUNTIME`: where the model and the runtime are in the image.

Switched on, it only counts (the `observer_*` counters in `/stats` and `engine.status`). It changes nothing the bot
hears, says, or stops for. To switch it off again: remove `VOICE_SPEECH_OBSERVER` and restart the worker. Nothing else
is stored anywhere.

## In the image

The Dockerfile keeps only what the detector needs: the two packages, and the native library for the machine the image
is built for (about 46 MB on x64, 25 MB on arm64, out of 294 MB for all platforms).
