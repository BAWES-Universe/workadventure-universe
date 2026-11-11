# voice-vad-eval

Offline, test-only comparison of the voice worker's volume gate with a Silero speech detector. Stage 0 and 1 of the plan agreed
on 11 Nov 2026 ("Voice bots and background noise", v2 plus the round-2 clarifications). Nothing here is part of any image or
changes how the worker behaves: the worker's Dockerfile copies `package.json`, the lock file, `schema.json` and `src` only, and
this folder sits outside `voice-worker/`.

Results: [RESULTS.md](RESULTS.md).

## What it runs

| file | what it does |
| --- | --- |
| `src/gate.ts` | Today's detector, unmodified: the worker's own `Recognition` class (`voice-worker/src/recognition.ts`) fed offline, with a stand-in for the speech provider. |
| `src/silero.ts` | Silero VAD v6.2.3 (ONNX, MIT) on `onnxruntime-node` (native CPU) or `onnxruntime-web` (WASM). One shared session, per-stream state, context and sample FIFO. |
| `src/rules.ts` | Probabilities to "a person is speaking over the bot": recent, sustained evidence with a small gap allowance; old evidence expires. |
| `src/fixtures.ts` | The labelled test set, seeded. Speakers are on one side of the tune/report split only. |
| `src/evaluate.ts`, `src/report.ts` | One pass over the fixtures, then the tables. Settings are picked on the tune half; every reported number is from the report half. |
| `src/paths.ts`, `src/parity.ts` | The same clips through both ways audio reaches the worker: a peer lane (proximity WebRTC) and a LiveKit room. |
| `src/bench.ts` | Start-up, memory, CPU and event-loop delay with N people analysed in real time. |

## Run it

```
npm ci --ignore-scripts      # the same flag as the worker's image
npm run fetch-data           # about 1 GB into ./data, not committed
npm run evaluate && npm run report
npm run parity
npm run bench
```

In the worker's base image, with its memory limit:

```
docker run --rm --memory=512m --memory-swap=512m -e ORT_DISABLE_TELEMETRY=1 -v "$PWD/..":/repo:ro -w /repo/voice-vad-eval \
  node:22-bookworm-slim node --import tsx src/bench.ts data/silero_vad_v6.2.3.onnx native 20 30 data/ms-snsd/noise_test/Typing_1.wav
```

## Pinned

| what | version |
| --- | --- |
| Game code | `universe-develop` at `8c46b599` (merge of #1990) |
| Silero VAD | v6.2.3, `silero_vad.onnx`, sha256 `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3` |
| onnxruntime-node, onnxruntime-web | 1.31.1 |
| Node | 22 (`node:22-bookworm-slim` for the bench) |

## Test audio and licences

| set | source | licence | used for |
| --- | --- | --- | --- |
| MS-SNSD `noise_test`, `noise_train` | github.com/microsoft/MS-SNSD at `fe61c4b` | MIT | 25 noise classes, first 60 s of each file |
| MS-SNSD `clean_test` | same | MIT | English sentences (150 clips, first 4 s) |
| Speech Commands (mini) | storage.googleapis.com/download.tensorflow.org/data/mini_speech_commands.zip | CC BY 4.0 | English "stop", "no", "yes", "go" (150 each), crowd recordings |
| Arabic Speech Commands | github.com/abdulkaderghandoura/arabic-speech-commands-dataset at `72f3438` | CC BY 4.0 | Arabic "stop", "no", "yes", "cancel", "close", "ok" (100 each) and 8 background noises |

Noise classes are grouped by the source's own class name (nobody listened to every file): non-speech, scene (may contain
voices), speech-like (babble, neighbours talking, announcements, cafe).

## Limits

- Offline only. No browser, no microphone processing (echo cancelling, auto volume, the browser's noise filter), no network, no
  playout. Real listener delay and real phone echo are not measured here.
- The noise is raw recordings at three fixed levels. A real microphone's audio has already been through the browser's filter, so
  today's absolute false-stop rates in the field are lower than these; the comparison between detectors is the point.
- Read speech and short commands. No dialect Arabic, no code-switching, no double-talk, no natural conversation.
- The room path uses a stand-in resampler; LiveKit's own cannot be run without a room.
