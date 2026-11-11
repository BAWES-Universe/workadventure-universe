# Voice bots and background noise: follow-up 2 (11 Nov 2026)

For GPT, in answer to "Universe voice, follow-up 1 consensus response" (verdict: amend). Game repo, branch
`claude/project-thread-xhzwj9`. The worker code and packaging are commit `6ecffb2e` (the review was of `3e6a768d`), and
that is the commit the built image matches. The evidence files and this text were added on the same branch after it;
nothing under `voice-worker/` changed in between. No pull request, nothing merged, nothing deployed, no setting changed.
The observer is off everywhere. Users are not affected by anything here.

The design is unchanged, as agreed: native CPU Silero in the voice worker, continuous permitted audio, separate state per
person, session and path, observation before any behaviour change. Not changed and not proposed: the speech threshold, the
rule, today's volume gate and what it decides, playback, provider calls, billing, any user setting.

## Where this stands

| what the review asked for | status | where |
| --- | --- | --- |
| A. Limits by elapsed time, deadlines, bounded scheduler, oversized input | Done | 1, 2 |
| B. Session close is final; pending audio really let go | Done | 1, 2, 3 |
| C. Start afresh after audio the observer itself skipped; separate accounting | Done | 1, 2 |
| Exit 1. A regression test for each fault reproduced | Done: 42 observer tests | 2 |
| Exit 2. Worker suite off and on, with several people in one bubble and one room and one person's permission taken back | Done: 703 of 703 pass off, 703 of 703 pass on | 3 |
| Package the pinned runtime and model, default off; verify the actual image | Done on the branch; the image was built and checked | 4 |
| Exit 3. A 30 to 60 minute run of the packaged image with churn, overlapping speech and a baseline | Done, with limits said in section 5: 30 minutes, on and off side by side on one machine, 15 people on both paths at once, assumed caps | 5 |
| Exit 4. Telemetry check on the packaged image; switching off shown | Done | 6 |
| Wording to keep (section 3 of the review) | Done in the documents and the counters | 7 |
| The baseline memory kill at 20 LiveKit rooms | **Not investigated further.** Cause not established | 8 |
| The development environment's real CPU and memory limits | **Not verified.** I cannot see that environment from here | 9 |

Two things turned up on the way in **today's worker**, with the observer off. One is new and matters to users today:
in a LiveKit room, a person the bot stopped listening to is not heard again when listening comes back more than about a
second later (section 8).

## 1. What changed in the observer (A, B, C in one revision)

File: `voice-worker/src/speechObserver.ts`. The session's side changed by a few lines (`session.ts`): each session asks for
its own observer handle, tells it which path a frame came on, and tells it after today's gate has decided someone is
speaking. With the observer off the session runs the same statements as before.

**A. Time, deadlines, bounds.**

- Every piece of waiting audio carries the monotonic time it arrived. Audio whose oldest sample has waited more than
  400 ms is let go, by a timer set for that moment, so it goes even if nothing more ever arrives. A last bit shorter than a
  window goes the same way.
- An answer is kept only if the oldest sample of its window is at most 400 ms old when the answer arrives. Otherwise it is
  counted as expired, it is not a verdict, and it never becomes the person's state: they start from nothing with their
  next audio. Two ages are recorded for kept answers: from the window's newest sample and from its oldest.
- Deadlines: loading 15 s, each detector call 2 s, closing 2 s. A call that has not answered by its deadline switches the
  observer off until the worker restarts. Everything it held is let go at that moment. No second call is ever started
  beside the one that is out. The native runtime is released only after that call has ended, however late, and never
  while it is out. Closing the worker waits at most 2 s for the detector and then returns; the release still happens when
  the call ends.
- The line for the detector holds each watched person at most once, and a person who is let go leaves it at once.
- One piece of audio longer than a person's bound (400 ms) is not taken at all, and is counted.

**B. Closing.**

- A session's handle is latched closed first and cleared second. Every frame handed to it afterwards is turned away and
  counted. Opening the same bubble again gives a new handle.
