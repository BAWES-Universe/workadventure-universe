# Voice bots and background noise: follow-up to the Stage 1 review (11 Nov 2026)

For GPT, in answer to "Universe voice, Stage 1 evidence review". Branch `claude/project-thread-xhzwj9`, game repo. No pull
request, nothing merged, nothing deployed, no setting changed. Users are not affected by anything here.

## Where this stands

The review's five work items, in its order:

| # | item | status |
| --- | --- | --- |
| 1 | Correct metric names, pass statuses, source and variant counts, durations, reproducibility checks | Done (section 2). The headline hold-time claim was wrong as worded and is withdrawn; the equal measurement is in its place. |
| 2 | Verify telemetry suppression on the pinned package, attributable | Done (section 4). By default the runtime does look up a Microsoft host by itself; with the switch set at launch it makes no network call at all. |
| 3 | Adjudicate the nine miss recordings, the false-trigger recordings, the latency tail; publish original and corrected scores | Done by machine, **not by a person listening** (section 3, ADJUDICATION.md). Real misses remain. |
| 4 | Default-off worker integration, bounded queues, epoch-safe reset and disposal, unchanged authoritative behaviour; whole-worker resource and lifecycle tests | Built on the branch and measured (sections 5 and 6). The first build fell behind at 20 people and was changed; the second is what is reported. |
| 5 | Present the operational evidence before enabling live shadow | This file. Live shadow is **not** enabled anywhere. |

Not changed and not proposed here: interruption behaviour, speech-to-text admission, any threshold or timer, any user setting.

## 1. Pass lines

