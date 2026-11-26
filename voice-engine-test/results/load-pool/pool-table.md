| Config | N | processes | valid/runs | total CPU % (all processes) | total RSS MB (peak) | worst process loop delay p95 ms | end of speech to turn p50 ms | talk-over stop p50 / p95 ms | busiest process CPU % | load generator CPU % | whole box busy % of 4 cores |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A-local | 5 | single process (1) | 3/3 | 32 (±1) | 275 (±9) | 2.1 | 289 (±7) | 190 (±7) / 239 (±34) | (one process) | 8 (±0) | (not recorded) |
| A-local | 5 | pool of 2 | 3/3 | 38 (±2) | 492 (±4) | 1.1 | 281 (±5) | 182 (±4) / 208 (±3) | 22 (±1) | 10 (±1) | 13 (±1) |
| A-local | 5 | pool of 4 | 3/3 | 45 (±1) | 980 (±29) | 1.0 | 281 (±3) | 181 (±3) / 201 (±4) | 16 (±1) | 9 (±0) | 17 (±3) |
| A-local | 10 | single process (1) | 3/3 | 60 (±1) | 287 (±2) | 68.7 | 312 (±10) | 193 (±7) / 273 (±43) | (one process) | 11 (±0) | (not recorded) |
| A-local | 10 | pool of 2 | 3/3 | 66 (±2) | 531 (±15) | 2.2 | 292 (±8) | 187 (±3) / 279 (±8) | 33 (±1) | 12 (±0) | 23 (±2) |
| A-local | 10 | pool of 4 | 3/3 | 75 (±1) | 1039 (±24) | 1.3 | 293 (±4) | 188 (±5) / 227 (±11) | 22 (±0) | 11 (±0) | 24 (±2) |
| A-local | 20 | single process (1) | 3/3 | 105 (±1) | 323 (±1) | 120.9 | 561 (±29) | 375 (±69) / 940 (±58) | (one process) | 15 (±0) | (not recorded) |
| A-local | 20 | pool of 2 | 3/3 | 119 (±2) | 564 (±3) | 67.2 | 322 (±10) | 201 (±3) / 401 (±32) | 60 (±1) | 17 (±0) | 37 (±1) |
| A-local | 20 | pool of 4 | 3/3 | 130 (±5) | 1055 (±16) | 4.7 | 295 (±11) | 190 (±5) / 293 (±21) | 33 (±1) | 17 (±1) | 38 (±2) |
| B-local | 5 | single process (1) | 3/3 | 119 (±3) | 450 (±0) | 5.6 | 363 (±10) | 365 (±11) / 444 (±80) | (one process) | 11 (±0) | (not recorded) |
| B-local | 5 | pool of 2 | 3/3 | 120 (±5) | 604 (±0) | 1.9 | 341 (±5) | 368 (±9) / 400 (±11) | 73 (±3) | 12 (±0) | 35 (±1) |
| B-local | 5 | pool of 4 | 3/3 | 119 (±2) | 915 (±1) | 1.5 | 332 (±3) | 359 (±4) / 382 (±6) | 46 (±0) | 12 (±0) | 37 (±1) |
| B-local | 5 | one per conversation (5) | 3/3 | 118 (±2) | 1066 (±0) | 1.6 | 335 (±5) | 358 (±14) / 384 (±4) | 24 (±0) | 13 (±0) | 34 (±1) |
| B-local | 10 | single process (1) | 3/3 | 170 (±3) | 729 (±4) | 47.2 | 2644 (±734) | 2720 (±735) / 3134 (±612) | (one process) | 13 (±1) | (not recorded) |
| B-local | 10 | pool of 2 | 3/3 | 220 (±4) | 900 (±0) | 13.1 | 419 (±11) | 385 (±8) / 470 (±50) | 111 (±2) | 17 (±1) | 61 (±1) |
| B-local | 10 | pool of 4 | 3/3 | 212 (±4) | 1209 (±1) | 4.4 | 392 (±5) | 353 (±5) / 392 (±8) | 64 (±1) | 17 (±0) | 59 (±1) |
| B-local | 10 | one per conversation (10) | 3/3 | 214 (±4) | 2138 (±2) | 2.6 | 386 (±4) | 360 (±2) / 395 (±3) | 22 (±0) | 18 (±0) | 61 (±2) |
| B-local | 20 | single process (1) | 0/3 INVALID | | | | | | | | |
| B-local | 20 | pool of 2 | 0/3 INVALID | | | | | | | | |
| B-local | 20 | pool of 4 | 3/3 | 325 (±2) | 1803 (±2) | 27.2 | 533 (±17) | 413 (±4) / 559 (±4) | 82 (±0) | 24 (±0) | 89 (±1) |
| B-local | 20 | one per conversation (20) | 0/3 INVALID | | | | | | | | |
| A-provider | 5 | single process (1) | 3/3 | 19 (±1) | 242 (±15) | 1.0 | 427 (±1) | 181 (±1) / 204 (±4) | (one process) | 8 (±0) | (not recorded) |
| A-provider | 5 | pool of 2 | 3/3 | 24 (±2) | 428 (±36) | 1.0 | 421 (±3) | 187 (±5) / 201 (±1) | 14 (±1) | 10 (±1) | 13 (±2) |
| A-provider | 5 | pool of 4 | 3/3 | 30 (±1) | 722 (±10) | 1.0 | 424 (±2) | 188 (±3) / 206 (±2) | 10 (±0) | 9 (±0) | 10 (±2) |
| A-provider | 10 | single process (1) | 3/3 | 33 (±2) | 252 (±2) | 1.1 | 428 (±1) | 177 (±3) / 210 (±5) | (one process) | 11 (±0) | (not recorded) |
| A-provider | 10 | pool of 2 | 3/3 | 41 (±2) | 470 (±19) | 1.1 | 427 (±0) | 186 (±3) / 210 (±1) | 21 (±1) | 12 (±1) | 17 (±1) |
| A-provider | 10 | pool of 4 | 3/3 | 48 (±5) | 846 (±19) | 1.1 | 426 (±0) | 183 (±1) / 203 (±8) | 14 (±1) | 11 (±1) | 16 (±5) |
| A-provider | 20 | single process (1) | 3/3 | 63 (±1) | 287 (±4) | 3.6 | 430 (±0) | 187 (±1) / 206 (±3) | (one process) | 17 (±0) | (not recorded) |
| A-provider | 20 | pool of 2 | 3/3 | 70 (±2) | 500 (±6) | 1.8 | 428 (±1) | 188 (±2) / 207 (±2) | 35 (±1) | 18 (±1) | 24 (±0) |
| A-provider | 20 | pool of 4 | 3/3 | 77 (±2) | 942 (±14) | 1.1 | 427 (±0) | 181 (±1) / 207 (±5) | 20 (±1) | 17 (±1) | 23 (±2) |
| B-provider | 5 | single process (1) | 3/3 | 97 (±3) | 209 (±0) | 3.4 | 571 (±2) | 357 (±6) / 393 (±12) | (one process) | 12 (±1) | (not recorded) |
| B-provider | 5 | pool of 2 | 3/3 | 89 (±5) | 360 (±0) | 1.3 | 560 (±5) | 356 (±3) / 377 (±3) | 54 (±3) | 12 (±1) | 25 (±3) |
| B-provider | 5 | pool of 4 | 3/3 | 90 (±2) | 663 (±0) | 1.2 | 561 (±1) | 367 (±4) / 381 (±1) | 35 (±1) | 12 (±0) | 27 (±2) |
| B-provider | 5 | one per conversation (5) | 3/3 | 91 (±3) | 814 (±0) | 1.3 | 561 (±1) | 364 (±6) / 382 (±6) | 18 (±1) | 13 (±0) | 28 (±3) |
| B-provider | 10 | single process (1) | 3/3 | 133 (±1) | 267 (±0) | 33.5 | 1176 (±476) | 1011 (±420) / 1347 (±636) | (one process) | 14 (±0) | (not recorded) |
| B-provider | 10 | pool of 2 | 3/3 | 171 (±4) | 419 (±0) | 6.2 | 569 (±1) | 374 (±3) / 430 (±44) | 86 (±3) | 17 (±0) | 49 (±2) |
| B-provider | 10 | pool of 4 | 3/3 | 163 (±6) | 721 (±0) | 1.9 | 564 (±1) | 357 (±4) / 390 (±9) | 50 (±2) | 18 (±1) | 48 (±1) |
| B-provider | 10 | one per conversation (10) | 3/3 | 170 (±5) | 1628 (±1) | 2.0 | 563 (±0) | 358 (±5) / 385 (±11) | 17 (±0) | 18 (±0) | 49 (±1) |
| B-provider | 20 | single process (1) | 0/3 INVALID | | | | | | | | |
| B-provider | 20 | pool of 2 | 0/3 INVALID | | | | | | | | |
| B-provider | 20 | pool of 4 | 3/3 | 279 (±2) | 838 (±0) | 12.9 | 589 (±3) | 390 (±4) / 472 (±8) | 70 (±1) | 25 (±0) | 78 (±1) |
| B-provider | 20 | one per conversation (20) | 3/3 | 309 (±6) | 3259 (±1) | 5.8 | 570 (±1) | 375 (±5) / 426 (±7) | 16 (±0) | 23 (±0) | 85 (±2) |