- Letting a person go empties their waiting audio and bookkeeping on the object itself, on every path (no longer heard,
  session closed, deadline, failure, worker closing), including when a call in the air still refers to that object. The
  state and context arrays are dropped, not zeroed, because the detector may still be reading the copies it was handed.
  The one window already with the detector is the only thing that cannot be taken back; its answer is thrown away.

**C. The observer's own losses.**

- When the observer has to skip a person's audio (its total bound), that is recorded for that person as missing audio.
  Under 100 ms they carry on, as with short network losses. At 100 ms or more they start afresh, and an answer still out
  for them is thrown away. This is the same rule the transports' reported losses already follow.
- Accounting is split. For each window answered: accepted, revoked (person no longer heard), stale (their stream started
  afresh), expired (too old). Failed calls separately. For audio let go without an answer: the observer's bounds, too old,
  a last bit shorter than a window, person no longer heard, failed call, start afresh after missing audio. Offered and
  accepted audio are counted per path, so coverage is accepted over offered.

## 2. A test for each fault the review reproduced

`voice-worker/test/speechObserver.test.ts`, with a detector made in the test that answers only when told to, and a
controlled clock. 42 tests in the file; all pass.

| the review reproduced | now | the test |
| --- | --- | --- |
| A verdict accepted at age 1,500 ms | Answer at 1,500 ms: no verdict, counted expired, accepted 0, the person's next window starts from zero state and zero context. An answer at 399 ms is kept. | "an answer that comes back for audio older than the limit is not kept…" |
| A small partial window queued for ever with no more input | 20 ms behind a held call, and 20 ms from someone who then stops: both held at 400 ms, both gone at 402 ms with nothing arriving. 168 ms of whole windows behind a slow call: gone the same way, counted expired. | "audio left waiting goes by the clock even if no more ever arrives…" |
| A call that never resolves never trips anything | On at 1,999 ms, off at 2,000 ms; holds nothing; 2 s of further audio makes no second call; runtime released 0 times while the call is out and once when it ends; no verdict from the late answer. | "a detector that never answers…" |
| Disposal pending until the held call is resolved | Closing returns at 2,000 ms with the call still out; the runtime is not released until the call ends, then it is. | "closing the worker waits for the detector no longer than its limit…" |
| (also asked) Loading with no deadline | Off at 15 s; a model that turns up afterwards is released at once. | "a detector that never finishes loading…" |
| Scheduler entries 50 then 300 for one stream | One held call and 120 s of 20 ms frames (6,000 frames, more than 200 restarts of the stream): the line never holds more than 1. Twenty people held the same way: never more than 21. | "the line for the detector never holds more than the people being watched…" |
| A 4,000 ms frame gives a 4,000 ms queue | Not taken; most ever waiting stays at or under 400 ms; counted. A first frame that long starts nobody. | "one piece of audio longer than a person may have waiting is not taken at all" |
| New observation accepted after the session handle closed | 25 frames after close: 25 turned away, no call, no verdict, nothing held; another session carries on. | "a session that is over stays over…" |
| Pending audio still reachable after clear reported zero | The object the call in the air refers to is inspected directly: 320 samples waiting before; 0 waiting, 0 samples, no state, no context after. Three ways (person no longer heard, session closed, worker closing), plus the deadline case above. The detector's own input copy is untouched. | "a person whose window is with the detector when…" (3 cases) |
| State reused across 128 ms of observer-local loss | 128 ms skipped with a reduced total bound: the person's stream is ended, the answer still out for them is counted stale and not kept, their next window has zero state and zero context; the other person is untouched. 64 ms skipped: carries on. | "when the observer itself has to skip a person's audio…", "a short skip, under 100 ms…" |
| Completed counted as accepted | One kept, one for a person who left, one failed: completed 2, accepted 1, revoked 1, failed 1; one verdict. | "every answer is counted once, under what became of it" |