| agreed line | evidence now | status |
| --- | --- | --- |
| At least 80% fewer false destructive interruptions | 315 against 15 detector firings on source-labelled non-speech (95% fewer); 309 against 9 without the one recording that holds a voice | Strong on this set. Destructive playback itself still not exercised. |
| At most 1 false stop per bot-speaking hour | 8.5 per hour; 5.2 without the recording that holds a voice; 2.9 also without the uncertain one | **Not met.** |
| Zero valid interruptions newly missed | 17 clips from 11 recordings under the corrected scoring; 14 from 9 after the second opinion, at least 7 of them real | **Not met.** Most are speech at about -40 dBFS, the gate's own threshold. |
| Confirmed stop p95 at most 400 ms at the listener | Detector alone: p95 536 ms as first scored; 230 ms where the onset estimate is believable (today's gate: 280 ms). No network, no playout. | **Unmeasured end to end.** The 536 ms warning is explained (section 3), not erased. |
| Whole worker within 80% of the 512 MB cap | Worker in its base image under the cap, one core, observer off and on: proximity up to 20 people, LiveKit up to 10 rooms, 3-minute runs. Highest with the observer on: 232 MB RSS (45%). Highest of all: 300 MB (59%), observer off. | Met in these runs. At 20 separate LiveKit rooms today's worker itself, observer off, is killed for memory (section 6): a finding about the baseline. |
| Both real transports covered | Frame-size sameness exact; codec reconstruction (partial); real peer connections and real LiveKit rooms under load with the observer on; the worker's own tests for both transports pass with it on | Covered for the observer's operation. Detection quality on real transports is still only simulated. |
| Shadow cannot change behaviour or keep revoked audio | Built and tested (section 5) | Shown locally. |

## 2. Corrections to the first report

Everything is from the report half unless it says otherwise. The rule under test, Silero probability at or above 0.50 for 64 ms,
is **frozen** from the first run and was not re-picked. The run is now checked: 7,351 clips, each exactly once, all parts
finished, or the report refuses. Probabilities are kept at full precision; rounding them to 8 bits, as the first run did,
changes the frozen rule's firings in 0 of 7,351 clips. Raw results, per-clip outcomes and source hashes are in `results/`.

### R1. Hold time, measured the same way for both

The first report compared the gate's event time with Silero's share of windows. That was not a like-for-like comparison and the
sentence "45 to 98% becomes 0.1 to 0.2%" is **withdrawn**. Now both go through the worker's unchanged `Recognition` class and
the same fake providers; for Silero only the per-frame verdict is swapped (the 100 ms total, the 1.8 s quiet and the events are
today's code). "Held" runs from `user.speech_started` to the end of that stretch.

| noise | level dBFS | held: gate, silent provider | held: Silero verdict, silent provider | held: gate, provider hears words | held: Silero verdict, provider hears words | detector activity only (windows at or above 0.50) |
| --- | --- | --- | --- | --- | --- | --- |
| non-speech | -45 | 45.3% | 0.3% | 57.5% | 0.4% | 0.1% |
| non-speech | -35 | 95.6% | 0.6% | 96.5% | 0.7% | 0.2% |
| non-speech | -25 | 98.1% | 0.5% | 98.4% | 0.8% | 0.2% |
| scene | -45 | 51.5% | 0.0% | 71.4% | 0.0% | 0.0% |
| scene | -35 | 95.8% | 0.0% | 96.2% | 0.4% | 0.0% |
| scene | -25 | 99.3% | 0.0% | 99.7% | 0.4% | 0.0% |
| speech-like | -45 | 59.7% | 53.4% | 73.9% | 54.0% | 39.4% |
| speech-like | -35 | 98.1% | 59.7% | 98.3% | 60.2% | 48.0% |
| speech-like | -25 | 99.3% | 66.4% | 99.3% | 67.1% | 52.5% |

"Provider hears words" is the worst case for the provider-partial route: a provider that returns a word for every 300 ms of
whatever it is sent, so every opened stream announces speech. On non-speech noise the equal measurement still shows the
large drop (under 1% held). On speech-like noise it shows what the first wording hid: the candidate holds replies more than
half the time. Background voices are **not** solved by a speech detector.

Speech-to-text opened by non-speech noise, same lifecycle, silent provider: the gate opens 229 / 106 / 76 streams at
-45 / -35 / -25 dBFS and sends 61% / 98% / 99% of the noise; with Silero's verdict 4 / 7 / 8 streams and 0.4% / 0.8% / 0.9%.

### R2. Scoring: three outcomes, onset as an estimate

Onsets and ends are **estimates from energy**, and the code now says so. Each speech clip is scored for each detector as:
VALID (fires between 200 ms before the estimated onset, never before the person's recording begins, and 600 ms after the
estimated end), EARLY (fires inside the recording but earlier than that: ambiguous, never counted as a catch), fired on
BACKGROUND (before the person's recording begins), NONE. Delay is not clamped. 200 ms is the allowance for a soft first
sound.

| detector | clips | fired on background | VALID | EARLY only | NONE | newly missed (gate VALID, this not) | from recordings | newly caught | delay p50 / p95 / max ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gate 100 ms | 3,200 | 1,135 | 2,036 | 21 | 1,143 | 0 | 0 | 0 | 110 / 400 / 960 |
| gate 200 ms | 3,200 | 1,054 | 1,862 | 13 | 1,325 | 263 | 240 | 89 | 210 / 560 / 940 |
| gate 300 ms | 3,200 | 989 | 1,506 | 14 | 1,680 | 683 | 480 | 153 | 300 / 660 / 1,690 |
| Silero 0.50 for 64 ms | 3,200 | 22 | 3,150 | 5 | 45 | **17** | **11** | 1,131 | 80 / 536 / 920 |

The first report said 15 newly missed; the stricter scoring makes it 17, because two clips where the rule fired early are no
longer credited. The gate's low VALID count is mostly the two noise conditions: it has already fired on the background in
1,135 clips and does not fire again for the person.

### R3. What the test set is made of

| part | distinct recordings | distinct speakers | unique duration | clips after variants |
| --- | --- | --- | --- | --- |
| noise: non-speech | 59 | n/a | 35.2 min | 177 (3 levels, 105.6 min) |
| noise: scene | 7 | n/a | 7.0 min | 21 (21.0 min) |
| noise: speech-like | 31 | n/a | 24.7 min | 93 (74.0 min) |
| speech: English commands | 294 | 230 | 2.8 min of speech | 1,470 (5 conditions) |
| speech: Arabic commands | 281 | 14 | 2.3 min of speech | 1,405 |
| speech: English sentences | 65 | not known | 4.2 min of speech | 325 |

Variants of one recording are not independent. "1.76 hours" is 35 minutes of recordings at three levels. The first report's
"95% interval" is **withdrawn**: rates here describe this set and carry no interval for production. Firings on non-speech
came from 6 of 59 recordings (the gate fires on all 59).

### R4. Held-out speakers

Narrowed. For short commands no speaker is on both halves (0 found; both datasets put the contributor id at the start of the
file name). Arabic commands on the report half come from 14 speakers only. Sentences are split by file; their speakers are
not known, so nothing is claimed for them. The background mixed under speech comes from one pool shared by both halves.

### R5. Both paths: what was and was not tested

Status: **partial, simulated** for detection quality. Frame-size sameness is exact: 59 clips, 11,583 windows, cut as 512,
320, 160, 480 and random sizes, largest difference 0. The codec part is a reconstruction (Opus, then the worker's own
resampler for the lane, a stand-in resampler and 10 ms frames for the room). "16 kbps" is a low bitrate only, not a weak
network: no loss, jitter, silence suppression or reconnects. The noise duration is now the summed duration (35.2 min; the
first report printed the number of files as minutes).

| path | detector | VALID of 570 | newly missed on this path | delay p50 / p95 ms | firings on 35.2 min of non-speech noise |
| --- | --- | --- | --- | --- | --- |
| fixture as is | Silero rule | 566 | 3 | 78 / 504 | 7 |
| fixture as is | gate | 542 | | 110 / 440 | 102 |
| peer lane, Opus 32 kbps | Silero rule | 563 | 5 | 84 / 536 | 5 |
| peer lane, Opus 32 kbps | gate | 543 | | 120 / 520 | 121 |
| room, Opus 32 kbps, stand-in resampler | Silero rule | 564 | 5 | 84 / 536 | 4 |
| room, Opus 32 kbps, stand-in resampler | gate | 544 | | 120 / 530 | 110 |
| peer lane, Opus 16 kbps | Silero rule | 563 | 5 | 84 / 536 | 4 |
| peer lane, Opus 16 kbps | gate | 543 | | 120 / 520 | 122 |

The codec costs the rule two more of the marginal clips (5 newly missed against 3), the same recordings that are already
doubtful or very soft on the plain fixture; the ids are listed in `results/parity.md`. Real transports are exercised in
section 6, for load and lifecycle, not for detection quality.

### R6. Baseline label and reproducibility

The baseline is the worker's real `Recognition` class with a **specified fake provider** (1.8 s quiet, no end-of-speech
events), not every deployed provider. `npm run evaluate` now fails if any part fails; the report fails on a missing,
doubled or unexpected clip. The README's sentence that the browser's filter makes field rates lower is now stated as a
guess: the field rate was not measured.

## 3. Second opinion on the doubtful recordings

Full account, rules and tables: [ADJUDICATION.md](ADJUDICATION.md). Whisper (base) and the WebRTC project's voice detector,
with fixed rules; **a machine opinion, not a person listening**. All 1,350 speech recordings, 60 failed clips and 114 noise
spans were run. Original scores are kept; the adjudicated ones sit beside them.

- **Speech set:** 1,344 valid speech, 4 uncertain, 2 no speech.
- **Misses:** of the 17 clips (11 recordings), 7 clips from 5 recordings are real speech the rule did not fire on: four only
  at the very soft level, one Arabic "cancel" in noise, and one English "Stop!" at every level (probability never above
  0.26). 2 are "yes" where the rule fired early. 5 are uncertain. 3 hold no word. After taking out only the "no speech"
  recordings, for both detectors: **14 newly missed from 9 recordings**.
- **Non-speech firings:** 15, from 6 recordings. One recording is a person saying "Hmm, I love potatoes" (6 firings). One
  is uncertain (4). Four hold no words (5). Rates: 8.5 per hour as labelled, 5.2 without the voice, 2.9 also without the
  uncertain one. The gate: 178.9, 177.9, 178.1.
- **Slow tail:** 255 of the 262 VALID firings later than 400 ms are English one-word recordings whose energy estimate
  covers the whole one-second file, so the "onset" is the file's start. Where the estimate is believable (2,690 clips):
  rule p50 78 / p95 230 / max 482 ms, 99.8% within 400 ms; gate 110 / 280 / 810 ms, 99.7%.

## 4. Telemetry

`scripts/telemetry-check.sh`: each case alone under `strace -f` (every thread), with no proxy in its environment, through
load, 250 inferences, 75 seconds idle and exit. A failed attempt counts. `scripts/worker-telemetry-check.sh` does the same for
the whole worker, off and on, counting only calls that leave the machine. Traces are in `results/telemetry/`.

| case | outgoing network calls by the process |
| --- | --- |
| native runtime, default | **4**: its own threads open a socket to the resolver and ask for `mobile.events.data.microsoft.com`, four times. The lookup got no answer here, so no connection followed. |
| native runtime, `ORT_DISABLE_TELEMETRY=1` set at launch | **0** |
| WASM runtime | 0 |
| the whole worker, observer **off**, one person heard over a real peer connection, then 75 s idle | 2: the worker's own lookup of `stun.l.google.com`, once per peer connection (today's behaviour) |
| the whole worker, observer **on**, `ORT_DISABLE_TELEMETRY=1`, the same | **the same 2, nothing new.** No Microsoft name in the traffic. The observer judged 570 windows, 0 errors. |

What this shows and does not: the default native package does try to reach Microsoft by itself (attributed to the process,
not to the sandbox). What it would send was not seen, because the lookup failed; nothing shows audio being sent. With the
switch there is no attempt. In the worker the detector **refuses to load** unless the process was started with
`ORT_DISABLE_TELEMETRY=1` (tested), and it accepts only the pinned model file by sha256 (tested).

## 5. The observer in the worker (default off)

`voice-worker/src/speechObserver.ts`, `speechObserverRuntime.ts`, and small hooks in `config.ts`, `server.ts`, `session.ts`.

- **Off unless started with it:** `VOICE_SPEECH_OBSERVER=1` and `VOICE_SPEECH_OBSERVER_MODEL=<file>`. Without both, no
  observer object exists, the session's audio path is the same function as today, and the runtime is never looked for.
  The runtime package is **not** added to the worker's dependencies or image on this branch.
- **Observe only:** it has no way to send a message, stop the voice, open a recognizer or touch an allowance. It gets each
  frame after the session has handled it, takes its own copy, and never throws back. It only moves counters (`/stats`).
- **Only permitted audio:** it sits behind the same permission gates as hearing (a lane's mode, a room's named people).
- **Revocation (A):** when a person leaves, is muted by mode, is no longer named in a room, gets a newer path, or the voice
  is stopped, their waiting audio is dropped at once. An answer that comes back afterwards for a window already at the
  detector is discarded: not counted, and never the state of whoever is heard next. A newer path or 100 ms of missing audio
  starts the person afresh. Sessions are separate even if two bot servers use the same session id.
- **Bounded (B):** at most 400 ms of one person's audio and 16 s in all may wait (half a megabyte), 64 people at once;
  beyond that audio is dropped and counted, and a person whose audio waited too long starts afresh. One call to the
  detector at a time for the whole worker, on one thread. A call carries one window from each person who has one waiting
  (up to 32 people), never two of the same person. This is the second build: the first made one call per window and fell
  behind at 20 people (section 6).
- **Failure:** a failed call is counted and that person starts afresh; five in a row, or a detector that cannot load,
  switches the observer off until restart. Hearing carries on untouched.

Tests: 27 new ones (`test/speechObserver.test.ts`), including a deliberately delayed detector with a leave, a return and a
newer path arriving before the old answer; several people in one call, each keeping their own state, with one of them
leaving while the call is out; the limits; failure; refusal without the telemetry switch; and one end-to-end conversation
over a real peer connection heard word for word the same with and without it. The **whole existing worker suite passes
both ways**: 684 of 684 with the observer off, and 684 of 684 with the real Silero observer switched on for every test
that carries audio (42 workers, 592 windows judged, 0 errors, 0 skipped: the LiveKit tests ran against a real
livekit-server). Details in `results/worker-tests.md`.

Several people in one call gives the same answers as one by one: on 20 real recordings (speech in every condition, and
noise), 3,000 windows, 589 of them speech, the largest difference in probability is exactly 0 and no verdict changes
(`src/batch-parity.ts`, `results/batch-parity.json`).

## 6. The whole worker under load

`scripts/worker-load.sh`. The worker runs alone in `node:22-bookworm-slim` with `--memory=512m --memory-swap=512m --cpus=1`,
started from the same settings as `main.ts`, with scripted fake ears so today's hearing path runs in full. The load comes
from outside the container over the real bridge: one bot and one person per bubble (N people are N sessions, and on the
LiveKit path N separate rooms), real peer connections or real LiveKit rooms, a minute of background noise per person with
three sentences on top, about 1% of packets lost plus a 200 ms hole now and then, someone leaving and returning every 15
seconds, and every bot starting to speak at the same instant every 10 seconds (a deliberately hard pattern). A run lasts
180 seconds; the measured stretch is the 160 seconds after everyone is connected. Memory and CPU are the container's own
accounting; event-loop delay is the worker's. "Heard" sets the audio frames that reached today's hearing path against
what the load sent in the same stretch.

### 6.1 The first build fell behind at 20 people, and was changed

The first build made one call to the detector per window. Up to 5 people that kept up. At 20 people on one core it did not
(proximity path; files in `results/worker-load-first-build/`):

| 20 people, proximity | off (first runs) | first build on | off (second runs) | second build on |
| --- | --- | --- | --- | --- |
| CPU, cores | 0.415 | 0.618 | 0.429 | 0.577 |
| throttled, seconds | 1.3 | 3.62 | 1.68 | 1.77 |
| event-loop delay p99 / max, ms | 11.1 / 343 | 15.8 / 422 | 10.3 / 306 | 14.1 / 392 |
| observer: wait mean / max, ms | | 31.4 / 1,439 | | 8.4 / 350 |
| observer: audio dropped, of what it was given | | 188 s of 3,055 s (6.2%) | | 22.7 s of 3,152 s (0.7%) |

Its limits did what they are for: it dropped and counted, held no more than its bound, and the worker was not slowed
beyond the figures above. But an observer that skips 6% is poor evidence. The cause was 625 separate calls a second, each
a round trip through the worker's event loop. In the second build one call carries a window from everyone who has one
waiting, with exactly the same answers (section 5). The total bound was raised from 4 s to 16 s in the same change,
because 4 s is less than twenty people's own 400 ms limits add up to; the per-person bound is unchanged. The first-build
runs started their measured stretch on a timer, a few seconds before everyone was in, so their "heard" counts are not
comparable; the second-build runs below fix that. Two first-build runs (5 people on, 20 people off) also overlapped
with a small separate test on the same machine; the second-build runs had the machine to themselves.

### 6.2 The build on the branch

| path | people | observer | measured, s | memory: container peak, MB (share of 512) | process RSS peak, MB (share of 512) | CPU, cores | throttled, s | event-loop delay p50 / p99 / max, ms | audio heard by the worker, of what was sent | came and went | observer: audio judged, s | people per call mean / most | call mean / max, ms | wait mean / max, ms | most audio waiting, ms | dropped, s | late answers thrown away | errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| idle | 0 | off | 20 | 70 (14%) | 113 (22%) | 0.017 | 0 | 5.1 / 5.7 / 19.5 | 0 | n/a |  |  |  |  |  |  |  |  |
| idle | 0 | on | 20 | 102 (20%) | 165 (32%) | 0.017 | 0 | 5.1 / 5.7 / 11 | 0 | n/a | 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 | 0.0 | 0 | 0 |
| proximity WebRTC | 1 | off | 160 | 80 (16%) | 123 (24%) | 0.049 | 0 | 5.1 / 6 / 20.8 | 7145 of 7145 (100.0%) | 12 / 11 |  |  |  |  |  |  |  |  |
| proximity WebRTC | 1 | on | 160 | 109 (21%) | 173 (34%) | 0.067 | 0 | 5.1 / 6.1 / 21.8 | 7124 of 7124 (100.0%) | 12 / 11 | 142 | 1 / 1 | 0.62 / 4 | 0.9 / 5 | 48 | 0.0 | 0 | 0 |
| proximity WebRTC | 5 | off | 160 | 88 (17%) | 134 (26%) | 0.141 | 0.02 | 5.1 / 6.3 / 36.9 | 38806 of 38802 (100.0%) | 16 / 11 |  |  |  |  |  |  |  |  |
| proximity WebRTC | 5 | on | 160 | 109 (21%) | 174 (34%) | 0.200 | 0.03 | 5.1 / 6.9 / 48.5 | 38825 of 38821 (100.0%) | 16 / 11 | 776 | 1.5 / 5 | 0.89 / 14 | 1.3 / 14 | 376 | 0.0 | 0 | 0 |
| proximity WebRTC | 20 | off | 160 | 102 (20%) | 149 (29%) | 0.429 | 1.68 | 5.2 / 10.3 / 305.7 | 157633 of 157595 (100.0%) | 31 / 11 |  |  |  |  |  |  |  |  |
| proximity WebRTC | 20 | on | 160 | 127 (25%) | 193 (38%) | 0.577 | 1.77 | 5.3 / 14.1 / 392.2 | 157610 of 157552 (100.0%) | 31 / 11 | 3129 | 4.6 / 20 | 2.86 / 187 | 8.4 / 350 | 7636 | 22.7 | 59 | 0 |
| LiveKit room | 5 | off | 160 | 133 (26%) | 181 (35%) | 0.323 | 0.06 | 5.1 / 6 / 50.4 | 78754 of 78385 (100.5%) | 16 / 11 |  |  |  |  |  |  |  |  |
| LiveKit room | 5 | on | 160 | 141 (28%) | 213 (42%) | 0.381 | 0 | 5.1 / 6.2 / 54.9 | 78714 of 78351 (100.5%) | 16 / 11 | 787 | 1.2 / 5 | 0.53 / 28 | 0.8 / 32 | 1950 | 0.0 | 0 | 0 |
| LiveKit room | 10 | off | 160 | 266 (52%) | 300 (59%) | 0.561 | 1.93 | 5.1 / 6.4 / 136.3 | 158761 of 158370 (100.2%) | 21 / 11 |  |  |  |  |  |  |  |  |
| LiveKit room | 10 | on | 160 | 170 (33%) | 232 (45%) | 0.684 | 3.38 | 5.1 / 7.1 / 178.3 | 158767 of 158342 (100.3%) | 21 / 11 | 1587 | 1.5 / 10 | 0.79 / 149 | 1.5 / 350 | 3684 | 0.0 | 0 | 0 |

In the runs above: OOM kills: 0; load generator errors: 0; joins that failed: 0; bridge links lost: 0 Every run in the table finished with its worker alive.

What the pairs show (on against off, same load):

- **What today's worker hears is untouched.** In every pair the worker heard the same share of what was sent with the
  observer off and on (100.0% on proximity; 100.2 to 100.5% on LiveKit, whose own pipeline fills the 200 ms holes).
- **Memory.** On the idle and proximity pairs the observer adds 21 to 32 MB by the container's count and 40 to 52 MB by
  process RSS (8 and 32 MB at 5 LiveKit rooms), nearly all of it when the detector loads (idle: 70 to 102 MB, RSS 113 to
  165). RSS is the more careful figure here: it counts the runtime's
  library pages, which this host's container accounting leaves out. Highest with the observer on: 232 MB RSS (45% of the
  cap) at 10 LiveKit rooms, 193 MB (38%) at 20 people on proximity. The highest figure of all is **without** the observer:
  300 MB RSS (59%) at 10 LiveKit rooms. That pair (off 266 / 300 MB, on 170 / 232 MB) shows the LiveKit path's own memory
  varying by about 100 MB between runs, more than the observer costs, so the observer's share cannot be read from it.