INVALID cells (numbers shown for information only, never used above). Reasons are in the CSV `invalidReasons` column.

| Config | N | processes | runs | total CPU % | total RSS MB | worst process loop delay p95 ms | end of speech to turn p50 ms | talk-over stop p50 ms | timeouts / cycles | load generator loop delay p95 ms | box busy % of 4 cores | why INVALID |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B-local | 20 | single process (1) | 3 | 82 (±4) | 1335 (±1) | 66.6 | 1676 (±689) | 1299 (±0) | 395 / 428 | 1 (±0) | (not recorded) | 20 lane(s) with fewer than 4 completed cycles in the window; engine reports 0 lanes, expected 20; turn/reply timeouts 129/142 > 5%; turn/reply timeouts 133/142 > 5%; turn/reply timeouts 133/144 > 5% |
| B-local | 20 | pool of 2 | 3 | 250 (±1) | 1471 (±5) | 61.2 | 2813 (±375) | 761 (±419) | 129 / 414 | 2 (±0) | 69 (±0) | 1 lane(s) with fewer than 4 completed cycles in the window; 2 lane(s) with fewer than 4 completed cycles in the window; turn/reply timeouts 42/137 > 5%; turn/reply timeouts 43/138 > 5%; turn/reply timeouts 44/139 > 5% |
| B-local | 20 | one per conversation (20) | 3 | 347 (±5) | 4287 (±3) | 10.8 | 593 (±24) | 381 (±10) | 0 / 573 | 43 (±11) | 94 (±1) | load generator overloaded |
| B-provider | 20 | single process (1) | 3 | 67 (±7) | 398 (±1) | 53.1 | 1044 (±1205) | 736 (±200) | 405 / 438 | 1 (±0) | (not recorded) | 19 lane(s) with fewer than 4 completed cycles in the window; 20 lane(s) with fewer than 4 completed cycles in the window; engine reports 0 lanes, expected 20; engine reports 1 lanes, expected 20; turn/reply timeouts 132/144 > 5%; turn/reply timeouts 136/150 > 5%; turn/reply timeouts 137/144 > 5% |
| B-provider | 20 | pool of 2 | 3 | 219 (±1) | 542 (±2) | 45.3 | 3756 (±138) | 3016 (±164) | 89 / 411 | 1 (±0) | 61 (±0) | turn/reply timeouts 25/133 > 5%; turn/reply timeouts 31/138 > 5%; turn/reply timeouts 33/140 > 5% |