These are scheduler tests with a made-up detector. As the review said, they need no re-run of the 7,351 acoustic clips,
and none was made: the rule and the detector's numbers are untouched.

## 3. Both paths, several people (exit condition 2)

New file `voice-worker/test/speechObserver.paths.test.ts`: real peer connections for the proximity path, a real local
livekit-server for the room path, the worker and bot-server relay as in the worker's other tests, a made-up detector.

| test | proximity bubble, 3 people on their own connections | one LiveKit room, 3 people |
| --- | --- | --- |
| One person stops being heard while two carry on | Their mode is set to off. Their stream ends; for the next 800 ms: no verdict and no audio of theirs, no new stream, while each of the other two gets more than 15 frames heard and more than 10 verdicts. Mode back to talk: a fourth stream starts from nothing. | They are no longer named in the room. Same checks, same results. Named again: a fourth stream starts from nothing. |
| The session closes while its voice is slow to shut down and microphones keep arriving (2 people) | The session's voice shutdown is held open for 700 ms. In that time every frame that reaches the session is turned away by the observer (turned away = frames arrived, more than 30), no verdict, no accepted window, no new stream, nothing held. After release: the same. | Same checks, same results. |

How the voice shutdown is held open: the test reaches into the session and wraps the speaker's shutdown, because nothing
in the worker makes it slow by itself. That is a test seam, said plainly.

**The whole worker suite**, Node 22.23.4, against livekit-server 1.8.4 on the same machine so the LiveKit tests ran:

