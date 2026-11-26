
### proximity (Chrome 153.0.8010.12)

median / p95 ms (samples). 'silent' = sound starts at the mic to bot silent in Chrome.

| case | behaviour | trials | silent | worker cancel | pause (hold) | decide to go on | back in Chrome after go-on | stopped by the noise | voice over noise: silent | voice over noise: cancel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| voice | today | 20 | 351 / 399 (20) | 111 / 127 (20) | - | - | - | 0 | - | - |
| voice | pause | 20 | 350 / 404 (20) | 110 / 124 (20) | 114 / 118 (20) | - | - | 0 | - | - |
| hum | today | 10 | 368 / 394 (10) | 110 / 119 (10) | - | - | - | 10 | - | - |
| hum | pause | 10 | 379 / 398 (10) | - | 112 / 115 (10) | 1711 / 1724 (10) | 77 / 89 (10) | 0 | - | - |
| fan | today | 10 | 297 / 404 (10) | 118 / 128 (10) | - | - | - | 10 | - | - |
| fan | pause | 10 | 372 / 397 (10) | - | 98 / 115 (10) | 1702 / 1714 (10) | 99 / 107 (10) | 0 | 331 / 563 (10) | 154 / 257 (10) |

voice, paired (pause minus today), silent in Chrome: median -5 ms, p95 +73 ms, worst +73 ms, n=20
voice trials where the pause did not stop the reply: 0 of 20
hum: pause went on in 10 of 10; today stopped in 10 of 10
fan: pause went on in 10 of 10; today stopped in 10 of 10
fan then voice: the voice stopped the reply in 10 of 10
counters (pause worker): {'yield_episodes': 50, 'yield_holds': 50, 'yield_candidates': 50, 'yield_confirmed_detector': 30, 'yield_stops': 40, 'yield_continues': 20, 'yield_ended_empty': 10, 'yield_continuing_resolved_empty': 10, 'yield_confirmed_detector_while_continuing': 10}
counters (today worker): {}

### livekit (Chrome 153.0.8010.12)

median / p95 ms (samples). 'silent' = sound starts at the mic to bot silent in Chrome.

| case | behaviour | trials | silent | worker cancel | pause (hold) | decide to go on | back in Chrome after go-on | stopped by the noise | voice over noise: silent | voice over noise: cancel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| voice | today | 20 | 223 / 246 (20) | 153 / 171 (20) | - | - | - | 0 | - | - |
| voice | pause | 20 | 219 / 236 (20) | 159 / 173 (20) | 162 / 166 (20) | - | - | 0 | - | - |
| hum | today | 10 | 268 / 295 (10) | 161 / 173 (10) | - | - | - | 10 | - | - |
| hum | pause | 10 | 249 / 306 (10) | - | 152 / 162 (10) | 1755 / 1771 (10) | 93 / 162 (10) | 0 | - | - |
| fan | today | 10 | 278 / 301 (10) | 137 / 146 (10) | - | - | - | 10 | - | - |
| fan | pause | 10 | 289 / 300 (10) | - | 159 / 162 (10) | 1756 / 1764 (10) | 167 / 176 (10) | 0 | 341 / 417 (10) | 178 / 296 (10) |

voice, paired (pause minus today), silent in Chrome: median -8 ms, p95 +22 ms, worst +22 ms, n=20
voice trials where the pause did not stop the reply: 0 of 20
hum: pause went on in 10 of 10; today stopped in 10 of 10
fan: pause went on in 10 of 10; today stopped in 10 of 10
fan then voice: the voice stopped the reply in 10 of 10
counters (pause worker): {'yield_episodes': 50, 'yield_holds': 50, 'yield_candidates': 50, 'yield_confirmed_detector': 30, 'yield_stops': 40, 'yield_continues': 20, 'yield_ended_empty': 10, 'yield_continuing_resolved_empty': 10, 'yield_confirmed_detector_while_continuing': 10}
counters (today worker): {}