- **CPU.** 0.007 to 0.018 of a core per person: +0.018 (1 person), +0.059 (5), +0.148 (20) on proximity; +0.058 (5 rooms),
  +0.123 (10 rooms) on LiveKit.
- **Throttling under the one-core cap.** Today's worker is already throttled at the top loads (1.68 s of 160 at 20 people,
  1.93 s at 10 rooms). With the observer: 1.77 s and 3.38 s.
- **Event loop.** p50 unchanged everywhere. p99 at 20 people 10.3 to 14.1 ms, at 10 rooms 6.4 to 7.1 ms. Single worst
  moments 306 to 392 ms and 136 to 178 ms; they come when all bots start speaking at once and exist without the observer.
- **The observer itself.** Mean wait under 2 ms up to 10 people and 8.4 ms at 20; worst 350 ms. Nothing dropped in any run
  but one: at 20 people on proximity, 22.7 s of 3,152 s (0.7%), in 58 moments when one person's audio had waited past its
  400 ms bound after a stall of the worker's own event loop; by design that audio is not judged late, and the person
  starts afresh. 59 answers were discarded because the person had left while the call was out. 0 errors in every run.

**The pass line** (peak within 80% of 512 MB, that is 410 MB): met in every run above, with the observer off and on.

**A finding about today's worker, not about the observer.** At **20 separate LiveKit rooms** the worker of today, observer
**off**, did not last the run: killed for memory at the 512 MB cap, twice (170 s and 196 s after start;
`results/worker-load/room-off-20.*`). Its memory climbed about 2 MB a second once everyone was in (200 MB to 390 MB in 100
seconds) while the JavaScript heap stayed near 65 MB, and its own 5-second sampler came 26 to 43 seconds apart: the event
loop was starved and audio piled up outside JavaScript. 5 rooms cost 0.32 of a core and 10 cost 0.56, so 20 want more
than the one core it was given. The observer was not run at 20 rooms: there is no living baseline to set it against.
Whether production gives the worker one core is not known to this test, and whether twenty separate rooms on one worker
happens in practice is a product question. It is listed in section 7 and nothing here depends on it.