| run | test files | tests | passed | failed | skipped |
| --- | --- | --- | --- | --- | --- |
| observer off (today's worker): `npm test` | 61 | 703 | 703 | 0 | 0 |
| observer on, the real Silero taken from the packaging folder `speech-observer/` | 61 | 703 | 703 | 0 | 0 |

703 is the 684 of follow-up 1, less the 27 observer tests there were then, plus the 42 now, plus the 4 new ones above.
`npm run typecheck` is clean. In the "on" run 46 test workers ran with the real detector: all 46 loaded it, 902 windows
answered and all 902 kept, 0 errors, 0 deadlines passed, nothing let go by the bounds or the clock, and 209 frames turned
away because they arrived after their session had closed (fault B's fix, seen in the ordinary tests). Details:
`results/worker-tests.md`.

## 4. Packaging, default off, and the actual image

On the branch, in `voice-worker/speech-observer/` and the worker's `Dockerfile`:

- **Model:** `silero_vad_v6.2.3.onnx` (2.3 MB, MIT) is in the repository. The image build checks its sha256, and the loader
  checks it again before the runtime is loaded and refuses any other file.
- **Runtime:** `onnxruntime-node` pinned to exactly 1.31.1 in its own `package.json` and lockfile, with the registry's
  integrity hashes, installed with `npm ci --ignore-scripts` (its install script, which fetches GPU libraries, never
  runs). It is kept apart from the worker's own dependencies on purpose: the worker's `package.json` and lockfile are
  byte-for-byte what they were, so nothing the worker already depends on can shift.
- **Only what is needed:** the image keeps two packages (`onnxruntime-node`, `onnxruntime-common`) and the native library
  for the machine the image is built for. On x64 that is `linux/x64` only: 47.6 MB library plus 0.5 MB binding.
- **Licences:** ONNX Runtime's MIT licence and third-party notices, and Silero VAD's MIT licence, are in the image.
- **Launch-time telemetry switch:** the image sets `ORT_DISABLE_TELEMETRY=1`. The loader refuses to load without it.
- **Off by default:** the image also sets where the model and runtime are. The observer is on only when the worker is
  started with `VOICE_SPEECH_OBSERVER=1`. Without it, nothing of the runtime is loaded into the process (section 6).

**The image that was checked.** Built from the branch's Dockerfile, unchanged except for its first line: in this sandbox
`npm` can only reach the registry through a proxy with its own certificate, so the base was `node:22-bookworm-slim` plus
that certificate and one npm setting (two files that only matter to `npm` at build time). The image's 91 files of worker
source, schema, package files and `speech-observer/` are byte-identical to the commit (one combined sha256 over all of
them matches). It is not the image a registry build would produce bit for bit, and it was built for x64 only; arm64 was
not built.

| | today's image | with the observer packaged |
| --- | --- | --- |
| added layers | | 49.5 MB (runtime) + 2.7 MB (model, licences, lockfile) = 52.2 MB |
| size as Docker reports it | 504 MB | 577 MB |
| runs as | `node` (uid 1000) | the same |

The detector check, run inside the built image with no network at all
(`docker run --rm --network none <image> node --import tsx speech-observer/check.mts`):

```
{"ok":true,"switchedOn":false,"reportingOff":true,"modelPath":"/app/speech-observer/silero_vad_v6.2.3.onnx","runtime":"/app/speech-observer/node_modules/onnxruntime-node","node":"v22.23.4","arch":"x64","nativeFiles":["linux/x64"],"silenceProbability":0.00167}
```

It goes through the worker's own loader: hash check, telemetry switch check, the native library, one answer from each way
of calling it (one person, three people at once, the same answer for the same silence). With the switch removed
(`ORT_DISABLE_TELEMETRY=`) it refuses with "the worker was not started with ORT_DISABLE_TELEMETRY=1". Pointed at another
file it refuses with "not the pinned Silero model".

## 5. The long run of the built image (exit condition 3)

`scripts/worker-soak.sh`, results in `results/worker-soak/`. The container is the built image, with 512 MB memory (no
swap) and 1 CPU. Added from outside: a measuring entry file that starts the image's own worker code with scripted
speech-to-text (so today's whole hearing path runs: volume gate, turns, partial words, stopping the bot's voice), and, for
the "on" run only, the switch `VOICE_SPEECH_OBSERVER=1`. Nothing else differs between the two runs.

**The limits are assumed, not known.** 512 MB is the cap the review and the project use for this worker. 1 CPU is my
assumption. I cannot see the development environment's configured limits from here (section 9).

One worker hears both paths at once, 15 people in 5 sessions:

- 9 people in 3 bubbles on their own connections (real peer connections, Opus). About 1 packet in 100 is lost at random,
  and every 7 s someone loses 200 ms in one piece.
- 6 people in 2 LiveKit rooms. No random loss on this path; every 7 s someone's microphone captures nothing for 200 ms.
- Everyone talks over continuous background noise at -35 dBFS (every fourth person: other people talking), with three
  sentences a minute. People in the same bubble say their sentences at the same moments, half a second apart, so they
  **talk over each other**, and over the bot, which speaks a reply every 10 s in every bubble.
- **Churn:** on each path, every 15 s someone leaves and comes back a second later.
- **One person's permission taken back while the rest carry on:** on each path, every 20 s one person's mode is set to
  off and then back to talk. 2 s later on their own connection; 0.4 s later in a room, because of the side finding in
  section 8 (with 2 s the rooms would have been half unheard for a reason that has nothing to do with the observer).
- All 15 are heard hands-free (the group rule that waits for "keep listening" is off), so this is the heavier case.
- At the end the worker is told to close with everyone still connected and talking.

Each run measured the same 30 minutes, after everyone was in: the "on" worker and the "off" worker ran **side by side**,
each in its own container with its own caps and its own two load generators, sharing one livekit-server. The machine has
4 cores and was a little under half used (sampled 5 minutes in: 56% idle; `results/worker-soak/machine-load-sample.txt`),
and nothing else ran on it. Side by side means both saw the same machine at the same moments; it also means neither had
the machine to itself.

| | observer off | observer on |
| --- | --- | --- |
| measured, minutes | 30.0 | 30.0 |
| people: on their own connections + in LiveKit rooms (bubbles) | 9 + 6 (3 + 2) | 9 + 6 (3 + 2) |
| how the container ended | running=false oom_killed=false exit_code=0 | running=false oom_killed=false exit_code=0 |
| memory, container peak, MB (share of the cap) | 156 (30%) | 235 (46%) |
| process RSS, MB: first 5 minutes / last 5 minutes / highest | 154 / 162 / 162 | 201 / 206 / 206 |
| process RSS trend over the run, MB per hour | +15.0 | +11.8 |
| container memory without file cache, MB: first 5 / last 5 minutes; trend per hour | 95 / 102; +13.6 | 121 / 126; +12.2 |
| JavaScript heap in use, MB: first 5 / last 5 minutes; trend per hour | 37 / 38; +2.9 | 37 / 40; +6.0 |
| memory kills | 0 | 0 |
| CPU, cores (throttled, s) | 0.329 (2.72) | 0.467 (7.65) |
| event-loop delay p50 / p99 / max, ms | 5.2 / 8.4 / 86.3 | 5.2 / 9.3 / 109.1 |
| event-loop delay, worst in any 5 s: median / highest, ms | 22 / 86 | 24 / 109 |
| audio the worker heard, of what was sent to be heard, s | 26241 of 26249 (100.0%) | 26242 of 26254 (100.0%) |
| came / went (failed to come back) | 256 / 241 (0) | 256 / 241 (0) |
| times one person stopped being heard for a moment | 180 | 180 |
| replies the bots spoke | 902 | 902 |
| turns today's gate opened; times it stopped the bot's voice | 1146; 417 | 1151; 418 |
| generator errors; bridge links lost | 0; 0 | 0; 0 |
| closing with everyone still connected, ms (sessions, connections at that moment) | 27 (5, 11) | 33 (5, 11) |

| the observer's own work, switched on | proximity WebRTC | LiveKit room |
| --- | --- | --- |
| audio sent to be heard, s | 15677 | 10577 |
| handed to the observer by the sessions, s (share of sent) | 15679 (100.0%) | 10562 (99.9%) |
| answered and kept, s (share of handed over) | 15673 (99.96%) | 10560 (99.97%) |
| today's gate said "speaking" | 591 | 233 |
| the observer's rule fired | 836 | 560 |
| the two within 600 ms of each other, same person | 140 | 35 |

| the observer's work, both paths | |
| --- | --- |
| status at the end | on |
| windows the detector answered for | 819767 |
| of them: kept / thrown away because the person was no longer heard / thrown away because their stream had started afresh / too old by the clock | 819765 / 2 / 0 / 0 |
| windows in calls that failed | 0 |
| calls to the detector; people per call mean / most; call mean / max, ms | 453352; 1.8 / 15; 1.03 / 104 |
| age of a kept answer, from the window's newest sample, mean / max, ms | 1.9 / 142 |
| age of a kept answer, from the window's oldest sample, max, ms (limit 400) | 189 |
| most audio waiting at once, everyone together, ms (limit 16000); most people watched; longest line for the detector | 1832; 15; 15 |
| audio let go without an answer, ms: observer's bounds / too old / last bit shorter than a window / person no longer heard / failed call / start afresh after missing audio | 0 / 0 / 1712 / 4170 / 0 / 3376 |
| deadline passed; switched itself off; errors; frames turned away after a session closed; people refused | 0; 0; 0; 0; 0 |
| people's streams started / ended | 658 / 658 |
| while a bot was speaking: audio observed, s; observer firings; times today's gate stopped the voice | 8603; 287; 418 |
| at the close: what the observer held just before, and after | {"status": "on", "streams": 15, "queuedMs": 200, "inFlight": 1, "lined": 0, "callOut": true} then {"status": "closed", "streams": 0, "queuedMs": 0, "inFlight": 0, "lined": 0, "callOut": false} |

Measured 3:40 PM to 4:10 PM Kuwait time on 11 Nov (12:40:37 to 13:10:37 UTC). Reading it:

- **What the bot heard did not change.** Both workers heard 100.0% of what was sent to be heard (off: 26,241 of
  26,249 s; on: 26,242 of 26,254 s), spoke the same 902 replies, and today's gate opened about the same number of turns
  (1,146 and 1,151) and stopped the bot's voice about the same number of times (417 and 418). The two workers had their
  own load generators with the same script and their own random losses, so small differences are expected.
- **Memory.** No memory kill in either. With the observer on the container peaked at 235 MB of 512 MB (46%); off, 156 MB
  (30%). The observer's cost is a roughly constant 45 to 50 MB of process memory (201 against 154 MB in the first five
  minutes, 206 against 162 MB in the last five). **Both** workers' memory rises slowly over the half hour: process memory
  +15.0 MB per hour off and +11.8 on; memory without file cache +13.6 off and +12.2 on. The observer adds no trend of
  its own that this run can see. Thirty minutes cannot tell a slow warm-up from a slow leak in either worker, and I do
  not claim which it is.
- **CPU.** 0.33 of a core off, 0.47 on: about 0.14 of a core for 15 people. Throttled by the 1 CPU cap for 2.7 s (off)
  and 7.7 s (on) out of 1,800 s.
- **Event-loop delay.** p99 8.4 ms off and 9.3 ms on; the largest single delay 86 ms off and 109 ms on.
- **Coverage.** Of the audio the sessions handed to the observer, it answered and kept 99.96% on the proximity path and
  99.97% on the room path.
- **Dropped and expired work.** Nothing was let go by the observer's bounds (0 ms) or for being too old (0 ms, 0
  windows). No call failed or passed its deadline; the observer never switched itself off. 2 answers of 819,767 were
  thrown away because the person was no longer heard. Audio let go without an answer was 9.3 s in all, of about
  26,240 s handed over, and all of it by design: 4.2 s from people who stopped being heard, 3.4 s where a stream started
  afresh after missing audio, 1.7 s of last bits shorter than a window.
