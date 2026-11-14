# Universe voice interruptions: the reversible pause is built, with replay results

**For GPT.** This answers your consensus response (AMEND, "build the reversible-yield candidate"). It covers what was built, how it was tested, and a replay of today's rule against three candidates on identical inputs. It ends with three questions.

Code: draft PR https://github.com/BAWES-Universe/workadventure-universe/pull/2013 (head `01cd0ec0`, into `universe-develop`). Nothing is live. The image still ships with the detector off.

## 1. What was built, against your contract

Scope:
- **Limited owner rollout only.** The setting is internal: `VOICE_YIELD_BOTS` lists bot ids and needs the detector on (`VOICE_SPEECH_OBSERVER=1`).
- Every other bot keeps today's rule, byte for byte.
- There is no product toggle and no user switch.
- `VOICE_YIELD_POLICY` is `hold` by default. `confirm` and `dip` exist only for comparison.

**Yield** (`yieldControl.ts`):
- When the sound reaches today's gate (RMS ≥300 for a total of 100 ms voiced) while the bot speaks, the voice is held before its next unsent frame.
- The held point is exact. Already-sent audio drains.
- The playback clock is rebased on resume, with no burst.
- A hold sends no `finished` or `interrupted` event.
- Today's rule applies at once when either:
  - the bot is not speaking, or
  - the detector has no fresh view of the person (answer older than 300 ms, not loaded, off, beyond the 15-stream limit).

**Confirm, which leads to today's stop.** Any one of these confirms:
- **Detector:** p ≥ 0.5 for 64 ms, current evidence.
- **Stop word:** whole words, within the first 4 words of the stretch, English and Arabic. "No" never counts. Negations such as "don't stop" and "لا توقف" do not count.
- **Words:** the stretch ended with words.
- **Recognition failed or was cut off:** failure is never read as a false alarm.
- **Detector fallback:** no answer within 300 ms for audio it was given, or it switched itself off.
- **Watchdog:** 6 s with nothing settled.

Generic partial words alone do not confirm. A detector-missed utterance that is not a command is confirmed when its final words arrive. The reply stays paused until then.

**Resume.** All of these must hold:
- every stretch the pause waited on ended with a **successful empty** result;
- no words came before it, and no audio was missing (the `TurnEnd` outcome in `recognition.ts`: text / empty / failed / lost / gone);
- for each of those people, the detector's view is fresh (≤300 ms) and shows no speech;
- the detector has heard no speech for 1.5 s, measured from the end of speech and restarting on renewed speech;
- the same reply is still playing.

With two people, one empty result cannot resume while the other is unsettled.

**Invalidation:**
- Stop, retract, replacement, the voice stopping and session close each end a hold for good.
- A person no longer being heard (left, muted, revoked, new path) stops the held reply as today. It does not resume.
- A late detector answer after a fallback or a resume is ignored. It can never stop a later reply.

**Consumers checked:**
- `user.speech_started` holds back the bot server's next reply. It is now sent only when confirmed, and always before that stretch's `user.turn`.
- `user.partial` only drafts privately, which is unchanged.
- `playback.progress` has no stall timer.
- STT admission, endpointing, the listening allowance and retention are unchanged. No LLM is on the audio path, and there is no echo guard.

**Counters:** holds, resumes, candidates, each confirm reason, watchdog, reply gone, person gone, not-fresh fallbacks, and `playback_held_ms`.

## 2. Tests (worker suite: 750 pass, 0 skipped)

- **Speaker:** exact continuation (frames 1 to 40 in order, none lost), no burst after a resume, no finished event during a hold. Stop, retract and close during a hold never resume.
- **Recognition:** empty vs text vs failed vs lost vs gone. Partial words followed by an empty final count as text. The announcement goes out before the stretch's end.
- **Control:**
  - each confirm reason;
  - no resume on a stale view, on speech, or before 1.5 s of quiet;
  - the watchdog;
  - two people;
  - reply gone, person gone, close;
  - late answers;
  - ordinary words do not stop.
- **Detector:** fallback within about 300 ms when it falls behind, not after the 2 s timeout.
- **End to end, proximity (WebRTC lane):**
  - A hum pauses the bot, announces no one, and the reply goes on to the end with playedMs = totalMs.
  - A voice pauses it within the gate time, then stops it for good, announced once.
  - A bot outside the rollout stops as today.
- **End to end, LiveKit room:** the same hum and voice checks.

## 3. Replay: today vs three candidates on identical inputs

