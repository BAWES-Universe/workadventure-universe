# Quiet window: tune half only

3550 speech clips, 290 noise clips. Behaviour: pause, and go on watched over steady noise.
The rule, declared before the runs: the shortest window that (a) misses no more people than today, and is no worse than 1500 ms on
(b) false resumes, (c) overlap on speech, (d) noise clips stopped. Otherwise 1500 ms stays.

| quiet window | (a) people never stopped (today) | (b) speech clips with a false resume | (c) overlap on speech, total | (d) noise clips stopped | held s per min of noise | three knocks: held, median | meets all |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 300 ms | 11 (11) | 26 | 2.8 s | 66 | 1.2 | 0.4 s | no: b, c |
| 600 ms | 11 (11) | 49 | 4.6 s | 66 | 2.0 | 0.7 s | no: b, c |
| 1000 ms | 11 (11) | 354 | 29.8 s | 66 | 3.2 | 1.1 s | no: b, c |
| 1500 ms | 11 (11) | 6 | 0.5 s | 66 | 4.6 | 1.6 s | yes |

**Picked and frozen: 1500 ms.**