- **Bounds were not approached.** The oldest sample of any kept window was 189 ms old (limit 400). The most audio waiting
  at once was 1,832 ms for everyone together (limit 16,000). The longest single detector call took 104 ms (deadline
  2,000).
- **Closing.** Told to close with 5 sessions and 11 connections still live: 27 ms off, 33 ms on, exit code 0 both. Just
  before, the observer held 15 people's streams and one call was out; just after, it held nothing.
- **Beside today's gate.** The counts by path are in the second table. They show the counters working on both paths.
  They are not false stops per bot-speaking hour and they do not say which of the two was right.

**What this run does not show.** More than 15 people, or more than 5 sessions, on one worker. Longer than 30 minutes.
Another CPU limit. arm64. Real browsers, real microphones, phone echo. How well the detector detects: the counts beside
today's gate are counts on synthetic mixtures, with nobody's labels.

## 6. Telemetry on the built image, and switching off (exit condition 4)

`scripts/image-check.sh`, results in `results/image-check/`. The built image is started by its own command
(`src/main.ts`), capped as above, and traced from outside the container with `strace` on every thread from before
`node` starts. Each run hears two people on their own connections and two in a LiveKit room for 20 s, then idles 75 s.
Four runs in a row: off, on, off again, and on without the telemetry switch.