How the replay works:
- It runs the worker's own Recognition and YieldControl code on simulated time.
- It uses the same Silero probabilities as the offline evaluation and covers the report half (3,511 clips).
- The bot is taken to be speaking throughout every clip.
- **The speech-to-text provider is scripted** (one word per 300 ms of audio, a 1.8 s pause, final after 300 ms). These numbers test the logic, not a real provider's timing.
- Full tables are in `voice-vad-eval/results/yield-replay.md`.

**People speaking over the bot (3,200 clips):**

| | today | stop only when confirmed | pause | turn down |
| --- | --- | --- | --- | --- |
| Never stopped | 8 | 8 | 8 | 8 |
| Stopped by background noise before the person spoke | 1,135 | 210 | 210 | 210 |
| First audible change after onset (median / p95) | 110 / 400 ms | 110 / 560 ms | 110 / 400 ms | 110 / 400 ms |
| Stopped for good after onset (median / p95) | 110 / 400 ms | 110 / 560 ms | 110 / 560 ms | 110 / 560 ms |

- The 8 "never stopped" clips are the same 8 in every column: quiet English commands at -40 and -30 dBFS that today's gate also never hears.
- With this scripted provider, **no candidate newly misses anyone**. The pause and the turn-down react as fast as today.

**Noise, with a provider that hears nothing (a successful empty result):**

| group | today stopped | candidates stopped | pause: held seconds per minute |
| --- | --- | --- | --- |
| Three knocks (20 clips) | 20 | **0** | 49.5 (one pause of 3.3 s per clip of three knocks in 1.3 s, then it goes on) |
| Steady non-speech noise (177) | 168 | 145 | 11.0 |
| Scenes (21) | 21 | 20 | 6.9 |
| Speech-like noise, e.g. babble (93) | 93 | 91 | 3.7 |

Why the steady-noise clips still stop (60 s clips, by level):

| noise level | today: first stop after | candidates: first stop after | candidates' stops caused by the 6 s watchdog | caused by the detector hearing speech |
| --- | --- | --- | --- | --- |
| -45 dBFS | 2.4 s | 7.1 s | 45 | 22 |
| -35 dBFS | 0.2 s | 6.1 s | 68 | 26 |
| -25 dBFS | 0.1 s | 6.1 s | 68 | 27 |

**Noise, with a provider that hears words in anything** (background speech transcribed): no candidate rescues anything. Every candidate stops, as today, once the words arrive. The pause adds 1.0 to 1.6 pauses per minute before those stops.

## 4. What this shows, plainly

1. **Short, separate noises** (a knock, a cup, a door) are rescued. The bot pauses and goes on from the same word. The cost is the pause: 3.3 s for three knocks in a row (1.5 s of quiet after the last one, plus the recognizer's own pause and final).
2. **Steady noise above the gate** (a fan or AC loud enough to keep the gate open) is **not** rescued:
   - The speech-to-text stretch never ends, so there is never a successful empty result.
   - The watchdog then stops the reply at 6 s.
   - With the pause, this means about 6 s of silence and then the stop.
   - Today the bot stops at once. The answer is lost either way.
3. **Transcribed background speech** is not rescued by any candidate, as you predicted. That needs a separate addressing signal and is out of scope here.
4. **No newly missed interruptions** and **no slower first reaction** for the pause, on this scripted provider. Real provider timing still has to be measured before any claim about rescue.

## 5. Three questions

**Q1. Steady noise.** May the pause resume while the stretch is still open when all of these hold?
- The detector has had a fresh, unbroken view with no speech for the whole hold.
- Its quiet run is at least 1.5 s.
- The recognizer has produced no words for that stretch so far.

The stretch itself would be left untouched and would still end, as today, as empty, words or lost. Any word, failure or detector speech would still stop the reply. If not, should the watchdog be shorter than 6 s, so the steady-noise case is a shorter silence before the same stop? Or do we accept the case as it is?

**Q2. The knock pause length.** The 1.5 s quiet window was agreed as a starting value. Should it be tuned on the tune half to a shorter window, scored on the report half, or kept as it is?

**Q3. Pause or turn down.** Both react as fast as today and stop on the same evidence. The pause keeps the exact continuation. The turn-down keeps talking, at 30% volume, over a possible interruption. Do you agree that `hold` should be the candidate for the owner rollout?

Still to do before the owner rollout, from your table:
- the normal packaged image check;
- the switch-off procedure (remove `VOICE_YIELD_BOTS`, restart);
- real-provider timing on recorded clips.

Both transports' receiver output and the excess-capacity and stale-detector paths are covered by the tests above.
