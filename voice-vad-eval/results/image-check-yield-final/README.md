# The pause on the final packaged image (round-2 review, step 2)

Image `voice-worker:yield-4038559a`, built from commit 4038559a with the repository's Dockerfile, image id
`sha256:343bf5ee476dcf389a5beb708c82d276c86779c89536c635738b527328fd8bb3`. Started by its own command, 512 MB, 1 CPU,
with `VOICE_SPEECH_OBSERVER=1` (the real Silero detector in the image). Driver: `voice-worker/test/measure/imageYield.ts`.

Real: the image's worker, detector and Soniox connector, the bot server's relay, one person on their own peer
connection (Opus). Stand-in: the Soniox endpoint is a local fixture that hears no words (successful empty results),
named through the bubble's own `endpoint` setting. Audio: MS-SNSD `AirConditioner_1.wav` at -30 dBFS, then
`clnsp1.wav` speech at -20 dBFS over it.

| run | settings | what happened |
| --- | --- | --- |
| 1-pause | `VOICE_YIELD_BOTS=bot1` | fan on at 3.6 s; held 0.13 s later; went on over the fan 1.6 s later (`yield_continue_ms` 1605); 75 bot packets in the next 1.5 s (full rate); no one announced, reply not finished; voice over the fan stopped it for good 81 ms after the voice began (`barge_in`, `yield_confirmed_detector_while_continuing` 1); announced once |
| 2-allowlist-removed | same container settings without `VOICE_YIELD_BOTS`, restarted | the same fan stopped the reply 0.1 s after it began (`barge_in`, played 660 ms); no `yield_*` counter moved |

Timings are from the driver's clock, polling `/stats` every 50 ms: they bound, not measure, the worker's own timing.