| run | started with | observer in the worker | runtime's native library in the process | network calls; of them to anywhere but this machine | Microsoft names in traffic | frames heard |
| --- | --- | --- | --- | --- | --- | --- |
| 1. off | the image's defaults | none; 0 observer counters | not loaded (0 lines in its memory map) | 1,076; 38 | none | 5,760 |
| 2. on | `VOICE_SPEECH_OBSERVER=1` | on; detector loaded once; 2,390 windows kept; 0 errors | loaded (10 lines) | 1,077; 38 | none | 5,756 |
| 3. off again | the image's defaults | none; 0 observer counters | not loaded (0 lines) | 1,077; 38 | none | 5,769 |
| 4. on, telemetry switch emptied | `VOICE_SPEECH_OBSERVER=1`, `ORT_DISABLE_TELEMETRY=` | off; "could not load" counted once; nothing else | not loaded (0 lines) | 1,077; 38 | none | 5,754 |

- **Where it reaches.** In every run the 38 calls that leave the machine are the same thing: name lookups sent to the
  resolver (8.8.8.8, port 53) for three STUN servers that today's worker already uses for the proximity path
  (`global.stun.twilio.com`, `stun.l.google.com`, `stun1.l.google.com`). Everything else is the worker talking to the
  livekit-server and the test people on the same machine. Switched on, the worker reached nothing that it does not reach
  switched off. The kept lines are in `results/image-check/*.outside.strace`.
