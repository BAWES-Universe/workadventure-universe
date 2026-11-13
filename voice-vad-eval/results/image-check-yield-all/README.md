# The pause on for every bot, on the packaged image

**Image.** `voice-worker:yield-all`, built from commit bac8284d with the repository's Dockerfile, image id
`sha256:2e68c544a11bec8d7c90ffb40f6f9fb6a1d259d252344b24b05e01de967bf611`.

**How it was run.** The image was started by its own command, with 512 MB and 1 CPU, and **no detector or pause settings**: as shipped. The driver
was `voice-worker/test/measure/imageYield.ts`, the same as `../image-check-yield-final/`:
- **Real:** the image's worker, its detector and its Soniox connector; the bot server's relay; one person on their own peer connection (Opus).
- **Stand-in:** the Soniox endpoint is a local fixture that hears no words.
- **Audio:** MS-SNSD `AirConditioner_1.wav` at -30 dBFS, then `clnsp1.wav` speech at -20 dBFS over it.

| run | settings | what happened |
| --- | --- | --- |
| 1-default | none (as shipped) | fan on at 3.6 s; held 0.12 s later; went on over the fan 1.6 s later (`yield_continue_ms` 1604); 75 bot packets in the next 1.5 s; no one announced, reply not finished; the voice over the fan stopped it for good 121 ms after the voice began (`barge_in`, played 2,300 ms, `yield_confirmed_detector_while_continuing` 1) |
| 2-switched-off | `VOICE_SPEECH_OBSERVER=0` (the engineers' off switch), restarted | the same fan stopped the reply 0.1 s after it began (`barge_in`, played 660 ms); detector not loaded; no `yield_*` counter moved |

**About the timings.** They come from the driver's clock, polling `/stats` every 50 ms, so they bound the worker's own timing rather than measure it.
