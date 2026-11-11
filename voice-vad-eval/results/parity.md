# Both paths: proximity WebRTC (peer lane) and LiveKit room

Status: **partial, simulated**. Frame-size sameness is exact. The codec and resampler part is a reconstruction; the real transports, packet loss, jitter and reconnects are not exercised here.

## Frame size

59 clips, 11583 windows, fed in 512, 320 (20 ms, peer lane), 160 (10 ms, room), 480 and random 1 to 997 samples at a time.

Largest difference in speech probability between any two ways of cutting the same audio: **0**.

## Same clips through each path

570 speech clips (English and Arabic commands, English sentences; soft, very soft, and in noise) and 59 non-speech noise recordings at -35 dBFS, all from the report half. Delays include the codec's own delay, which the estimated onset does not.

| path | detector | VALID | EARLY only | newly missed on this path | delay p50 ms | p95 | firings on the noise |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixture as is (20 ms) | silero p>=0.50 for 64 ms | 566/570 | 0 | 3 | 78 | 504 | 7 in 35.2 min |
| fixture as is (20 ms) | gate 100 ms | 542/570 | 0 |  | 110 | 440 | 102 in 35.2 min |
| peer lane: Opus 32 kbps + worker resampler (20 ms) | silero p>=0.50 for 64 ms | 563/570 | 1 | 5 | 84 | 536 | 5 in 35.2 min |
| peer lane: Opus 32 kbps + worker resampler (20 ms) | gate 100 ms | 543/570 | 0 |  | 120 | 520 | 121 in 35.2 min |
| room: Opus 32 kbps + stand-in resampler (10 ms) | silero p>=0.50 for 64 ms | 564/570 | 0 | 5 | 84 | 536 | 4 in 35.2 min |
| room: Opus 32 kbps + stand-in resampler (10 ms) | gate 100 ms | 544/570 | 0 |  | 120 | 530 | 110 in 35.2 min |
| peer lane: Opus 16 kbps (low bitrate only) | silero p>=0.50 for 64 ms | 563/570 | 1 | 5 | 84 | 536 | 4 in 35.2 min |
| peer lane: Opus 16 kbps (low bitrate only) | gate 100 ms | 543/570 | 0 |  | 120 | 520 | 122 in 35.2 min |

- fixture as is (20 ms): newly missed on this path (gate VALID, rule not VALID): `speech|en/stop/b1114e4f_nohash_0.wav|S30`, `speech|en/stop/f8f60f59_nohash_1.wav|S30`, `speech|en/stop/fd395b74_nohash_4.wav|S30`.
- peer lane: Opus 32 kbps + worker resampler (20 ms): newly missed on this path (gate VALID, rule not VALID): `speech|en/stop/b1114e4f_nohash_0.wav|S30`, `speech|en/stop/f8f60f59_nohash_1.wav|S30`, `speech|en/stop/fd395b74_nohash_4.wav|S30`, `speech|en/yes/97f4c236_nohash_2.wav|S30`, `speech|en/yes/f34e6f44_nohash_2.wav|S30`.
- room: Opus 32 kbps + stand-in resampler (10 ms): newly missed on this path (gate VALID, rule not VALID): `speech|en/stop/b1114e4f_nohash_0.wav|S30`, `speech|en/stop/f8f60f59_nohash_1.wav|S30`, `speech|en/stop/fd395b74_nohash_4.wav|S30`, `speech|en/yes/f34e6f44_nohash_2.wav|S30`, `speech|en/go/0d53e045_nohash_0.wav|S30`.
- peer lane: Opus 16 kbps (low bitrate only): newly missed on this path (gate VALID, rule not VALID): `speech|en/stop/b1114e4f_nohash_0.wav|S30`, `speech|en/stop/f8f60f59_nohash_1.wav|S30`, `speech|en/stop/fd395b74_nohash_4.wav|S30`, `speech|en/yes/97f4c236_nohash_2.wav|S30`, `speech|en/yes/f34e6f44_nohash_2.wav|S30`.

Clips where the frozen rule answers differently than on the plain fixture:

- peer lane: Opus 32 kbps + worker resampler (20 ms): 3 no longer VALID (`speech|en/yes/97f4c236_nohash_2.wav|S30`, `speech|en/yes/f34e6f44_nohash_2.wav|S30`, `speech|sent/clnsp665.wav|N10`), 0 newly VALID, of 570.
- room: Opus 32 kbps + stand-in resampler (10 ms): 3 no longer VALID (`speech|en/yes/f34e6f44_nohash_2.wav|S30`, `speech|en/go/0d53e045_nohash_0.wav|S30`, `speech|sent/clnsp665.wav|N10`), 1 newly VALID (`speech|sent/clnsp586.wav|N10`), of 570.
- peer lane: Opus 16 kbps (low bitrate only): 3 no longer VALID (`speech|en/yes/97f4c236_nohash_2.wav|S30`, `speech|en/yes/f34e6f44_nohash_2.wav|S30`, `speech|sent/clnsp665.wav|N10`), 0 newly VALID, of 570.