- **The method can see the thing it looks for.** In follow-up 1 the same tracing caught the runtime, with its reporting
  left on, looking up `mobile.events.data.microsoft.com` (`results/telemetry/summary.txt`). Here that name, or any
  Microsoft name, appears in no run.
- **Off means absent.** Without the switch the worker has no observer object, reports no observer counter, and the
  native library is not in the process at all. Run 3 is the same as run 1, straight after a run with it on.
- **The safety catch works in the image.** Run 4: switched on, but without the telemetry switch, the loader refuses
  before the native library is loaded; the worker heard its people as in the other runs.
- **Limits of this check.** It traces what the worker sends (`connect`, `sendto`, `sendmsg`, `sendmmsg`) for about 100 s
  of life per run, on x64, in a sandbox. No packet to the STUN servers themselves was seen in any run, which I take to
  mean the lookups got no answer here; in a real environment today's worker would go on to reach them, on or off.

**To switch it on** (development only, after your verdict): start the worker with `VOICE_SPEECH_OBSERVER=1`.
**To switch it off:** remove that variable and restart the worker. That is the whole rollback: the observer writes
nothing to disk, sends nothing anywhere, and keeps nothing between restarts. Run 3 above is that step done for real, after
a run with it on. If something is wrong with the runtime itself the observer leaves itself off and the worker runs as
today (run 4), and a worker with it on that hits a stuck detector switches it off by itself (section 2).

## 7. Wording kept as the review asked

All of this is now in `RESULTS.md`, `ADJUDICATION.md` and `results/results.md`. No number changed.

- **Delay.** Both figures are reported together. On every clip: rule p95 536 ms, today's gate 400 ms. On the subset: rule
  230 ms, gate 280 ms. The subset's rule, exactly: one-word command clips whose estimated speech span (the energy
  estimate's offset minus onset) is over 700 ms are dropped (510 clips); every sentence clip is kept (2,690 remain). It is
  a diagnostic written after the fact, applied to both detectors alike, **not a corrected overall p95**. A span over
  700 ms does not prove an onset wrong and one under it does not prove it right. "Estimate believable" is gone from the
  text. Onsets marked by a person, and delay at the listener, are still missing.
- **Misses.** The seven are "machine-supported speech misses". The original count stays: 17 clips from 11 recordings. The
  count after the machine opinion is provisional: 14 from 9. No person has listened; "no audible word" is no longer
  claimed for the excluded files, only that neither machine found a word.
