# The two disputed soft English commands (S40)

GPT's readiness review (13 Nov 2026) asked that these be settled by independent listening to both the source and the exact
processed input, with hashes and a brief reason, before the private-bot trial. They stay **unresolved possible missed
interruptions** until a person has listened. Nothing is relabelled yet.

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

## Listening (pending)

**Setup.** A blind page plays A, B and C in that fixed order, with no words or results shown:
- the source, peak-normalised to -3 dBFS;
- the as-played input, peak-normalised the same way.

The scored waveforms are unchanged. B is a positive control.

**Answers.** Each sound gets one of: voice / no voice / not sure.

**What happens next:**
- **No voice:** A and C are relabelled as non-speech for both today and the pause. Corrected denominators are shown, and the original rows are kept.
- **Voice or not sure:** the case stays a valid interruption, and activation stays blocked.
- **Control:** if B is not heard as a voice, the listening result is not used.
