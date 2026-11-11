# The worker's own test suite, observer off and on

Run in `voice-worker/` on Node 22.23.4, x64, against a real livekit-server 1.8.4 on the same machine, so the LiveKit tests
ran rather than being skipped. Worker code as at commit `6ecffb2e`. `npm run typecheck` is clean.

| run | command | test files | tests | passed | failed | skipped |
| --- | --- | --- | --- | --- | --- | --- |
| observer off (today's worker) | `npm test` | 61 | 703 | 703 | 0 | 0 |
| observer on, real Silero from `speech-observer/` | `ORT_DISABLE_TELEMETRY=1 VOICE_TEST_SPEECH_OBSERVER_MODEL=$PWD/speech-observer/silero_vad_v6.2.3.onnx VOICE_TEST_SPEECH_OBSERVER_RUNTIME=$PWD/speech-observer/node_modules/onnxruntime-node npm test` | 61 | 703 | 703 | 0 | 0 |

703 is the 684 of follow-up 1, less the 27 observer tests there were then, plus the 42 in `test/speechObserver.test.ts`
now, plus the 4 in the new `test/speechObserver.paths.test.ts` (several people in one proximity bubble and in one LiveKit
room; one person's permission taken back while the others carry on; a session closing while its voice is slow to shut
down and microphones keep arriving).

The "on" run takes the model and the runtime from the packaging folder (`speech-observer/`, after `npm ci
--ignore-scripts` there), the same pinned files the image holds.

With the observer on, every worker a test starts through the shared harness gets the real detector, unless the test brings
its own or asks for none. What those workers' observers reported when they closed
(`VOICE_TEST_SPEECH_OBSERVER_REPORT`), added up:

| workers with the observer | detector loaded | could not load | windows answered | kept | thrown away: person gone / stream restarted / too old | failed | people's streams started | errors | deadlines passed | let go by the bounds or the clock | frames turned away after a session closed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 46 | 46 | 0 | 902 | 902 | 0 / 0 / 0 | 0 | 40 | 0 | 0 | 0 ms | 209 |

The 209 frames turned away are microphones that kept arriving after a test's session had ended; turning them away is the
fix for fault B, seen here in the ordinary tests.

What this shows: nothing in the existing suite, on either transport, behaves differently with the observer listening.
What it does not show: load (see `worker-soak/` and `worker-load/`), or how well the detector detects.
