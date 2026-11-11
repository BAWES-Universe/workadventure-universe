# The worker's own test suite, observer off and on

Run in `voice-worker/` on Node 22.23.4, x64, against a real livekit-server 1.8.4 on the same machine, so the LiveKit tests
ran rather than being skipped. `npm run typecheck` is clean.

| run | command | test files | tests | passed | failed | skipped |
| --- | --- | --- | --- | --- | --- | --- |
| observer off (today's worker) | `npm test` | 60 | 684 | 684 | 0 | 0 |
| observer on, real Silero | `ORT_DISABLE_TELEMETRY=1 VOICE_TEST_SPEECH_OBSERVER_MODEL=<model> VOICE_TEST_SPEECH_OBSERVER_RUNTIME=<onnxruntime-node> npm test` | 60 | 684 | 684 | 0 | 0 |

The 684 include the 27 new tests in `test/speechObserver.test.ts`. This is the final build, in which one call to the
detector carries a window from each person waiting. The build before it, one window per call, passed 680 of 680 both ways
(it had 23 new tests).

With the observer on, every worker a test starts through the shared harness gets the real detector, unless the test asks for
none (one test does, to compare a conversation with and without it). What those workers' observers reported when they
closed (`VOICE_TEST_SPEECH_OBSERVER_REPORT`):

| workers with the observer | detector loaded | could not load | windows judged | people's streams started | answers discarded as late | errors | audio dropped |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 42 | 42 | 0 | 592 | 27 | 1 | 0 | 0 ms |

What this shows: nothing in the existing suite, on either transport, behaves differently with the observer listening.
What it does not show: load (see `worker-load/`), or how well the detector detects.
