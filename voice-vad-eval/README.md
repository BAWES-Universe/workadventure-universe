# voice-vad-eval

Test-only work for "voice bots and background noise" (plan v2, agreed 11 Nov 2026, and the Stage 1 review of the same day):

1. an offline comparison of the voice worker's volume gate with a Silero speech detector, and
2. load and lifecycle measurements of the worker with its **speech observer**: an internal second listener in
   `voice-worker/src/speechObserver.ts` that is off unless the worker is started with it, and only counts.

Nothing in this folder is part of any image: this folder sits outside `voice-worker/`, which is all the worker's
Dockerfile reads. What the image does carry for the observer (the pinned model and runtime, off by default) is in
`voice-worker/speech-observer/`.

Results, newest first: [FOLLOWUP2.md](FOLLOWUP2.md) (the observer's corrections, packaging, the long run of the built
image), [RESULTS.md](RESULTS.md) (the offline comparison and the first worker runs), and the second opinion on doubtful
recordings, [ADJUDICATION.md](ADJUDICATION.md).

## What it runs

| file | what it does |
| --- | --- |
| `src/gate.ts` | Today's detector, unmodified: the worker's own `Recognition` class fed offline, with a **specified fake provider** (waits 1.8 s of quiet, no end-of-speech events; says nothing, or a word per 300 ms of audio). Also the candidate through the same lifecycle (`runLifecycleOnVerdicts`). |
| `src/silero.ts` | Silero VAD v6.2.3 (ONNX, MIT) on `onnxruntime-node` (native CPU) or `onnxruntime-web` (WASM), for the offline runs only. The worker has its own bounded version. |
| `src/rules.ts` | Probabilities to "a person is speaking over the bot": recent, sustained evidence with a small gap allowance; old evidence expires. |
| `src/fixtures.ts` | The test set, seeded. Labels are estimates, not human labels (see the file). Command speakers are on one half only; sentences are split by file. |
| `src/scoring.ts` | How a speech clip is scored: VALID, EARLY (ambiguous), fired on BACKGROUND, NONE. |
| `src/run-all.ts`, `src/evaluate.ts`, `src/report.ts` | One pass over the fixtures (fails if any part fails), then the tables. The report refuses a run that is not complete: every clip of the fixture list exactly once. |
| `src/paths.ts`, `src/parity.ts` | The same clips through a reconstruction of both ways audio reaches the worker: a peer lane (proximity WebRTC) and a LiveKit room. Simulated. |
| `src/export-clips.ts`, `scripts/adjudicate.py` | Writes chosen clips as WAV and asks Whisper and a second voice detector what is in them. |
| `scripts/telemetry-check.sh`, `src/telemetry-probe.ts` | Does the runtime reach out by itself, with and without `ORT_DISABLE_TELEMETRY=1`? Under strace, no proxy. |
| `scripts/worker-telemetry-check.sh` | The same question for the whole worker hearing one person, observer off and on, traced the same way. |
| `scripts/worker-load.sh`, `src/worker-under-load.ts`, `src/load.ts`, `scripts/worker-load-table.py` | The whole worker in its base image under its memory cap, observer off and on: real bridge, real peer connections (proximity) or real LiveKit rooms, audio from the test recordings, loss, people leaving and returning, the bot speaking. Then the table. |
| `scripts/worker-soak.sh`, `scripts/worker-soak-table.py` | A long run of the **built worker image** under its caps, observer off and on: one worker hearing bubbles of several people on both paths at once, people talking over each other, leaving and returning, one at a time not heard for a moment; then closing with everyone connected. Then the tables. |
| `scripts/image-check.sh` | The built image started by its own command, traced from outside from before `node` starts: where it reaches on the network with the observer off, on, off again, and on without the telemetry switch; and what the switch does. With `YIELD=1`, also the pause on for the load's bots and then switched off by removing `VOICE_YIELD_BOTS`. |
| `src/yield-replay.ts`, `src/yield-report.ts` | Today's rule against the pause candidates on identical inputs, through the worker's own `Recognition` and `YieldControl` on simulated time, with a scripted provider. Validated, disjoint halves: `npm run yield-sweep` picks the quiet window on the tune half by a rule written in the code, `npm run yield-replay` runs the report half once. |
| `../voice-worker/test/measure/receiverTiming.ts` | What a listener receives on each transport (timestamps of the bot's audio arriving), today's rule against the pause, repeated trials, synthetic input on loopback. Run by hand, not part of the suite. |
| `src/room-rehear.ts` | A side finding about today's worker (observer off): is a person in a LiveKit room heard again after the bot stopped taking their microphone and takes it again? |
| `src/batch-parity.ts` | The worker's detector, real recordings: the same answers whether people's windows go to it one by one or several in one call? Fails if not. |
| `src/bench.ts` | The detector alone in a bare process. Not the worker. |

## Run it

```
npm ci --ignore-scripts      # the same flag as the worker's image
npm run fetch-data           # about 1 GB into ./data, not committed
npm run evaluate && npm run report
npm run parity
npm run batch-parity
npm run telemetry-check      # needs strace
npm run worker-telemetry-check   # needs strace and the installs the worker's tests need
npm run worker-load          # needs Docker, a livekit-server on 127.0.0.1:7880 (dev keys) and the same installs
docker build -t voice-worker:observer-packaged ../voice-worker
npm run worker-soak          # the built image, 30 minutes on and 30 off; needs the same as worker-load
npm run image-check          # the built image; needs strace and root as well
npm run room-rehear          # needs the livekit-server
```

The worker's own tests, a second time with the observer switched on for every test that carries audio, using the model
and runtime as the image holds them:

```
cd ../voice-worker
(cd speech-observer && npm ci --ignore-scripts)
ORT_DISABLE_TELEMETRY=1 VOICE_TEST_SPEECH_OBSERVER_MODEL=$PWD/speech-observer/silero_vad_v6.2.3.onnx \
  VOICE_TEST_SPEECH_OBSERVER_RUNTIME=$PWD/speech-observer/node_modules/onnxruntime-node npm test
```

## Evidence kept in `results/`

| file | what |
| --- | --- |
| `results.md`, `parity.md` | the tables, as generated |
| `per-clip.tsv` | every clip: half, source recording and its sha256, speaker, estimated bounds, each detector's firings and outcome, the second opinion |
| `raw.jsonl.gz` | the raw run: per clip, today's gate under four settings and every Silero probability at full precision |
| `newly-missed.tsv` | clips today's gate catches and the frozen rule does not |
| `adjudication.tsv`, `adjudication-sources.tsv`, `adjudication-clips.tsv` | the labels, and what the two tools said about every speech recording and every exported clip |
| `telemetry/` | strace of the runtime with and without the switch, and of the whole worker with the observer off and on (for the worker: only the calls that leave the machine) |
| `worker-load/` | per run: the container's own memory and CPU figures, event-loop delay, the observer's counters, and what the load generator did |
| `worker-soak/` | the long run of the built image, observer on and off: the worker's summary, its 5-second trace (memory, sessions, event-loop delay), what each load generator did, how closing went, how the container ended |
| `image-check/` | the built image traced with the observer off, on, off again, and on without the telemetry switch: only the calls that leave the machine, the worker's own statistics, and one summary line each |
| `room-rehear.jsonl` | the side finding about hearing a person again in a LiveKit room |
| `worker-load-first-build/` | the same for the first build of the observer (one window per call), which fell behind at 20 people; kept as it was measured |
| `batch-parity.json` | one by one against several in one call, on real recordings |
| `worker-tests.md` | the worker's test suite with the observer off and on |
| `picks.json` | the rule picked in the first run on the tune half; frozen since |
| `bench.jsonl` | first run only: the detector alone in a bare process (not the worker) |

## Pinned

| what | version |
| --- | --- |
| Game code | `universe-develop` at `8c46b599` (merge of #1990) |
| Silero VAD | v6.2.3, `silero_vad.onnx`, sha256 `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3` |
| onnxruntime-node, onnxruntime-web | 1.31.1 |
| Node | 22.23.4, x64, in `node:22-bookworm-slim` (digest in `results/worker-load/image.txt`) |
| Second opinion | sherpa-onnx 2.0.1 with Whisper base (multilingual, int8); webrtcvad-wheels |

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

- Offline and local only. No browser, no microphone processing (echo cancelling, auto volume, the browser's noise filter), no
  real network, no playout. Real listener delay and real phone echo are not measured here.
- The noise is raw recordings at three fixed levels. How often noise stops a bot in the field was **not measured**. A guess
  that the browser's filter makes it rarer is only a guess: auto volume and room acoustics can push it either way.
- Variants of one recording are not independent. Rates are for this set, not for production.
- Read speech and short commands. No dialect Arabic, no code-switching, no double-talk, no natural conversation.
- The path check is a reconstruction: LiveKit's own resampler, packet loss, jitter and reconnects are not in it. The load
  runs use real peer connections (with loss) and real LiveKit rooms on one machine: they show the observer working on
  both paths, not how well it detects there.
- The second opinion is a machine opinion, not a person listening.