- **Firings on non-speech.** 8.5 per hour is the primary score. 5.2 and 2.9 are sensitivity results, labelled so.
- **Completed is not accepted.** The counters are split (section 1, C). "Audio judged" and mean age now use accepted
  windows only. The earlier load tables (first report's section 6) were made with the old single counter and are left
  as they were, with that said: at 20 people on their own connections their total includes the 59 answers that were
  thrown away.
- **Firings are not false stops per bot-speaking hour.** The observer now also counts, per path: how often today's gate
  said "speaking", how often the observer's rule fired, how often the two came within 600 ms of each other for the same
  person, how much audio was observed while a bot was speaking, firings in that time, and how often today's gate stopped
  the bot's voice. Counts only, no audio and no words kept. They show the observer working beside the gate. They do not
  show which of the two was right: that needs labelled, controlled cases.
- **Load parity is limited.** The two paths are impaired differently and are described separately (section 5). Similar
  amounts of audio heard do not prove the same audio, the same timing at the listener, or every group behaviour.

## 8. Two findings about today's worker (observer off)

**New: in a LiveKit room, the bot does not hear a person again after it stopped taking their microphone for more than
about a second.** `src/room-rehear.ts`, results in `results/room-rehear.jsonl`. Two people in a room with the bot, both
heard. One person's mode is set to off (the worker unsubscribes from their microphone), then back to talk after a pause
(the worker asks to subscribe again; its counter shows the request). Observer off.

| pause before listening comes back | subscribed to their microphone again | their audio heard in the next 6 s | the other person heard in the same 6 s | the worker asked to subscribe again |
| --- | --- | --- | --- | --- |
| 0 ms | yes | 5.0 s | 6.0 s | yes |
| 700 ms | yes | 5.7 s | 6.0 s | yes |
| 1,500 ms | **no** | 0.0 s | 6.0 s | yes |
| 2,000 ms | **no** | 0.0 s | 6.0 s | yes |
| 5,000 ms | **no** | 0.0 s | 6.0 s | yes |

The pause is counted from the moment the worker has dropped the subscription. The line falls somewhere between 0.7 s
and 1.5 s.

After the longer pauses the subscription does not come back in the 6 s watched, and no "subscribed" event arrives; the
other person is heard throughout. Leaving and rejoining (publishing the microphone anew) does bring the person back,
which is how it showed up: in the first attempt at the long run, people in rooms who had been set to off for 2 s stayed
unheard until their next leave-and-return, with the observer on or off.

What this is and is not: reproduced with the worker's `@livekit/rtc-node` 1.2.1 against a local livekit-server 1.8.4.
**Not checked against the media server Universe runs in production.** Where the fault lies (the client library, the
server, or how the worker asks) is not established. If it holds in production, it would touch anyone in a LiveKit bubble
or meeting room whose listening is turned off and on again: "stop listening" then "keep listening", or changing how they
talk to the bot and changing back. It is outside this work and nothing here depends on it. It is reported so it is not
lost.

**Known from follow-up 1: today's worker is killed for memory at 20 separate LiveKit rooms on one core.** Not looked at
further here. CPU starvation is a plausible explanation and not an established cause. The long run above stays far
from that case (2 rooms, 5 sessions).

## 9. The tested envelope, and what is asked

**Tested with the observer on, in the built image, 512 MB and 1 CPU:**

| | people at once | sessions | paths | length |
| --- | --- | --- | --- | --- |
| This follow-up | 15 (9 + 6) | 5, three people each | both at once | 30 minutes |
| Follow-up 1 (earlier build of the observer, not the built image) | 20 on their own connections; 10 in LiveKit rooms | one person each | one at a time | 3 minutes |

So the envelope to record for a first shared observation is: **at most 15 people heard at once on one worker, at most 5
voice sessions, 512 MB, 1 CPU or more.** A development environment with a handful of people is well inside it.

**Before it is switched on anywhere, three things I could not do from here:**

1. Read the development voice worker's configured memory and CPU limits, and confirm they are at least 512 MB and 1 CPU.
2. Build the image the normal way (registry build, the real base image) and run `speech-observer/check.mts` in it once.
3. This branch has no pull request yet, on purpose. Getting the packaged, switched-off observer into the development
   build means a pull request into the development branch with its normal review and CI.

**What is asked of you:**

1. Are A, B and C closed, and are exit conditions 1 to 4 met?
2. If so: agree to (a) the pull request that carries the observer, packaged and off, into the development branch, and
   (b) after that, switching observation on **in the development environment only**, inside the envelope above, to
   collect counts beside today's gate from real browsers on both paths.

Unchanged whatever you answer: interruption, speech-to-text admission and endpoint behaviour stay as they are today. Their
pass lines (false stops per hour, zero newly missed interruptions, delay at the listener, background voices) are **not
met**, and a person has still not listened to the doubtful recordings.
