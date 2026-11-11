# Both paths: proximity WebRTC (peer lane) and LiveKit room

## Frame size

59 clips, 11583 windows, fed in 512, 320 (20 ms, peer lane), 160 (10 ms, room), 480 and random 1 to 997 samples at a time.

Largest difference in speech probability between any two ways of cutting the same audio: **0**.

## Same clips through each path

570 speech clips (English and Arabic commands, English sentences; soft, very soft, and in noise) and 59 minutes of non-speech noise at -35 dBFS, all from the report half.

| path | detector | fired for the person | delay p50 ms | p95 | false stops on the noise |
| --- | --- | --- | --- | --- | --- |
| fixture as is (20 ms) | silero p>=0.50 for 64 ms | 567/570 | 78 | 504 | 7 in 0.59 h |
| fixture as is (20 ms) | gate 100 ms | 542/570 | 110 | 440 | 102 in 0.59 h |
| peer lane: Opus 32 kbps + worker resampler (20 ms) | silero p>=0.50 for 64 ms | 565/570 | 84 | 536 | 5 in 0.59 h |
| peer lane: Opus 32 kbps + worker resampler (20 ms) | gate 100 ms | 543/570 | 120 | 520 | 121 in 0.59 h |
| room: Opus 32 kbps + other resampler (10 ms) | silero p>=0.50 for 64 ms | 564/570 | 84 | 536 | 4 in 0.59 h |
| room: Opus 32 kbps + other resampler (10 ms) | gate 100 ms | 544/570 | 120 | 530 | 110 in 0.59 h |
| peer lane: Opus 16 kbps (weak network) | silero p>=0.50 for 64 ms | 565/570 | 84 | 536 | 4 in 0.59 h |
| peer lane: Opus 16 kbps (weak network) | gate 100 ms | 543/570 | 120 | 520 | 122 in 0.59 h |

Clips where the picked rule gives a different answer than on the plain fixture:

- peer lane: Opus 32 kbps + worker resampler (20 ms): 2 no longer caught, 0 newly caught, of 570.
- room: Opus 32 kbps + other resampler (10 ms): 3 no longer caught, 0 newly caught, of 570.
- peer lane: Opus 16 kbps (weak network): 2 no longer caught, 0 newly caught, of 570.
