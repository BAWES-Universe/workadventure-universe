# Noise pause, engineer checks, Part 1 (13 Nov 2026)

Code under test: #2013 head `af07f469` (the pause on for every voice bot, engineers' off switch `VOICE_SPEECH_OBSERVER=0`).
Image: `voice-worker:observer-packaged`, id `sha256:ef31f7e942f097fe0b60a2e19cdf775da8347daee64b1b2506380a74af9edccf`, built from the repository's Dockerfile
with one difference: `npm ci` ran on the host (the build container's own `npm ci` died with "Exit handler never called" on this machine's network)
and the two `node_modules` folders were copied in; everything after that line of the Dockerfile is unchanged. 512 MB, 1 CPU, as in production.
LiveKit server: `livekit/livekit-server:v1.8.4`, the version the repository pins. Browser: Chromium 153 (Playwright).

Nothing here touches a live system, uses a paid service, or needs a setting.

## 1. No skipped or repeated words

`src/words-fuzz.ts`: 200 random scenarios (2 or 3 people, 40 to 70 s each: speech, noise, silence, audio dropping, people leaving and coming back,
the bot speaking in turns), each run twice through the worker's own `Recognition` on identical input and simulated time, once as today and once with the real
`YieldControl` on. Every 20 ms frame carries a tag, so a "word" is exactly one frame of one person's voice.

