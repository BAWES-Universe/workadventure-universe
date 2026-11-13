# The two disputed soft English commands (S40)

GPT's readiness review (13 Nov 2026) asked that these be settled by independent listening to both the source and the exact
processed input, with hashes and a brief reason, before the private-bot trial. Listened 13 Nov 2026: A is relabelled as noise. C is uncertain: it is kept as an unscored diagnostic case, and GPT agreed (13 Nov) that it does not block the private trial on its own.

| clip | file | sha256 |
| --- | --- | --- |
| A | source `mini_speech_commands/no/15c563d7_nohash_1.wav` | `29ae3e901af1819a5fa5dd3d061c9f52d3ddc66d8a2da011da4e9fb9cce9bfdd` |
| A | as played, `speech\|en/no/15c563d7_nohash_1.wav\|S40` (3 s, 16 kHz) | `8e99a8fa934913ddb8842361681698467ce2ca5066907399fed2f032d9919ece` |
| C | source `mini_speech_commands/stop/fd395b74_nohash_3.wav` | `6a610ce17b9b8ce504e02f057d880e45c7cf93ada14e5b2aa7d68a4a47387680` |
| C | as played, `speech\|en/stop/fd395b74_nohash_3.wav\|S40` | `917d613a65f886ca8e2d553032eb213656133271fee2d876e8f6c3f1c3717794` |
| B (control, known speech, same contributor as A) | source `mini_speech_commands/yes/15c563d7_nohash_0.wav` | `2b6d8d32cb35f590498c03d06a7192d013a5f7491117ec786215a2c820f62bc9` |
| B | as played, `speech\|en/yes/15c563d7_nohash_0.wav\|S40` | `bb227ea58d2b1d903d4088bd05eca04d3f5ccf76c976cf5f63dd0ccd06dad172` |

"As played" is `audioOf()` in `src/played.ts`, written as a 16-bit WAV; the hash is of that file.

## Machine readings so far (not listening)

| clip | source level | Whisper base, levelled (source / as played) | WebRTC VAD voice, levelled | earlier label (`results/adjudication.tsv`) |
| --- | --- | --- | --- | --- |
| A "no" | RMS -49.8 dBFS, 10 ms frames -60 to -44 | "(music)" / "(music)" | 1,000 ms of 1,000 | uncertain |
| C "stop" | RMS -66.0 dBFS, 10 ms frames -70 to -61 | "[Music]" / "I'm going to kill him." (a known hallucination on noise) | 910 ms of 1,000 | no speech |
| B "yes" (control) | RMS -18.2 dBFS | "Yes" / "Yes" | 630 ms | valid speech |

- In the real Soniox run both A and C gave an empty final and no words. Silero heard no speech in either.
- **Spectrograms**, looked at by the engineer, not listened to:
  - C shows broadband noise with no harmonic stack.
  - A shows a few steady horizontal tones (a hum), with no harmonic stack or formant movement.
  - For comparison, a quiet "yes" from C's contributor shows a short, faint harmonic stack.
- These readings support "no voice". By GPT's rule they do not settle it.

## Listening

**Setup.** On 13 Nov 2026, about 2:10 PM Kuwait time, a person listened to a blind page with headphones. It played A, B and C in that order, with no words or results shown:
- the source, peak-normalised to -3 dBFS;
- the as-played input, peak-normalised the same way.

The scored waveforms are unchanged. B is a positive control. One listener.

**Answers, verbatim:**
- A: "no voice"
- B: "has voice". The control passed.
- C: "static sound and a weird hint of voice starting towards the end but no recognizable voice"

**What follows** (GPT, 13 Nov: accepted, with the labels below):

The labels live in `src/listened.ts`. They apply to every variant of the source, and to today and the pause alike, in both reports.

**A is noise.** It leaves the speech rows, and the original-label rows stay as the sensitivity view.

**C is uncertain.** It is not proven noise, not a proven cut-off command, and not a passed speech test. It is unscored in the primary view and counted as speech in the conservative view. Its result is kept as a diagnostic: today stopped; the pause never stopped, with 8.0 s of bot playback after going on, including the replay tail.

Band energy matches what was heard. C's 100-300 Hz band rises about 10 dB above its floor at 300-350 ms and again from 850 ms to the end, while the higher bands stay flat. That is not evidence of a voice either way.

**Soft English S40, Soniox run:**

| view | speech clips | never stopped: today / pause |
| --- | --- | --- |
| original labels | 40 | 0 / 2 |
| A relabelled, C counted as speech (conservative) | 39 | 0 / 1 possible miss |
| A relabelled, C unscored (primary) | 38 | 0 / 0 |

The primary row means no additional never-stopped clips among those 38. It does not prove that there are no new misses overall.

**Scripted replay (`results/yield-replay.md`):** there are 5 variants of each source. Every variant was stopped by every behaviour except C's S40. Speech clips number 3,195 in the conservative view and 3,190 in the primary. In both, the pause stops 99.1% for the person, against 64.3% today, and misses none of today's stops.

**No change to the detector or the 1,500 ms window.** The next evidence is fresh, clearly spoken speech through a real microphone in the device check.
