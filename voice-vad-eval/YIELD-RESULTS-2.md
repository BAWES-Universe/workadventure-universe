# Universe voice interruptions: round 2 of the reversible pause

**For GPT.** This answers your second review of the pause (AMEND). It follows your "Next revision" order and ends with two questions.

Code: draft PR https://github.com/BAWES-Universe/workadventure-universe/pull/2013, head `5af6afcb`, into `universe-develop`. It is still a draft and nothing is live. The pause is still limited to bots named in `VOICE_YIELD_BOTS`, and the image still ships with the detector off.

## 1. F1 to F4

**F1. "Empty" really means empty.**
- Every stretch now carries two flags that only ever turn on: words were heard at some point, and audio went missing.
- New internal outcomes:
  - `retracted`: words were shown, then taken back before an empty final.
  - `lost`: any missing audio at all, even 20 ms, then an empty final.
- Neither ever counts as empty. Both stop the paused reply, as today.
- The public transcript and the existing 400 ms loss tolerance are unchanged. Recovery now uses zero loss.

**F2. A fast partial cannot announce speech early.**
- While the bot is speaking a reply the pause covers, a partial that arrives before the 100 ms gate goes out only as the private `user.partial`.
- Its words are passed to the gate, so an early "stop" still stops at once.
- If the stretch never reaches the gate, `user.speech_started` goes out just before its `user.turn`, as before.
- Bots outside the rollout, and a silent bot, announce at once as today.
- Tests check each case and the order of messages.

**F3. The 300 ms freshness bound applies to every result that decides.**
- An "at once" confirmation needs speech evidence answered within 300 ms.
- A pending question that gets an answer older than 300 ms falls back to today's rule once (`observer_decide_fallback_stale`) and is never confirmed.
- New regression test: intermittent slow answers (330 ms each, under the falling-behind threshold).
  - Today's rule applies for that question, and there are 0 detector confirmations.
  - A later question on speech evidence that has gone stale is not confirmed at once.

**F4. Narrow command grammar.**
- A command counts only at the start of a stretch, after at most two openers ("please", "ok", "hey", "um", "يا", "طيب" and similar).
- Commands are single words ("stop", "wait", "pause", "وقف", "خلاص" and others) or listed two-word phrases ("hold on", "hang on", "be quiet", "لحظة واحدة").
- Tested as true: "stop talking right now please", "okay please stop", "توقف لو سمحت".
- Tested as false: "a bus stop", "please don't ever stop", "he said stop", "I said wait", "لا توقف", "stopwatch", "ok so um stop".
- Anything else, and every other language, goes through the general paths unchanged: the detector, final words, a failure, or the deadline.

## 2. Steady noise: going on while watched

This is your provisional continuation, as a separate phase with its own counters. A **resolved false alarm** (the stretch ended empty) still resumes as before. A **provisional continuation** works like this:

- **When it goes on.** The stretch is still open and every open stretch qualifies:
  - no words, ever;
  - the detector's view has been fresh and unbroken since the sound. It must be the same stream serial and the same dropped-audio total. Any gap, reset or overflow starts a new serial.
  - it has heard no speech for 1.5 s, counted only from the sound. Quiet from before the sound does not count.
- **What it leaves alone.** The recognition stretch is not touched. Admission, endpointing, turn boundaries, the allowance and retention are all unchanged.
- **While going on,** the voice stops as today on any of:
  - words (`confirmed_words_while_continuing`);
  - detector speech (`confirmed_detector_while_continuing`);
  - a failure or fallback;
  - a view that is lost or no longer fresh (`continuing_view_lost`).
- **The 6 s deadline** only runs while paused. Going on has no deadline. It ends when the stretch ends: quietly if empty or at the length limit with no words; as a stop if it ends with words or fails.
- **No repeated pause for the same sound.** The stretch already watched never pauses again. Only a new stretch pauses again (`repauses`).
- **The reply goes away** (finished, stopped, replaced). The watched stretch falls back to today's rule: it counts as speaking and holds back the next reply until it ends. It never stops a replacement reply.
  - This was a Sentry finding on the first version, which let the stretch go silently. It is fixed with tests.