- 3,550 turns, 340,118 words delivered; the pause held the reply 1,371 times, went on over steady noise 179 times, stopped it 1,167 times.
- **0 repeated words, 0 out of order, 0 differences** in what was delivered to the bot between today and the pause (per person: every turn's outcome and words).
- Self-test: `FUZZ_BREAK=1` makes the pause run lose one frame in 700; the check reports it (6 problems in 3 scenarios), so it can see a loss.
- Not the same as real speech to text: the provider is scripted (it hears voice frames, never noise).
- The worker's own end-to-end tests also pass: `test/speechYield.test.ts` 63 of 63 with a local LiveKit.

## 2. 15 people, the 16th and 17th, prod size

`scripts/part1-soak.sh`, the image as shipped (no setting) beside the image with the off switch, 10 minutes each, side by side:
10 people on their own connections + 7 in LiveKit rooms = 17, bots speaking every 10 s, people talking over each other, leaving, coming back, losing audio.
Full table: `overflow17/table.md`.

| | off switch | as shipped |
| --- | --- | --- |
| people watched by the detector at most | none | 15 |
| frames of the people beyond 15 turned away from the detector | - | 47,463 |
| audio the worker heard, of what was sent | 96.0% | 96.2% |
| container memory peak (cap 512 MB) | 120 MB | 153 MB |
| memory kills / errors / bridge links lost | 0 / 0 / 0 | 0 / 0 / 0 |
| event-loop delay p99 / max | 8.2 / 108 ms | 9.2 / 96 ms |
| closing with everyone connected | 56 ms | 28 ms |

Everyone beyond 15 is not watched and today's rule decides for them (heard exactly as much, nobody lost). That a person who is not watched stops the bot as today
is the worker's unit test `speechYield.test.ts: "cannot tell (not loaded, not watched, another path): today's rule at once"`. The 16th person's noise, at the image level (`src/chrome-sixteenth.ts`, `sixteenth/result.json`): with 15 people keeping the detector's 15 places busy, a real Chromium joined as the 16th and a fan
played over the bot: the fan stopped the reply 106 ms after it started, as today (`yield_fallback_not_fresh` 1, `observer_streams_refused` counted, no pause). With places free again the same fan
made the pause hold and go on. The 30-minute soak of the earlier build is not repeated (this one is 10 minutes).

## 3. The off switch with a call running (real Chrome)

`src/chrome-offswitch.ts`: one person (Chromium, own peer connection) in a call with a bot. The engineers' procedure, exactly: set `VOICE_SPEECH_OBSERVER=0`, restart
the worker, while the bot is in the middle of a reply; later the same back on. Result (`offswitch.json`):

| step | what happened |
| --- | --- |
| as shipped, fan | the bot pauses, goes on over the fan, a voice stops it 89 ms after it starts |
| switched off while the bot spoke | worker healthy again after 2.2 s; the person reconnected 1.6 s after that; the bot was heard again; the reply that was running is lost (a restart ends it) |
| off, same fan | stops the reply at once as today (123 ms); no pause counters, detector not loaded |
| switched back on while the bot spoke | healthy after 2.5 s; reconnected 1.4 s later; bot heard again |
| on, same fan | pause again (goes on after 1.6 s), voice stops it 106 ms after it starts |

The reconnect is the bot server's own: `WorkerLink` comes back up, `VoiceCalls` asks the person to start again, and the page makes a new connection.

## 4. Timing in a real Chrome with the real detector, paired with today

`src/chrome-timing.ts`, tables in `tables.md`, raw trials in `proximity-20.json` and `livekit-20.json`. Chromium is the person on each transport: its own peer
connection (proximity) or `livekit-client` 2.16.1, the game's version (LiveKit room). Real: Chromium's WebRTC (Opus, jitter buffer), the image's worker, its Silero
detector and Soniox connector, the bot server's relay. Stand-ins: Soniox is a local fixture that hears no words (so only the detector can stop a reply);
the microphone is recorded audio played into Chrome through Web Audio (MS-SNSD `AirConditioner_1` at -30 dBFS; `clnsp1` speech at -20 dBFS); the listening
is a page worklet. Two workers, one as shipped and one with the off switch, trials alternate between them (20 voice interruptions per transport; 10 each of
a 0.5 s knock and a steady fan). The clock is one machine's, from the moment the page switches the audio on, so Chrome's capture and encode delay is in every number.

Median / p95, ms (samples):

| | transport | today | pause |
| --- | --- | --- | --- |
| voice over the bot: bot silent in Chrome | proximity | 351 / 399 (20) | 350 / 404 (20) |
| | LiveKit | 223 / 246 (20) | 219 / 236 (20) |
| voice over the bot: worker cancels the reply | proximity | 111 / 127 | 110 / 124 |
| | LiveKit | 153 / 171 | 159 / 173 |
| paired (pause minus today), silent in Chrome | proximity | | median -5, worst +73 |
| | LiveKit | | median -8, worst +22 |
| knock or fan: worker pauses | proximity / LiveKit | stops 10 of 10 | 112 / 152 (hum), 98 / 159 (fan) |
| pause goes on over the knock or fan after | proximity / LiveKit | | about 1.7 s, 10 of 10 on both |
| bot heard again in Chrome after the decision to go on | proximity / LiveKit | | 77 to 99 ms / 93 to 167 ms |
| a voice inside the fan, the bot silent in Chrome | proximity / LiveKit | | 331 / 563 and 341 / 417 (10 each) |

The pause stopped the reply in 20 of 20 voice interruptions on both transports. Today stopped for the fan and the knock in 10 of 10; the pause went on in 10 of 10, and
a voice inside the fan then stopped it in 10 of 10.

## Not covered, left for Part 2

Real phones and the laptop (iPhone Safari and PWA, Android Chrome, a real microphone), more than one talker per Chromium, and real Soniox timing (the fixture hears no words). Babble (many voices) is still not solved, as before.

## Re-running

```
docker run -d --name lk --network host -v $PWD/livekit.yaml:/etc/livekit/config.yaml livekit/livekit-server:v1.8.4 --config /etc/livekit/config.yaml   # key devkey / secret-secret-secret-secret-12345
RUNS=on PORT=8830 LANE_PEOPLE=10 ROOM_PEOPLE=7 sh scripts/part1-soak.sh $PWD/data out/part1/overflow17 600 &   # and RUNS=off PORT=8831
tsx src/words-fuzz.ts 200 out/part1/words-fuzz-200.json 1
tsx src/chrome-offswitch.ts 8860 8861 data/ms-snsd/noise_test/AirConditioner_1.wav data/ms-snsd/clean_test/clnsp1.wav out/offswitch.json
tsx src/chrome-timing.ts <pause port> <today port> <fixture port> <noise wav> <speech wav> 20 out/proximity.json      # TRANSPORT=livekit for the room
python3 -I scripts/chrome-timing-table.py out/proximity.json out/livekit.json
```
Needs Chromium (`PLAYWRIGHT_DIR`), and for the room `livekit-client` 2.16.1's `dist/livekit-client.umd.js` (`LIVEKIT_CLIENT_UMD`).
