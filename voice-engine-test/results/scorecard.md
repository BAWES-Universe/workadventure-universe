# Voice engine bake-off: scorecard

Issue #1701. Branch `claude/project-thread-o95x0j`. Everything is in `voice-engine-test/`. No production code was touched.

Two engines, one bridge protocol, fake speech-to-text, fake text-to-speech, fake brain. No paid API, no secrets.

* **A** = thin TypeScript engine (Node 22, werift, libopus WASM, onnxruntime-node).
* **B** = Pipecat 1.15.0 (Python 3.13), pinned.
* Each engine runs two ways: **local** = Smart Turn v3 decides when the person is done; **provider** = a (fake) provider says "end of turn" after 500 ms of silence and Smart Turn is skipped.
* So four configs: **A-local, A-provider, B-local, B-provider**.

**These are sandbox numbers.** The sandbox is 4 cores of `Intel Xeon @ 2.10GHz`, shared by the engine, the load generator, the fake brain and the signaling server. The numbers say how the two engines compare here. They are not server capacity. Speech-to-text, text-to-speech and the brain are fakes, so real latency will be higher.

## Top 5 observations (revised after the fair load round)

1. **With process pools, B holds the same load as A; B is just much heavier.** B in one process collapsed at N=10 to 20. In a pool of 4 it runs N=20 in both modes. At N=20, total CPU: A-local 130% vs B-local 325%; A-provider 77% vs B-provider 279%. Memory: A-local 1.06 GB vs B-local 1.8 GB; provider is equal (about 0.9 GB). The earlier "B cannot scale" claim was wrong; it was a single-process artifact.
2. **B's talk-over stop is slower: about 355 to 415 ms vs A's 185 to 200 ms, at every pool size.** About 120 ms is slower speech-start detection (Pipecat's smoothed volume gate on the first soft frames), about 50 ms is a longer output tail. `min_volume` 0.0 helps in some runs, not reliably. Both are inside a one-second target.
3. **A's weak spots.** It is code we own: turn logic, resamplers, bit-exact Smart Turn features (proven: 0 diff over 46 cases), an approximate volume gate, one thread per process. A-local needs a pool of 4 at N=20 (single process: loop delay 121 ms, stop p95 940 ms). A-local failed S11 on one borderline Arabic clip (audio-path sensitivity of Smart Turn, same model and features).
4. **B's weak spots.** One bot, one caller, so a multi-person bubble needed about 270 lines of glue (S8 passes). aiortc has no loss concealment and over-reports dropped audio (640 ms injected, 2580 reported). A cold first connection took 1.2 s. Twenty Python processes do not fit on this 4-core box with the load generator (box 94% busy). B-local costs about 50 MB per lane for its Smart Turn session.
5. **Customizability and risk.** Both took minutes to add the emotion stub, both with an automated test. A: you own all 708 lines and the audio plumbing; no upstream. B: 942 lines of glue on top of an actively changing framework with ready adapters for Ultravox, Soniox, Cartesia and Gradium (all present in 1.15.0), but a fork carries merge cost. Arabic data is thin (1 real clip, 3 synthetic) and STT/TTS/brain are fakes, so Arabic quality and real latency are NOT measured. No dev runner is used and the stats server binds 127.0.0.1.

## 1. Scenario scorecard (S1 to S13)

PASS means an automated check with named conditions passed. The same checks fail when the behaviour is wrong (each scenario returns the list of checks in its evidence). Evidence for every cell is in `results/scenarios/<engine>-<turn-end>.json` (`ts-*` = A, `pipecat-*` = B), under the scenario id.

| Scenario | A-local | A-provider | B-local | B-provider |
|---|---|---|---|---|
| S1 Walk up | PASS | PASS | PASS | PASS |
| S2 Talk over | PASS | PASS | PASS | PASS |
| S3 Text+voice together | PASS | PASS | PASS | PASS |
| S4 Ask for work | PASS | PASS | PASS | PASS |
| S5 Asks first | PASS | PASS | PASS | PASS |
| S6 Voice runs out | PASS | PASS | PASS | PASS |
| S7 Words didn't all come through | PASS | PASS | PASS | PASS |
| S8 Several people in one bubble | PASS | PASS | PASS | PASS |
| S9 Mode switch | PASS | PASS | PASS | PASS |
| S10 Reconnect | PASS | PASS | PASS | PASS |
| S11 Arabic done talking | FAIL | PASS | PASS | PASS |
| S12 UI only | N/A | N/A | N/A | N/A |
| S13 Customizability and emotion | PASS | PASS | PASS | PASS |
| X1 Committed-only speech + retract (extra) | PASS | PASS | PASS | PASS |

Key numbers behind the table (from the evidence files):

| | A-local | A-provider | B-local | B-provider |
|---|---|---|---|---|
| S1 greeting heard, after "participant.join" | 83 ms | 84 ms | 116 ms | 115 ms |
| S2 talk-over, bot audio stops (p50 / p95) | 181 / 190 ms | 184 / 207 ms | 337 / 377 ms | 358 / 398 ms |
| S6 audio stops after voice.stop | -1 ms | 1 ms | 40 ms | 43 ms |

S1 is timed from the `participant.join` message, which both engines send once the media path is connected. The same S1 evidence also compares generated audio time, wall time and the audible packet time (the pacing check: the fake TTS runs at 1x real time). S2 stop time = last audible packet before a 250 ms gap, minus the moment the person's speech starts (confirmed by Silero on the clip).

What each row says, per config:

**S1 Walk up**
- A-local: PASS. greeting heard 83 ms after join; generated 2920 ms, wall 2821 ms (evidence: `ts-local.json`, id S1)
- A-provider: PASS. greeting heard 84 ms after join; generated 2920 ms, wall 2820 ms (evidence: `ts-provider.json`, id S1)
- B-local: PASS. greeting heard 116 ms after join; generated 2920 ms, wall 2781 ms (evidence: `pipecat-local.json`, id S1)
- B-provider: PASS. greeting heard 115 ms after join; generated 2920 ms, wall 2780 ms (evidence: `pipecat-provider.json`, id S1)

**S2 Talk over**
- A-local: PASS. talk-over stop p50 181 ms p95 190 ms, no stale audio (evidence: `ts-local.json`, id S2)
- A-provider: PASS. talk-over stop p50 184 ms p95 207 ms, no stale audio (evidence: `ts-provider.json`, id S2)
- B-local: PASS. talk-over stop p50 337 ms p95 377 ms, no stale audio (evidence: `pipecat-local.json`, id S2)
- B-provider: PASS. talk-over stop p50 358 ms p95 398 ms, no stale audio (evidence: `pipecat-provider.json`, id S2)

**S3 Text+voice together**
- A-local: PASS. one reply each, in order, nothing cut off (evidence: `ts-local.json`, id S3)
- A-provider: PASS. one reply each, in order, nothing cut off (evidence: `ts-provider.json`, id S3)
- B-local: PASS. one reply each, in order, nothing cut off (evidence: `pipecat-local.json`, id S3)
- B-provider: PASS. one reply each, in order, nothing cut off (evidence: `pipecat-provider.json`, id S3)

**S4 Ask for work**
- A-local: PASS. job survived the talk-over and its result was spoken in full later (evidence: `ts-local.json`, id S4)
- A-provider: PASS. job survived the talk-over and its result was spoken in full later (evidence: `ts-provider.json`, id S4)
- B-local: PASS. job survived the talk-over and its result was spoken in full later (evidence: `pipecat-local.json`, id S4)
- B-provider: PASS. job survived the talk-over and its result was spoken in full later (evidence: `pipecat-provider.json`, id S4)

**S5 Asks first**
- A-local: PASS. spoken yes arrived as user.turn from p2 and resolved the pending ask (evidence: `ts-local.json`, id S5)
- A-provider: PASS. spoken yes arrived as user.turn from p2 and resolved the pending ask (evidence: `ts-provider.json`, id S5)
- B-local: PASS. spoken yes arrived as user.turn from p2 and resolved the pending ask (evidence: `pipecat-local.json`, id S5)
- B-provider: PASS. spoken yes arrived as user.turn from p2 and resolved the pending ask (evidence: `pipecat-provider.json`, id S5)

**S6 Voice runs out**
- A-local: PASS. audio stopped -1 ms after voice.stop; mic ignored; text still answered (evidence: `ts-local.json`, id S6)
- A-provider: PASS. audio stopped 1 ms after voice.stop; mic ignored; text still answered (evidence: `ts-provider.json`, id S6)
- B-local: PASS. audio stopped 40 ms after voice.stop; mic ignored; text still answered (evidence: `pipecat-local.json`, id S6)
- B-provider: PASS. audio stopped 43 ms after voice.stop; mic ignored; text still answered (evidence: `pipecat-provider.json`, id S6)

**S7 Words didn't all come through**
- A-local: PASS. loss and gap were reported as droppedAudioMs with incomplete:true; clean run reported zero (evidence: `ts-local.json`, id S7)
- A-provider: PASS. loss and gap were reported as droppedAudioMs with incomplete:true; clean run reported zero (evidence: `ts-provider.json`, id S7)
- B-local: PASS. loss and gap were reported as droppedAudioMs with incomplete:true; clean run reported zero (evidence: `pipecat-local.json`, id S7)
- B-provider: PASS. loss and gap were reported as droppedAudioMs with incomplete:true; clean run reported zero (evidence: `pipecat-provider.json`, id S7)

**S8 Several people in one bubble**
- A-local: PASS. three lanes attributed, one talk-over stopped the bot for all, overlap handled (evidence: `ts-local.json`, id S8)
- A-provider: PASS. three lanes attributed, one talk-over stopped the bot for all, overlap handled (evidence: `ts-provider.json`, id S8)
- B-local: PASS. three lanes attributed, one talk-over stopped the bot for all, overlap handled (evidence: `pipecat-local.json`, id S8)
- B-provider: PASS. three lanes attributed, one talk-over stopped the bot for all, overlap handled (evidence: `pipecat-provider.json`, id S8)

**S9 Mode switch**
- A-local: PASS. all four mode changes behaved, same connection (evidence: `ts-local.json`, id S9)
- A-provider: PASS. all four mode changes behaved, same connection (evidence: `ts-provider.json`, id S9)
- B-local: PASS. all four mode changes behaved, same connection (evidence: `pipecat-local.json`, id S9)
- B-provider: PASS. all four mode changes behaved, same connection (evidence: `pipecat-provider.json`, id S9)

**S10 Reconnect**
- A-local: PASS. dropped and rejoined without a repeated greeting or repeated audio (evidence: `ts-local.json`, id S10)
- A-provider: PASS. dropped and rejoined without a repeated greeting or repeated audio (evidence: `ts-provider.json`, id S10)
- B-local: PASS. dropped and rejoined without a repeated greeting or repeated audio (evidence: `pipecat-local.json`, id S10)
- B-provider: PASS. dropped and rejoined without a repeated greeting or repeated audio (evidence: `pipecat-provider.json`, id S10)

**S11 Arabic done talking**
- A-local: FAIL. failed checks: arabicMishandledNotWorseThanEnglish (evidence: `ts-local.json`, id S11)
- A-provider: PASS. Arabic ok-latency p50 502 ms vs English 425 ms; mishandled 25% vs 25% (evidence: `ts-provider.json`, id S11)
- B-local: PASS. Arabic ok-latency p50 358 ms vs English 320 ms; mishandled 25% vs 25% (evidence: `pipecat-local.json`, id S11)
- B-provider: PASS. Arabic ok-latency p50 605 ms vs English 559 ms; mishandled 25% vs 25% (evidence: `pipecat-provider.json`, id S11)

**S12 UI only**: N/A for both engines. The test sandbox has no game UI; the engines are not involved.

**S13 Customizability and emotion**
- A-local: PASS. stub label rode on user.turn (evidence: `ts-local.json`, id S13)
- A-provider: PASS. stub label rode on user.turn (evidence: `ts-provider.json`, id S13)
- B-local: PASS. stub label rode on user.turn (evidence: `pipecat-local.json`, id S13)
- B-provider: PASS. stub label rode on user.turn (evidence: `pipecat-provider.json`, id S13)

**X1 Committed-only speech + retract (extra)**
- A-local: PASS. uncommitted text stayed silent; retracted queued segment never played (evidence: `ts-local.json`, id X1)
- A-provider: PASS. uncommitted text stayed silent; retracted queued segment never played (evidence: `ts-provider.json`, id X1)
- B-local: PASS. uncommitted text stayed silent; retracted queued segment never played (evidence: `pipecat-local.json`, id X1)
- B-provider: PASS. uncommitted text stayed silent; retracted queued segment never played (evidence: `pipecat-provider.json`, id X1)

- A-local harness checks (engine failures, schema violations, unexpected exits): HARNESS=PASS, HARNESS-emotion-stack=PASS
- A-provider harness checks (engine failures, schema violations, unexpected exits): HARNESS=PASS, HARNESS-emotion-stack=PASS
- B-local harness checks (engine failures, schema violations, unexpected exits): HARNESS=PASS, HARNESS-emotion-stack=PASS
- B-provider harness checks (engine failures, schema violations, unexpected exits): HARNESS=PASS, HARNESS-emotion-stack=PASS

Things the PASS cells do not say:

* **S7.** Both engines report the dropped audio. A reports it exactly (640 ms injected, 640 ms reported; 1000 and 1000). B over-reports (640 injected, 2580 reported; 1000 injected, 1260 reported). That is the safe direction (it says "incomplete" more often), but it means aiortc's jitter buffer throws away more audio than the network lost. Nothing is hidden: the check requires the turn to be marked `incomplete`.
* **S11.** Smart Turn (and the 500 ms silence rule too) cut the 11 s JFK clip and the 10 s Egyptian Arabic clip in the middle, in all four configs. That makes 25% of English clips and 25% of Arabic clips mishandled in B-local, A-provider and B-provider, so those pass. **A-local FAILS S11**: it also needed the 3 s silence fallback on one synthetic Iraqi clip (`ar_iraqi_1`), so 50% of Arabic clips were mishandled against 25% English. The model is the same file and the features match Python bit for bit (section 4). The difference is the audio path: Opus decode and resample differ slightly between werift/libopus and aiortc/soxr, and Smart Turn is very sensitive on borderline clips. Treat this as "borderline clips flip with tiny audio changes", not as "A is worse at Arabic". The Arabic data is thin (see below).
* **S12** is N/A. The sandbox has no game UI.
* **S13** is described in section 7.
* **S8.** B has no multi-human support, so the bubble is built from one pipeline per person, glued together by my `Bubble` class. It works (S8 PASS) but that glue is code I had to write (section 6).
* **Quiet speech.** B-local does not hear a very quiet voice at all (gain 0.08, about -47 dBFS; no turn is produced) because Pipecat's Silero setup has a volume gate (`min_volume 0.6`). A-local does hear it (my volume gate is a plain -50 dBFS RMS check, see deviations). In provider mode both engines heard the whisper. Measured in S13 as an info row.
* **Cold start (B).** After a cold disk cache the first lane in a fresh Pipecat process took about 1.2 s to connect (A: about 0.1 s). The greeting started before the audio path was up, so 1.3 s of it was never heard, while `playback.progress` said it was all played. I fixed it for both engines by sending `participant.join` only once the media path is connected. This is a reminder that "played" means "sent", not "heard". The bridge never claims words were heard.

## 2. Load numbers: single process (first round)

In this first round each engine ran as ONE process for all conversations. This is not how Pipecat is meant to be run. Section 2b is the fair round with process pools. Read section 2b first for any decision.

How it was measured:

* The load generator is its own process. It makes N real WebRTC peers (werift), each sending Opus from fixed, checksummed clips. Each peer has one bot (a one-to-one conversation).
* Each person talks about 40% of the time (measured 39.8%). About 15% of turns are talk-overs. The fake brain thinks 300 ms before it answers.
* 15 s warm-up, then **60 s measured**, **3 repeats**, fresh processes for each run. Mean and spread (± population standard deviation) over valid runs.
* CPU is process CPU time divided by wall time read from `/proc` by the load runner, so 100% = one core (more than 100% means threads on several cores). Event-loop delay = how late a 20 ms sleep wakes up, inside the engine (same probe in both).
* Every lane is supervised. A run is INVALID if any lane is lost or unhealthy, any engine failure or schema violation is logged, a process exits, more than 5% of cycles time out, any lane completes fewer than 4 cycles, or the load generator itself is overloaded (its loop delay p95 over 30 ms). INVALID runs are in the CSV with the reasons. They are not averaged.
* No `os._exit` on the normal path in either engine. Lanes and peers are closed and checked.
* Raw data: `results/load/load-runs-*.csv` (one row per run), `load-cycles-*.csv` (one row per conversation cycle), `load-summary.md` (all columns and counters).

| Config | N | valid runs | engine CPU % of one core | CPU % per talker | RSS MB | loop delay p95 ms | end of speech to turn p50 ms | say to first audio p95 ms | talk-over stop p50 / p95 ms |
|---|---|---|---|---|---|---|---|---|---|
| A-local | 1 | 3/3 | 10 (±0) | 9.6 (±0.1) | 240 (±9) | 1.0 (±0.0) | 268 (±2) | 4 (±0) | 184 (±7) / 190 (±6) |
| A-local | 5 | 3/3 | 32 (±1) | 6.4 (±0.2) | 275 (±9) | 1.9 (±0.2) | 289 (±7) | 39 (±12) | 190 (±7) / 239 (±34) |
| A-local | 10 | 3/3 | 60 (±1) | 6.0 (±0.1) | 287 (±2) | 62.9 (±7.7) | 312 (±10) | 115 (±16) | 193 (±7) / 273 (±43) |
| A-local | 20 | 3/3 | 105 (±1) | 5.3 (±0.1) | 323 (±1) | 117.7 (±2.5) | 561 (±29) | 153 (±2) | 375 (±69) / 940 (±58) |
| A-provider | 1 | 3/3 | 7 (±0) | 6.9 (±0.3) | 173 (±2) | 1.0 (±0.0) | 423 (±4) | 4 (±0) | 175 (±8) / 188 (±11) |
| A-provider | 5 | 3/3 | 19 (±1) | 3.9 (±0.2) | 242 (±15) | 1.0 (±0.0) | 427 (±1) | 4 (±1) | 181 (±1) / 204 (±4) |
| A-provider | 10 | 3/3 | 33 (±2) | 3.3 (±0.2) | 252 (±2) | 1.1 (±0.0) | 428 (±1) | 6 (±1) | 177 (±3) / 210 (±5) |
| A-provider | 20 | 3/3 | 63 (±1) | 3.2 (±0.0) | 287 (±4) | 3.5 (±0.1) | 430 (±0) | 9 (±0) | 187 (±1) / 206 (±3) |
| B-local | 1 | 3/3 | 26 (±0) | 25.6 (±0.3) | 213 (±0) | 1.2 (±0.0) | 317 (±2) | 63 (±0) | 365 (±11) / 381 (±6) |
| B-local | 5 | 3/3 | 119 (±3) | 23.8 (±0.6) | 450 (±0) | 5.2 (±0.4) | 363 (±10) | 88 (±2) | 365 (±11) / 444 (±80) |
| B-local | 10 | 3/3 | 170 (±3) | 17.0 (±0.3) | 729 (±4) | 45.8 (±1.5) | 2644 (±734) | 300 (±10) | 2720 (±735) / 3134 (±612) |
| B-local | 20 | 0/3 INVALID | (not used) | | | | | | |
| B-provider | 1 | 3/3 | 19 (±0) | 19.3 (±0.2) | 163 (±0) | 1.2 (±0.0) | 557 (±5) | 61 (±0) | 368 (±8) / 379 (±8) |
| B-provider | 5 | 3/3 | 97 (±3) | 19.5 (±0.7) | 209 (±0) | 2.8 (±0.5) | 571 (±2) | 68 (±6) | 357 (±6) / 393 (±12) |
| B-provider | 10 | 3/3 | 133 (±1) | 13.3 (±0.1) | 267 (±0) | 28.9 (±5.4) | 1176 (±476) | 212 (±25) | 1011 (±420) / 1347 (±636) |
| B-provider | 20 | 0/3 INVALID | (not used) | | | | | | |

"End of speech to turn" is measured from the end of speech in the clip (found with Silero) to the final `user.turn` at the brain. In provider mode it includes the 500 ms silence rule. "Say to first audio" is how long the engine takes from receiving `bot.say` to the person hearing audio.

What the load numbers say:

* **A scales better in this sandbox, by a wide margin.** Per talker, CPU: A-local 5 to 10% of a core, A-provider 3 to 7%; B-local 17 to 26%, B-provider 13 to 19%.
* **B-local at N=5 uses 119% CPU; A-local 32%.** Smart Turn inference per lane and Python overhead are the main cost in B. Provider mode saves about 20% of a core at N=5 in B and about 13 points in A.
* **N=10:** A is fine (turn and talk-over latency unchanged; loop delay p95 63 ms in local mode). **B is already degraded**: end of speech to turn p50 is 2.6 s (local) and 1.2 s (provider), talk-over stop p50 is 2.7 s and 1.0 s. B's runs are VALID (nothing broke) but the latency is not usable.
* **N=20:** A-provider is fine (63% CPU, 3.5 ms loop delay). A-local is at its limit: 105% CPU, loop delay p95 118 ms, end of speech to turn p50 561 ms, talk-over stop p95 940 ms. Still correct, still no lost lane, but it is one busy JavaScript thread. **B (one process) fails at N=20 in both modes (6 of 6 runs INVALID).** Pipecat logs show `SmallWebRTCOutputTransport ... timed out after 10.0s writing audio` and aioice STUN timeouts, and the engine ends with no healthy lanes. The 4 cores were not full (at N=20 the B engine used about 0.8 of a core and the load generator 0.15), so the limit looks like one process: the Python GIL in B, one JavaScript main thread in A. Section 2b confirms it: with several processes B holds N=20.
* **Memory:** B-local grows by about 50 MB per lane (a Smart Turn model session per lane) to 729 MB at N=10; B-provider 267 MB; A about 4 MB per lane (one shared model session, per-lane state), 323 MB at N=20.
* **Packets:** B sends a continuous stream of silence to every lane (3000 packets per 60 s per peer) while A sends audio only while the bot talks (about 900). B is simpler for the browser's jitter buffer. A saves bandwidth. See the counters in `load-summary.md`.
* **No stale audio** in any valid A run and any valid B run at N=1 and 5 (0 ms). At N=10 in B (overloaded) there was stale audio (local: 253 ms total, provider: 120 ms total).
* **Completed vs cancelled bot output** is in the counters table in `results/load/load-summary.md` (`segCompleted`, `segCancelled`, `ttsPlayedMs`, `ttsCancelledMs`) next to frames, packets and bytes. Example, A-local N=5, 60 s: 57 segments started, 49 completed, 7 cancelled by talk-over.
* The load generator itself used 6 to 17% of one core and had loop delay p95 around 1 ms, so it was not the bottleneck.
* Port 10080 was busy in the sandbox for run 7 of every config. The runner retried on other ports (logged in `load-invalid-*.txt`). It is not an engine problem.

## 2b. Fair load round: process pools

Why: Pipecat is meant to run one process per conversation (or a bounded pool). Section 2 ran all conversations in one Python process, which is unfair to B. A is one JavaScript thread, so it got the same treatment.

How:

* The signaling server (it plays the coordinator) now accepts several engine processes. A new conversation goes to the process that has the fewest conversations, so conversations are spread evenly. All later messages for that conversation go to the same process.
* B: (a) one process per conversation, (b) a pool of 2, (c) a pool of 4. A: a pool of 2 and a pool of 4. N = 5, 10, 20. Both turn-end conditions. 3 repeats of 60 s after a 15 s warm-up. The same validity rules as before. Rows labelled "single process (1)" are the earlier round, unchanged.
* Total CPU and total RSS are summed over all engine processes (100% = one core). Loop delay is the worst process (the highest p95 of the 3 repeats and processes). "Busiest process CPU" is the highest CPU of any one process. "Whole box busy" is all processes on the machine (engine, load generator, fake brain, signaling) as a share of the 4 cores.
* Raw data: `results/load-pool/load-pool-runs-*.csv` (one row per run, with `procs`, `procCpuMaxPct`, `boxBusyPctOf4Cores`), `load-pool-cycles-*.csv`, `pool-table.md`.

| Config | N | processes | valid/runs | total CPU % (all processes) | total RSS MB (peak) | worst process loop delay p95 ms | end of speech to turn p50 ms | talk-over stop p50 / p95 ms | busiest process CPU % | load generator CPU % | whole box busy % of 4 cores |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A-local | 5 | single process (1) | 3/3 | 32 (±1) | 275 (±9) | 2.1 | 289 (±7) | 190 (±7) / 239 (±34) | (one process) | 8 (±0) | (not recorded) |
| A-local | 5 | pool of 2 | 3/3 | 38 (±2) | 492 (±4) | 1.1 | 281 (±5) | 182 (±4) / 208 (±3) | 22 (±1) | 10 (±1) | 13 (±1) |
| A-local | 5 | pool of 4 | 3/3 | 45 (±1) | 980 (±29) | 1.0 | 281 (±3) | 181 (±3) / 201 (±4) | 16 (±1) | 9 (±0) | 17 (±3) |
| A-local | 10 | single process (1) | 3/3 | 60 (±1) | 287 (±2) | 68.7 | 312 (±10) | 193 (±7) / 273 (±43) | (one process) | 11 (±0) | (not recorded) |
| A-local | 10 | pool of 2 | 3/3 | 66 (±2) | 531 (±15) | 2.2 | 292 (±8) | 187 (±3) / 279 (±8) | 33 (±1) | 12 (±0) | 23 (±2) |
| A-local | 10 | pool of 4 | 3/3 | 75 (±1) | 1039 (±24) | 1.3 | 293 (±4) | 188 (±5) / 227 (±11) | 22 (±0) | 11 (±0) | 24 (±2) |
| A-local | 20 | single process (1) | 3/3 | 105 (±1) | 323 (±1) | 120.9 | 561 (±29) | 375 (±69) / 940 (±58) | (one process) | 15 (±0) | (not recorded) |
| A-local | 20 | pool of 2 | 3/3 | 119 (±2) | 564 (±3) | 67.2 | 322 (±10) | 201 (±3) / 401 (±32) | 60 (±1) | 17 (±0) | 37 (±1) |
| A-local | 20 | pool of 4 | 3/3 | 130 (±5) | 1055 (±16) | 4.7 | 295 (±11) | 190 (±5) / 293 (±21) | 33 (±1) | 17 (±1) | 38 (±2) |
| B-local | 5 | single process (1) | 3/3 | 119 (±3) | 450 (±0) | 5.6 | 363 (±10) | 365 (±11) / 444 (±80) | (one process) | 11 (±0) | (not recorded) |
| B-local | 5 | pool of 2 | 3/3 | 120 (±5) | 604 (±0) | 1.9 | 341 (±5) | 368 (±9) / 400 (±11) | 73 (±3) | 12 (±0) | 35 (±1) |
| B-local | 5 | pool of 4 | 3/3 | 119 (±2) | 915 (±1) | 1.5 | 332 (±3) | 359 (±4) / 382 (±6) | 46 (±0) | 12 (±0) | 37 (±1) |
| B-local | 5 | one per conversation (5) | 3/3 | 118 (±2) | 1066 (±0) | 1.6 | 335 (±5) | 358 (±14) / 384 (±4) | 24 (±0) | 13 (±0) | 34 (±1) |
| B-local | 10 | single process (1) | 3/3 | 170 (±3) | 729 (±4) | 47.2 | 2644 (±734) | 2720 (±735) / 3134 (±612) | (one process) | 13 (±1) | (not recorded) |
| B-local | 10 | pool of 2 | 3/3 | 220 (±4) | 900 (±0) | 13.1 | 419 (±11) | 385 (±8) / 470 (±50) | 111 (±2) | 17 (±1) | 61 (±1) |
| B-local | 10 | pool of 4 | 3/3 | 212 (±4) | 1209 (±1) | 4.4 | 392 (±5) | 353 (±5) / 392 (±8) | 64 (±1) | 17 (±0) | 59 (±1) |
| B-local | 10 | one per conversation (10) | 3/3 | 214 (±4) | 2138 (±2) | 2.6 | 386 (±4) | 360 (±2) / 395 (±3) | 22 (±0) | 18 (±0) | 61 (±2) |
| B-local | 20 | single process (1) | 0/3 INVALID | | | | | | | | |
| B-local | 20 | pool of 2 | 0/3 INVALID | | | | | | | | |
| B-local | 20 | pool of 4 | 3/3 | 325 (±2) | 1803 (±2) | 27.2 | 533 (±17) | 413 (±4) / 559 (±4) | 82 (±0) | 24 (±0) | 89 (±1) |
| B-local | 20 | one per conversation (20) | 0/3 INVALID | | | | | | | | |
| A-provider | 5 | single process (1) | 3/3 | 19 (±1) | 242 (±15) | 1.0 | 427 (±1) | 181 (±1) / 204 (±4) | (one process) | 8 (±0) | (not recorded) |
| A-provider | 5 | pool of 2 | 3/3 | 24 (±2) | 428 (±36) | 1.0 | 421 (±3) | 187 (±5) / 201 (±1) | 14 (±1) | 10 (±1) | 13 (±2) |
| A-provider | 5 | pool of 4 | 3/3 | 30 (±1) | 722 (±10) | 1.0 | 424 (±2) | 188 (±3) / 206 (±2) | 10 (±0) | 9 (±0) | 10 (±2) |
| A-provider | 10 | single process (1) | 3/3 | 33 (±2) | 252 (±2) | 1.1 | 428 (±1) | 177 (±3) / 210 (±5) | (one process) | 11 (±0) | (not recorded) |
| A-provider | 10 | pool of 2 | 3/3 | 41 (±2) | 470 (±19) | 1.1 | 427 (±0) | 186 (±3) / 210 (±1) | 21 (±1) | 12 (±1) | 17 (±1) |
| A-provider | 10 | pool of 4 | 3/3 | 48 (±5) | 846 (±19) | 1.1 | 426 (±0) | 183 (±1) / 203 (±8) | 14 (±1) | 11 (±1) | 16 (±5) |
| A-provider | 20 | single process (1) | 3/3 | 63 (±1) | 287 (±4) | 3.6 | 430 (±0) | 187 (±1) / 206 (±3) | (one process) | 17 (±0) | (not recorded) |
| A-provider | 20 | pool of 2 | 3/3 | 70 (±2) | 500 (±6) | 1.8 | 428 (±1) | 188 (±2) / 207 (±2) | 35 (±1) | 18 (±1) | 24 (±0) |
| A-provider | 20 | pool of 4 | 3/3 | 77 (±2) | 942 (±14) | 1.1 | 427 (±0) | 181 (±1) / 207 (±5) | 20 (±1) | 17 (±1) | 23 (±2) |
| B-provider | 5 | single process (1) | 3/3 | 97 (±3) | 209 (±0) | 3.4 | 571 (±2) | 357 (±6) / 393 (±12) | (one process) | 12 (±1) | (not recorded) |
| B-provider | 5 | pool of 2 | 3/3 | 89 (±5) | 360 (±0) | 1.3 | 560 (±5) | 356 (±3) / 377 (±3) | 54 (±3) | 12 (±1) | 25 (±3) |
| B-provider | 5 | pool of 4 | 3/3 | 90 (±2) | 663 (±0) | 1.2 | 561 (±1) | 367 (±4) / 381 (±1) | 35 (±1) | 12 (±0) | 27 (±2) |
| B-provider | 5 | one per conversation (5) | 3/3 | 91 (±3) | 814 (±0) | 1.3 | 561 (±1) | 364 (±6) / 382 (±6) | 18 (±1) | 13 (±0) | 28 (±3) |
| B-provider | 10 | single process (1) | 3/3 | 133 (±1) | 267 (±0) | 33.5 | 1176 (±476) | 1011 (±420) / 1347 (±636) | (one process) | 14 (±0) | (not recorded) |
| B-provider | 10 | pool of 2 | 3/3 | 171 (±4) | 419 (±0) | 6.2 | 569 (±1) | 374 (±3) / 430 (±44) | 86 (±3) | 17 (±0) | 49 (±2) |
| B-provider | 10 | pool of 4 | 3/3 | 163 (±6) | 721 (±0) | 1.9 | 564 (±1) | 357 (±4) / 390 (±9) | 50 (±2) | 18 (±1) | 48 (±1) |
| B-provider | 10 | one per conversation (10) | 3/3 | 170 (±5) | 1628 (±1) | 2.0 | 563 (±0) | 358 (±5) / 385 (±11) | 17 (±0) | 18 (±0) | 49 (±1) |
| B-provider | 20 | single process (1) | 0/3 INVALID | | | | | | | | |
| B-provider | 20 | pool of 2 | 0/3 INVALID | | | | | | | | |
| B-provider | 20 | pool of 4 | 3/3 | 279 (±2) | 838 (±0) | 12.9 | 589 (±3) | 390 (±4) / 472 (±8) | 70 (±1) | 25 (±0) | 78 (±1) |
| B-provider | 20 | one per conversation (20) | 3/3 | 309 (±6) | 3259 (±1) | 5.8 | 570 (±1) | 375 (±5) / 426 (±7) | 16 (±0) | 23 (±0) | 85 (±2) |

INVALID cells (numbers shown for information only, never used above). Reasons are in the CSV `invalidReasons` column.

| Config | N | processes | runs | total CPU % | total RSS MB | worst process loop delay p95 ms | end of speech to turn p50 ms | talk-over stop p50 ms | timeouts / cycles | load generator loop delay p95 ms | box busy % of 4 cores | why INVALID |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B-local | 20 | single process (1) | 3 | 82 (±4) | 1335 (±1) | 66.6 | 1676 (±689) | 1299 (±0) | 395 / 428 | 1 (±0) | (not recorded) | 20 lane(s) with fewer than 4 completed cycles in the window; engine reports 0 lanes, expected 20; turn/reply timeouts 129/142 > 5%; turn/reply timeouts 133/142 > 5%; turn/reply timeouts 133/144 > 5% |
| B-local | 20 | pool of 2 | 3 | 250 (±1) | 1471 (±5) | 61.2 | 2813 (±375) | 761 (±419) | 129 / 414 | 2 (±0) | 69 (±0) | 1 lane(s) with fewer than 4 completed cycles in the window; 2 lane(s) with fewer than 4 completed cycles in the window; turn/reply timeouts 42/137 > 5%; turn/reply timeouts 43/138 > 5%; turn/reply timeouts 44/139 > 5% |
| B-local | 20 | one per conversation (20) | 3 | 347 (±5) | 4287 (±3) | 10.8 | 593 (±24) | 381 (±10) | 0 / 573 | 43 (±11) | 94 (±1) | load generator overloaded |
| B-provider | 20 | single process (1) | 3 | 67 (±7) | 398 (±1) | 53.1 | 1044 (±1205) | 736 (±200) | 405 / 438 | 1 (±0) | (not recorded) | 19 lane(s) with fewer than 4 completed cycles in the window; 20 lane(s) with fewer than 4 completed cycles in the window; engine reports 0 lanes, expected 20; engine reports 1 lanes, expected 20; turn/reply timeouts 132/144 > 5%; turn/reply timeouts 136/150 > 5%; turn/reply timeouts 137/144 > 5% |
| B-provider | 20 | pool of 2 | 3 | 219 (±1) | 542 (±2) | 45.3 | 3756 (±138) | 3016 (±164) | 89 / 411 | 1 (±0) | 61 (±0) | turn/reply timeouts 25/133 > 5%; turn/reply timeouts 31/138 > 5%; turn/reply timeouts 33/140 > 5% |

How to read it:

* **Single process was the limit for B.** B-local N=10 went from end-of-speech-to-turn p50 2.6 s (one process) to 0.39 s (pool of 4) and talk-over stop p50 from 2.7 s to 0.35 s. B-provider N=10 the same (1.2 s to 0.56 s). B now holds N=20 in a pool of 4 (both turn-end modes) and with one process per conversation in provider mode.
* **Where the box became the limit (not the engine).** B-local with one process per conversation at N=20 is INVALID only because the whole box was 94% busy and the load generator's own loop delay reached 43 ms (the rule is 30 ms). The engine looked fine there (0 of 573 cycles timed out, end of speech to turn 593 ms, stop 381 ms). 20 Python processes plus the load generator do not fit on 4 cores. B at N=20 in a pool of 4 used 78 to 89% of the box. A never used more than 38% of the box.
* **A pool of 2 is too few for B at N=20.** Each of the 2 processes had 10 conversations, loop delay p95 45 to 61 ms, 22 to 31% of cycles timed out (INVALID in 6 of 6 runs). That matches the N=10 single-process result: a Python process holds about 5 to 10 conversations here.
* **A also gains from a pool.** A-local N=20: single process 105% CPU, loop delay p95 121 ms, end of speech to turn 561 ms, stop p95 940 ms. Pool of 4: 130% CPU, loop delay 4.7 ms, 295 ms, stop p95 293 ms. A-provider was already fine in one process. Pools cost A about 20 to 60% more total CPU and 3 to 4 times the memory (every process loads its own ONNX sessions, about 235 MB each).
* **Cost per talker with pools (best valid pool of each engine).** N=20 local: A 130% total CPU, 1.06 GB; B 325% total CPU, 1.8 GB (A uses about 40% of B's CPU). N=20 provider: A 77% CPU, 0.94 GB; B 279% CPU, 0.84 GB (A uses about 28% of B's CPU; memory is equal because B-provider has no per-lane Smart Turn session). N=10 local: A 75% vs B 212%.
* **Latency.** Pools do not change the talk-over gap: A stops in about 185 to 200 ms, B in about 355 to 415 ms at every pool size. End of speech to turn: A about 280 to 320 ms vs B about 330 to 420 ms in local mode (A-local pool of 4 N=20 295 ms, B-local 533 ms).
* **Process-per-conversation vs pool of 4 for B:** no latency gain at N=5 and N=10 (equal within noise), 2x the memory at N=10 and 4x at N=20 provider. A bounded pool of 4 is the better choice on 4 cores.
* The per-run INVALID causes are in `load-invalid-*.txt` and the CSV `invalidReasons` column. Every INVALID cell is listed in the second table above. None was hidden.
* Load generator CPU was 8 to 25% of one core. Its own loop delay p95 stayed under 30 ms in every valid run.

## 2c. Why B's talk-over stop is slower than A's (short check)

Per trial times, p50, local turn-end, 8 trials per row (`scenarios/probe_barge.ts`, `results/barge-probe/README.txt`):

| | person's speech starts, engine sees it | cut reported to the brain | last bot audio heard |
|---|---|---|---|
| A | 194 ms | 203 ms | 184 ms |
| B (Pipecat defaults) | 316 ms | 330 ms | 357 ms |
| B with `VADParams.min_volume` 0.0 (documented setting) | 275 ms | 282 ms | 217 ms |

* The transport and jitter buffer add no measurable delay: a temporary probe showed the first loud audio frame reaches the pipeline 94 ms after the nominal start, the same offset the clip has for A. No output-buffer problem was found. The audio tail after the cut is about 50 ms longer in B.
* The main cost is detecting speech start. Both engines use the same Silero settings (6 windows of 32 ms to confirm). B's VAD also has a smoothed volume gate (`min_volume` 0.6, exponential smoothing 0.2) that makes the first soft frames not count, so the confirmation starts later.
* Setting `min_volume` to 0.0 moved the stop to 217 ms in the probe, close to A. But the real S2 scenario (10 trials) with the same setting gave p50/p95 of 218/337, 337/358 and 338/340 ms in three runs (local) and 238/357 (provider); the default gives 337/377 and 358/398. So the setting sometimes helps and sometimes does not. It is not a clean fix and it lets quieter noise count as speech, so I left the default in place for all results. The remainder looks like how Silero's confidence behaves on aiortc-decoded audio versus my decoder (a start-window restart costs about 120 ms). I did not go further and did not touch Pipecat internals.
* The flag `--vad-min-volume` on the B engine exists for this test only.

## 3. Size, lines of code, dependencies

| | A (TypeScript) | B (Pipecat) |
|---|---|---|
| Engine lines of code (no tests, no comments counted separately) | 708 lines in 11 files (`ts-engine/src`) | 942 lines in 7 files (`pipecat-engine/engine`) |
| of which the emotion stub (S13) | 12 + about 8 hook lines | 42 + about 7 hook lines |
| Shared by both (bridge protocol, fake brain, signaling, load generator, scenarios, runner) | 1,141 lines (not counted in either engine) | same |
| Install size on disk | `node_modules` 689 MB total; runtime packages only about 418 MB for linux (onnxruntime-node alone is 343 MB because it ships GPU libraries) | `.venv` 784 MB |
| Direct runtime dependencies | 4 (`ws`, `werift`, `onnxruntime-node`, `@evan/opus`) | 2 pins (`pipecat-ai[webrtc,silero]==1.15.0`, `soundfile`) |
| Installed packages (including indirect) | 78 for the runtime (140 with test tools) | 60 |
| Model files | 2 ONNX files, copied from the pip package, same sha256 for both | the same 2 files, inside the package |
| Idle memory, one lane | about 235 MB | about 213 MB (local), 163 MB (provider) |

Model checksums (`results/models.sha256`):

* `silero_vad.onnx` 1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3
* `smart-turn-v3.2-cpu.onnx` 2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f

Line counts are not like-for-like. B's 942 lines contain almost no audio code, because Pipecat provides it (transport, VAD, turn analyzer, resampling, Opus). A's 708 lines hold the Silero state machine, Smart Turn buffering, resamplers and feature extraction, but I wrote only the parts I needed for the test, and they need hardening before production (see known gaps). The libraries A uses are `werift` and `@evan/opus` (libopus compiled to WASM, maintained, works on Node 22).

## 4. Does the TypeScript Smart Turn match Python?

Yes, exactly, on the same audio. `ts-engine/test/parity.ts` compares the Whisper log-mel features, the model probability and the decision for 46 cases (speech, silence, cut speech, noise, the test clips, truncated and padded inputs). Data: `results/parity/parity.csv`.

* Max absolute difference in the 80x800 features: **0** (bit exact).
* Max absolute difference in probability: **0**.
* Turn decision mismatches: **0 of 46** (27 complete, 19 incomplete).

It took work. A plain float64 port was off by 1.3e-5 in the features and flipped 1 of 40 decisions, because Smart Turn is very sensitive. The fix was to copy numpy's float32 pairwise-sum normalisation and use a mixed-radix FFT for N=400.

Same audio gives the same decisions. Different audio paths (Opus decode, resampling) can still give different decisions on borderline clips (S11).

Known deviation: A's volume gate is "RMS at least -50 dBFS". Pipecat uses BS.1770 loudness with `min_volume 0.6`. So A hears quieter speech than B.

## 5. What was hard to build

**A (TypeScript).**

* Getting bit-exact Smart Turn features (above). This took the longest.
* Silero VAD state machine: port of Pipecat's, including the model reset rule.
* Resampling: 48k to 16k and 24k to 48k needed my own filters.
* werift: the first connection waited 5 s for a public STUN server. I run a tiny local STUN responder in the signaling server. `pc.close()` is not signalled to the peer, so a 3 s "no audio from the person" watchdog finds lost people.
* No built-in turn, interruption or pipeline concept. I wrote them (barge-in is a flag checked every 20 ms chunk).
* Nothing is shared between lanes except the ONNX sessions. Feature extraction runs on the main thread, which is what limits A-local at N=20.

**B (Pipecat).**

* Pipecat 1.15 has a lot of moving parts. Finding the right turn setup took reading source: `UserTurnProcessor`, `VADUserTurnStartStrategy`, `TurnAnalyzerUserTurnStopStrategy`, `ExternalUserTurnStopStrategy`.
* Provider mode: Pipecat expects a transcript frame then `ProposedUserStoppedSpeakingFrame`; my fake STT has to make both at the right time.
* Multi-human: Pipecat is one bot, one caller (section 6).
* Dropped audio: aiortc has no packet-loss concealment. The only loss signal is a gap in RTP timestamps (`pts`, 48 kHz ticks). I wrote `DropProbe` to read it.
* Stats: Pipecat has no per-lane event-loop or CPU hooks. I run the same lag probe inside the engine.

## 6. Pipecat workarounds (things I had to add)

1. **S8, several people in one bubble:** one `SmallWebRTCConnection` plus one pipeline per person, and a shared `Bubble` object that owns the single bridge connection, the mode, the speaker and the barge-in. Each pipeline has a `LaneBridge` processor that turns events into bridge messages. About 270 of B's 942 lines are this glue (`bubble.py`).
2. **Speaker:** `BotSpeaker` runs the fake TTS at 1x speed, 960-byte chunks, and pushes the same chunk to each person's pipeline. Pipecat's own TTS/output queue is not used because I needed cancel in under one chunk (20 ms) and `playedMs` per segment.
3. **Lane watchdog:** Pipecat does not tell us when a person's peer connection silently stops. I added a "no audio for 3 s" check that ends the lane and sends `participant.leave`.
4. **Supervision:** each lane's pipeline runs inside `_supervise`; a crash is counted, sent to the brain, and makes the run INVALID. Pipecat's own runner would swallow it.
5. **Silence feed while a turn is open:** the turn analyzer needs audio to keep ticking; I feed silence while a turn is open and the person is gone quiet or the network lost packets.
6. **Join timing:** `participant.join` is sent after the connection is up (section 1).
7. **Per-lane ONNX sessions:** each lane creates its own Silero and Smart Turn sessions (not shared). That is why B-local uses about 50 MB per lane.

## 7. S13: customizability and emotion

**(a) How hard is it to modify or fork each engine?**

| | A (TypeScript) | B (Pipecat) |
|---|---|---|
| Code you own | all 708 lines. Nothing carried from upstream except two ONNX model files and three algorithms ported from Pipecat (VAD state machine, Smart Turn buffering, feature extraction) | 942 lines of glue on top of about 34 MB of Pipecat source (pip package) and 60 packages |
| Where to add a step | edit `lane.ts` where the turn is finished (one function). No framework to learn | add a `FrameProcessor` to the pipeline list in `lane.py`. That is the documented extension point |
| How hard to change upstream behaviour | trivial (it is your code) but you also own every bug | usually a subclass or a config field; some things (the jitter buffer, loss reporting, the volume gate) are inside aiortc or the VAD analyzer and need a fork or a workaround |
| Upgrade story | none to take: Opus, werift and onnxruntime upgrades only. Silero or Smart Turn model updates need a re-check of the port (the parity test does it in a minute) | Pin and test. Pipecat releases often, so expect small API changes between versions. A fork carries a merge cost. The big gain: new providers and new turn models arrive for free |
| Risk | you build and keep the audio plumbing, the hard bits (jitter, loss, scaling across processes) | you take Pipecat's choices (per-lane sessions, one bot one caller) and its release pace |

**(b) Emotion stub, proven in both.** An optional step adds `emotion:{label,confidence,source:"stub"}` to the final `user.turn`. It uses loudness only (no model, no download): mean level of the active frames, `excited` above -19 dBFS, `calm` below -30 dBFS, otherwise `neutral`. Turned on with `--emotion-stub`. The schema allows the optional field.

* Automated test: S13 plays the same clip at gain 0.3, 1 and 4 and checks the label on the final `user.turn` (calm, neutral, excited), that every one is marked `source:"stub"`, and that confidence is between 0 and 1. A whisper level is recorded as information. It fails if the field is missing or wrong. PASS in all four configs.
* Cost, A: `ts-engine/src/emotion.ts` 12 lines, plus about 8 lines in `lane.ts` and `main.ts` (collect the turn's audio, call `labelFor`, add the field). Friction: none. Time: minutes.
* Cost, B: `pipecat-engine/engine/emotion_stub.py` 42 lines, plus about 7 lines in `lane.py` and `main.py`. The processor sits after `UserTurnProcessor` and collects `InputAudioRawFrame` between the start and stop frames. Friction: I had to learn which frames the turn processor passes through, and the audio is only there between the start and stop frames, so the step must watch both. Documented hooks, but more to learn.
* One honest note: the S13 thresholds were changed once (from -16/-28 to -19/-30 dBFS) because a clipped loud clip sat right on the edge in provider mode. S13 rows were re-run after that change.
* A real emotion model would replace `label_for` / `labelFor` and nothing else. In B it can run in the pipeline; in A it can run as another ONNX session. Neither engine needs a rewrite. B has the larger ecosystem of ready services.

## 8. Optional provider swaps, later

Not built, not called. They need paid keys and Khalid's OK. The check is only that the folder exists in the pinned Pipecat 1.15.0 package (`pipecat/services/<name>`). I did not run any of them and did not check each vendor's current API.

| Provider | What it is | Pinned Pipecat 1.15.0 has an adapter? | Work for the TS engine |
|---|---|---|---|
| **Ultravox** | Realtime speech-to-speech model | Yes: `services/ultravox/llm.py` (an "Ultravox Realtime" LLM service). **It replaces part of the brain** (speech in, model, speech out), so memory, tools and permissions must be checked: our brain owns those through the bridge today. | Needs a WebSocket client and a decision on who runs tools. More than a plain provider swap. I believe Ultravox has a WebSocket API and a JS client, but I did not verify it. |
| **Soniox** | Speech recognition (Arabic candidate) | Yes: `services/soniox/stt.py` and `tts.py` | Small: stream 16k PCM over a WebSocket, read tokens and an end-of-turn marker. I believe Soniox has a WebSocket API, but I did not read its docs here. About 150 lines to replace the fake STT in `fakes.ts`. |
| **Cartesia** | Expressive voice, emotion and speed controls | Yes: `services/cartesia/stt.py`, `tts.py`, and `turns/`. The TTS options include `emotion` and `speed`. | Small: WebSocket text in, PCM out. Emotion is an option in the request. About 150 lines. |
| **Gradium** | Low-latency voice | Yes: `services/gradium/stt.py`, `tts.py` | Small if it has a WebSocket API (not verified). **Arabic voices not verified.** |

For all four: the engines already have a place for them (the fake STT and fake TTS). In B it is a one-line change of service. In A each is a new client of about 100 to 200 lines plus streaming and backoff code, and Arabic quality is a provider choice that these tests do not measure.

## 9. Security note

* Do not use Pipecat's development runner (`pipecat.runner`) in the design. It has no production authentication.
* **Confirmed for this engine:** B does not import or start the dev runner, and exposes no endpoint of its own. Its only HTTP server is the stats page on `127.0.0.1` (test only; remove for production). The signaling server and the fake brain also bind `127.0.0.1` only. Checked by reading the code (`grep` for `0.0.0.0` and `pipecat.runner` finds nothing).
* The engine dials out to the signaling server and to the brain. In production the engine should accept connections only from our own authenticated coordinator (token on the WebSocket, short-lived offer tokens), never open its own public port, and never accept an SDP offer from anyone else.
* The test-only side channels (`/hint` for the fake speech-to-text, `fake.clip`, the brain admin API) must not exist in production. They are listed in `bridge/PROTOCOL.md`.

## 10. Known gaps

* The speech-to-text, text-to-speech and brain are fakes. Real latency, real word accuracy and real Arabic quality are not measured. The turn timing is.
* **Arabic data is thin.** One real speaker (10 s, Egyptian, one clip, source licence unknown) and three synthetic Iraqi clips (TTS output, not a person). No long natural Arabic conversation. `clips/SOURCES.md` has URLs and licences. S11 means "comparable on these clips".
* Clips came only from GitHub. Wikimedia, archive.org, LibriVox, OpenSLR and Hugging Face were blocked.
* One run per load cell is 60 s. Memory growth over hours is not tested.
* Loss is injected as dropped RTP packets (random 10% and a 1 s gap). Real networks also reorder, delay and burst.
* The load generator uses digital silence between clips (no room noise).
* A: volume gate approximated (section 4). One thread. No hardening beyond what the scenarios exercise.
* B: S1 timing is sensitive to a cold start (section 1). B in one process is poor above N=5; section 2b shows that process pools fix it. I did not tune thread settings or share model sessions.
* The scenarios S1 to S13 ran once per config (the S2 line has 10 trials). S2, S4, S6 and S8 for B were re-run after a counter-only fix. S13 was re-run for all four after the threshold change.
* The first commits say `Claude Opus 5.5` in the co-author line (as instructed in the task); later commits use the line from the session reminder.

## 11. Also looked at (briefly)

* `pipecat-ai/pipecat-ui`: a React and shadcn kit (components installed as source) for the Pipecat browser client: mic and camera controls, transcript view, audio visualizers, a "duplex timeline" of both sides' speech with interruptions, a debug console and a metrics dashboard. It is for Pipecat's own client protocol. The game UI is WorkAdventure, so most of it does not apply. The debug console and the duplex timeline could be useful for a developer test page later. I did not install or run it.
* `pipecat-ai/skills`: Claude Code plugins (`pipecat`, `pipecat-cloud`, `pipecat-mcp-server`). Mainly project scaffolding (`pc init`) and Pipecat Cloud deploys. Not used here (the test harness is not a scaffolded Pipecat app). I read the README only; I did not install it.

## 12. How to reproduce

See `voice-engine-test/README.md`.