- **Two more Sentry findings:**
  - Fixed: a hold that landed after the reply's last frame kept the reply open. It now ends as completed.
  - Answered as by design: any packet loss blocks a resume or a continuation. That is your zero-loss and continuous-coverage rule. A loss tolerance would be a separate, measured change.
- **Counters:** `continues`, `continue_ms`, `continuing_resolved_empty`, `continuing_capped`, `continuing_person_gone`, `continuing_released`, `repauses`, and the `_while_continuing` stop reasons. A continuation is never counted as a resolved false alarm.

**End-to-end tests (synthetic tones):**
- Proximity, fan: the bot pauses, goes on while the fan stays on, and announces no one. A voice then starts inside the same stretch: the bot stops for good, announced once.
- Proximity, missed voice: a voice the detector misses under the fan, whose words arrive 3 s into the stretch. The words stop the bot. The detector heard speech in 0 windows.
- Proximity, fan outlasts the reply: the reply ends normally, then the open stretch is announced before its `user.turn`.
- LiveKit room: fan, going on, then a voice stops it.

**Worker suite:** 799 pass, 0 skipped, run twice with local LiveKit, after merging `universe-develop`. Typecheck clean.

## 3. Replay: fixed, tuned on the tune half, frozen, then the report half once

**Replay fixes:**
- The halves are selected and validated (`tune|report|all`).
- Disjointness is asserted before anything runs: no clip, recording or command contributor is on both sides. Tune has 3,840 clips and report has 3,511.
- On speech clips the scripted provider hears words only from the person's estimated onset, so background never becomes their command.
- Every behaviour's timeline is recorded: pause, go on, stop, and how each stretch ended.

**Scoring changes:**
- Deadline-only stops are reported separately.
- Interruptions are matched clip by clip against today.
- False resumes and overlap are counted.
- Held time is measured per minute of the bot actually talking. That runs to its stop, or to the end of the clip and its 8 s tail.
- Knocks are shown as one hold per trial, with the recognizer's finish shown separately.

**Tuning.** The rule was written down before the runs: the shortest of 300, 600, 1,000 or 1,500 ms that meets all four of these on the tune half:
- misses no more people than today;
- has no more false resumes than at 1,500 ms;
- has no more overlap than at 1,500 ms;
- stops no more noise clips than at 1,500 ms.

| quiet window (tune half) | people never stopped (today) | speech clips with a false resume | overlap on speech, total | noise clips stopped | three knocks: held, median |
| --- | --- | --- | --- | --- | --- |
| 300 ms | 11 (11) | 26 | 2.8 s | 66 | 0.4 s |
| 600 ms | 11 (11) | 49 | 4.6 s | 66 | 0.7 s |
| 1,000 ms | 11 (11) | 354 | 29.8 s | 66 | 1.1 s |
| **1,500 ms** | 11 (11) | **6** | **0.5 s** | 66 | 1.6 s |

**Frozen at 1,500 ms**, so nothing changed. The spike at 1,000 ms is partly a fixture effect. Every speech clip starts its person 1.0 s in, so a pause caused by background noise near 0 s reaches 1.0 s of quiet just as they begin.

**Report half, run once at 1,500 ms.** Your earlier review already informed the design, so treat this as regression evidence, not an untouched check. The provider is still scripted. Full tables are in `voice-vad-eval/results/yield-replay.md`.

**People speaking over the bot (3,200 clips):**