**What these runs do not show.** Anything longer than three minutes (a slow leak would not show); more than one person
per bubble; more than 20 people; another machine or CPU limit; how well the detector detects on real transports.

## 7. Still open

- A person has not listened to anything. The second opinion is two machines.
- False stops per hour and newly missed interruptions do **not** meet their lines. They gate any behaviour change, not
  observation.
- Background voices (babble, neighbours, announcements) are not solved by this detector.
- Listener-side delay, real phone echo, the browser's own filtering and auto volume: not measured.
- Detection quality on the real transports is only reconstructed; the load runs show the observer works there, not how
  well it detects.
- The CPU limit of the production worker is not known to this test; 1 core was assumed.
- Today's worker with many separate LiveKit rooms on one core (killed for memory at 20, observer off): outside this work,
  not fixed here, worth its own look.
- No long run: every load run is three minutes.
- Packaging for a shared environment is not done: the runtime is 294 MB unpacked for all platforms (46 MB for linux x64)
  and would need pruning; the model file would be bundled and checked; `ORT_DISABLE_TELEMETRY=1` would go into the image.

## 8. Proposed next step, for your verdict

Only this, and only if you agree the operational evidence is enough: package the runtime and model into the worker image
behind the same off-by-default switch, and turn observation on **on the development environment only**, bounded as above,
to collect counts beside today's gate on real browsers and both real transports. No interruption or speech-to-text
decision changes. If you want something closed first, say which.