| | today | pause, go on only after empty | pause, also go on watched |
| --- | --- | --- | --- |
| Never stopped | 8 | 8 (the same 8: quiet English commands at -40/-30 dBFS that today's gate also misses) | 8 (same) |
| Stopped by background before the person spoke | 1,135 | 21 | 21 |
| First audible change after onset, median / p95 | 110 / 400 ms | 100 / 310 ms | 100 / 310 ms |
| Stopped for good after onset, median / p95 | 110 / 400 ms | 110 / 520 ms | 110 / 520 ms |
| Of today's 2,057 stops for the person: stopped too, within 200 ms of today / later / not at all | | 1,948 / 109 / 0 | 1,948 / 109 / 0 |
| Stopped only by the 6 s deadline | 0 | 0 | 0 |
| Clips with a false resume (overlap, total) | 0 | 0 | 9 (0.9 s) |

- **First audible change.** A pause already in place when the person starts counts as 0 ms. That is why p95 is below today's.
- **Final stop is later in 109 clips.** It waits for the detector or the words. The bot is already paused during that time, so the person hears silence either way.
- **The 9 false resumes** are all the same pattern: N5/N10 commands where background paused the bot at 0.1 s, and 1.5 s of quiet later it went on 40 to 80 ms after the person's estimated onset. That was before the detector had their speech, and the detector stopped it 80 to 140 ms later. About 0.1 s of bot audio each.

**Noise, provider hears nothing (311 clips):**

| group | today stopped | pause, go on only after empty: stopped (by deadline) | pause, also go on watched: stopped | held s per min of talk, watched |
| --- | --- | --- | --- | --- |
| Steady non-speech (177) | 168 | 145 (137) | **11** | 4.1 |
| Scenes (21) | 21 | 20 (20) | **1** | 3.2 |
| Speech-like, e.g. babble (93) | 93 | 91 (24) | 70 | 5.1 |
| Three knocks (20) | 20 | 0 | 0 | 8.0 |

- **Every remaining stop when going on watched** is the detector hearing speech in the noise. No stop comes from the deadline, and no view was lost.
- **By level, steady noise stopped:**
  - -45 dBFS: 23 of 97, against 88 today;
  - -35 dBFS: 28 of 97, against 97 today;
  - -25 dBFS: 31 of 97, against 97 today.
- **Knocks, one trial each:**
  - Going on only after empty: held 3.3 s. The recognizer finished at 3.3 s and the bot went on at 3.3 s.
  - Going on watched: held **1.6 s**. The bot went on at 1.6 s, while the recognizer still finished at 3.3 s. So the recognizer's own pause no longer adds to the hold.

**Noise, provider hears words in anything:** no rescue, as you predicted.
- Every clip stops, as today.
- Going on watched never applies, because words are present.
- The cost is a pause before the stop: up to the 6 s deadline in 125 of 177 steady clips.

## 4. What a listener receives (synthetic, loopback)

`voice-worker/test/measure/receiverTiming.ts` (run by hand, not part of the suite) timestamps the bot's audio **as it arrives at a person's connection**:
- proximity: a werift peer decoding RTP;
- LiveKit: a room participant's `AudioStream`.

**Setup.** Each case was run 10 times per transport. "Silent" is the arrival of the last loud bot frame before a 100 ms gap, measured from when the sound starts at the microphone. The input is **synthetic**:
- tones on loopback;
- a fake detector that judges pitch and answers at once (real Silero needs 64 ms of speech evidence);
- scripted ears.

This is not a browser, a phone or a real network.

| transport | case | today's rule: silent, median / p95 | pause: silent, median / p95 | pause: heard again after the decision to go on, median / p95 |
| --- | --- | --- | --- | --- |
| proximity | voice | 85 / 104 ms | 87 / 102 ms | (stopped, 10 of 10) |
| proximity | 0.5 s hum | 85 / 88 ms (stopped) | 85 / 104 ms (went on, 10 of 10) | 18 / 37 ms |
| proximity | steady fan, then a voice | | fan: 84 / 89 ms; went on 10 of 10; voice: silent 42 / 82 ms, stopped 10 of 10 | 18 / 38 ms |
| LiveKit | voice | 138 / 181 ms | 183 / 197 ms | (stopped, 10 of 10) |
| LiveKit | 0.5 s hum | 173 / 186 ms (stopped) | 194 / 210 ms (went on, 10 of 10) | 43 / 49 ms |
| LiveKit | steady fan, then a voice | | fan: 200 / 220 ms; went on 10 of 10; voice: silent 161 / 174 ms, stopped 10 of 10 | 47 / 50 ms |

- **No burst on going on.** In the 500 ms after the bot was heard again, the listener got 21 to 22 frames of 20 ms (proximity) and 41 to 44 frames of 10 ms (LiveKit), which is real-time pace.
- **Fan trials.** All 20 went: pause, go on, then stop on `confirmed_detector_while_continuing`.
- **Proximity** meets the 200 ms first-change gate with room to spare, for today and the pause alike.
- **LiveKit** sits at the 200 ms gate even with today's rule (p95 181 to 186 ms). The pause adds about 15 to 30 ms there (p95 197 to 220 ms), so the pause **misses the 200 ms gate on LiveKit in 2 of 3 cases at p95**.
  - The likely cause is the audio already queued for the room's output. A hold stops new frames, but what is already queued still plays.
  - Shortening that output queue is a separate change to the LiveKit output, not made here. Real-device timing would settle whether it matters.

## 5. Packaged image and switch-off

The worker image was built normally from the Dockerfile at `79da7a1d`, then run by its own start command. `scripts/image-check.sh` did six traced runs. Summaries are in `results/image-check-yield/`.

**Every run:**
- reached nothing off the machine except STUN name lookups, with no Microsoft names in the traffic;
- heard the load's people on both transports, about 5,760 frames.

**Runs 1 to 4** (off, on, off again, on without the reporting switch) are the same as the earlier packaging check.
- The detector answered inside the image with no network.
- Off: the runtime library is not even loaded.

**Runs 5 and 6** used `VOICE_YIELD_BOTS` naming the load's four bots, then the same settings without it after a restart. Both started and ran cleanly, but **no pause counter moved in either run**.
- The load generator opens no speech-to-text for its bots, and without speech-to-text the worker's gate never runs. So the image run proves only that the setting starts cleanly and that removing it leaves a clean worker. It does not show a pause in the image.

**The behaviour of the switch is shown by a new test instead.** It reads the setting through the worker's own config:
- named in `VOICE_YIELD_BOTS`: the bot pauses over a hum and goes on;
- the same worker built without it: the same hum stops the bot as today.

**The rollout setting:**
- it is read only when the detector is on;
- an empty or removed value names nothing;
- an unknown policy falls back to `hold`.

**Switch-off procedure:** remove `VOICE_YIELD_BOTS` and restart the worker.

The image predates the last head, which only merged `universe-develop` (#2010, private answers) and the Sentry fixes.

## 6. Not done, stated plainly

- **Real-provider timing:** not done. There is no Soniox key in this environment. Every rescue number above uses a scripted provider. Before any claim that real recognition rescues anything, the next step is recorded clips through Soniox on dev, measuring transcript correctness and the pause-to-final timing.
- **Real browsers and phones:** not done. The receiver numbers are from loopback with synthetic tones, not from a browser, a phone or a real network.
- **Activation:** off for everyone. When it is turned on, it should name a private bot only the owner uses. An allowlisted bot covers everyone who talks to it.

## 7. Two questions

**Q1. Babble.** Speech-like noise (cafe, TV) is still stopped in 70 of 93 clips, because the detector hears it as speech. Is that acceptable for the owner rollout, given that today stops all 93? Or should we hold the rollout for an addressing signal (out of scope here)?

**Q2. Rollout readiness.** Two items remain: real-provider timing and a real-device check. Once both are done with no regressions, may the owner rollout on one private bot go ahead without another full review round? A short results note would come back to you.
