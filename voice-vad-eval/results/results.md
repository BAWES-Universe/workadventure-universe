# Offline comparison: today's volume gate and Silero (Stage 1)

Clips: 7351 (3511 in the report half). Every number below is from the report half; settings were picked on the other half.

## Picked on the tune half

| pick | rule | newly missed (tune) | all missed (tune) | false stops/h on non-speech noise (tune) | p95 delay ms (tune) |
| --- | --- | --- | --- | --- | --- |
| strict (fewest new misses) | silero p>=0.50 for 64 ms | 9 | 38 | 3.5 | 504 |
| balanced (at most 0.5% new misses) | silero p>=0.50 for 64 ms | 9 | 38 | 3.5 | 504 |

## False stops on noise only (bot assumed speaking the whole time)

### nonspeech

| noise level dBFS | detector | hours | stops | stops per hour |
| --- | --- | --- | --- | --- |
| -45 | gate 100 ms | 0.59 | 137 | 233.5 |
| -45 | gate 200 ms | 0.59 | 110 | 187.5 |
| -45 | gate 300 ms | 0.59 | 79 | 134.6 |
| -45 | silero p>=0.50 for 64 ms | 0.59 | 3 | 5.1 |
| -35 | gate 100 ms | 0.59 | 102 | 173.8 |
| -35 | gate 200 ms | 0.59 | 100 | 170.4 |
| -35 | gate 300 ms | 0.59 | 96 | 163.6 |
| -35 | silero p>=0.50 for 64 ms | 0.59 | 7 | 11.9 |
| -25 | gate 100 ms | 0.59 | 76 | 129.5 |
| -25 | gate 200 ms | 0.59 | 76 | 129.5 |
| -25 | gate 300 ms | 0.59 | 74 | 126.1 |
| -25 | silero p>=0.50 for 64 ms | 0.59 | 5 | 8.5 |

### scene

| noise level dBFS | detector | hours | stops | stops per hour |
| --- | --- | --- | --- | --- |
| -45 | gate 100 ms | 0.12 | 31 | 265.7 |
| -45 | gate 200 ms | 0.12 | 23 | 197.1 |
| -45 | gate 300 ms | 0.12 | 18 | 154.3 |
| -45 | silero p>=0.50 for 64 ms | 0.12 | 0 | 0.0 |
| -35 | gate 100 ms | 0.12 | 8 | 68.6 |
| -35 | gate 200 ms | 0.12 | 8 | 68.6 |
| -35 | gate 300 ms | 0.12 | 8 | 68.6 |
| -35 | silero p>=0.50 for 64 ms | 0.12 | 0 | 0.0 |
| -25 | gate 100 ms | 0.12 | 8 | 68.6 |
| -25 | gate 200 ms | 0.12 | 8 | 68.6 |
| -25 | gate 300 ms | 0.12 | 8 | 68.6 |
| -25 | silero p>=0.50 for 64 ms | 0.12 | 1 | 8.6 |

### speechlike

| noise level dBFS | detector | hours | stops | stops per hour |
| --- | --- | --- | --- | --- |
| -45 | gate 100 ms | 0.41 | 131 | 318.6 |
| -45 | gate 200 ms | 0.41 | 97 | 235.9 |
| -45 | gate 300 ms | 0.41 | 76 | 184.8 |
| -45 | silero p>=0.50 for 64 ms | 0.41 | 34 | 82.7 |
| -35 | gate 100 ms | 0.41 | 40 | 97.3 |
| -35 | gate 200 ms | 0.41 | 40 | 97.3 |
| -35 | gate 300 ms | 0.41 | 40 | 97.3 |
| -35 | silero p>=0.50 for 64 ms | 0.41 | 30 | 73.0 |
| -25 | gate 100 ms | 0.41 | 33 | 80.3 |
| -25 | gate 200 ms | 0.41 | 33 | 80.3 |
| -25 | gate 300 ms | 0.41 | 33 | 80.3 |
| -25 | silero p>=0.50 for 64 ms | 0.41 | 34 | 82.7 |

### Share of noise-only time the worker holds "someone is speaking"

Today a spoken reply waits while this is held, and one that has started is cut. For Silero: the share of 32 ms windows at or above the rule's probability.

| noise | level dBFS | today's gate | silero p>=0.50 |
| --- | --- | --- | --- |
| nonspeech | -45 | 45% | 0.1% |
| nonspeech | -35 | 96% | 0.2% |
| nonspeech | -25 | 98% | 0.2% |
| scene | -45 | 51% | 0.0% |
| scene | -35 | 96% | 0.0% |
| scene | -25 | 99% | 0.0% |
| speechlike | -45 | 60% | 39.4% |
| speechlike | -35 | 98% | 48.0% |
| speechlike | -25 | 99% | 52.5% |

### Non-speech noise by class (all three levels together)

| class | hours | gate 100 ms (stops/h) | gate 200 ms (stops/h) | gate 300 ms (stops/h) | silero p>=0.50 for 64 ms (stops/h) |
| --- | --- | --- | --- | --- | --- |
| AirConditioner | 0.37 | 92.7 | 79.0 | 76.3 | 10.9 |
| Car | 0.05 | 160.0 | 120.0 | 120.0 | 0.0 |
| CopyMachine | 0.19 | 156.8 | 151.6 | 125.5 | 0.0 |
| Field | 0.05 | 100.0 | 60.0 | 60.0 | 0.0 |
| Munching | 0.19 | 224.6 | 214.1 | 188.0 | 41.8 |
| ShuttingDoor | 0.23 | 453.0 | 417.8 | 347.4 | 0.0 |
| SqueakyChair | 0.14 | 166.2 | 166.2 | 130.1 | 14.5 |
| Typing | 0.17 | 92.7 | 92.7 | 92.7 | 0.0 |
| VacuumCleaner | 0.13 | 146.3 | 130.9 | 130.9 | 0.0 |
| WasherDryer | 0.14 | 161.5 | 126.4 | 105.4 | 0.0 |
| battery_charger | 0.05 | 60.0 | 60.0 | 40.0 | 0.0 |
| cooking | 0.05 | 160.0 | 120.0 | 100.0 | 20.0 |

### Three 100 ms bursts with pauses (share of clips that stop the bot)

| burst level dBFS | clips | gate 100 ms | gate 200 ms | gate 300 ms | silero p>=0.50 for 64 ms |
| --- | --- | --- | --- | --- | --- |
| -30 | 10 | 10/10 | 10/10 | 10/10 | 0/10 |
| -20 | 10 | 10/10 | 10/10 | 10/10 | 0/10 |

## Real interruptions (speech)

Fired for the person = the detector fires after their clip begins and at most 0.6 s after their last sound. Delay = first sound (by energy) to firing, offline, with no network or playout. In the two noise conditions the background starts 1 s before the person: a detector that has already fired on it has already stopped the bot, and does not fire again for the person.

### en-command

| condition | detector | clips | already fired on the background | no new firing for the person | of those, caught by today's gate | fired for the person | delay p50 ms | p95 | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S20 | gate 100 ms | 294 | 0 | 0 | 0 | 100.0% | 100 | 190 | 760 |
| S20 | gate 200 ms | 294 | 0 | 2 | 2 | 99.3% | 200 | 380 | 860 |
| S20 | gate 300 ms | 294 | 0 | 36 | 36 | 87.8% | 300 | 540 | 960 |
| S20 | silero p>=0.50 for 64 ms | 294 | 0 | 2 | 2 | 99.3% | 78 | 600 | 920 |
| S30 | gate 100 ms | 294 | 0 | 1 | 0 | 99.7% | 120 | 630 | 820 |
| S30 | gate 200 ms | 294 | 0 | 24 | 23 | 91.8% | 220 | 740 | 940 |
| S30 | gate 300 ms | 294 | 0 | 126 | 125 | 57.1% | 330 | 860 | 1000 |
| S30 | silero p>=0.50 for 64 ms | 294 | 0 | 3 | 3 | 99.0% | 86 | 600 | 824 |
| S40 | gate 100 ms | 294 | 0 | 7 | 0 | 97.6% | 200 | 720 | 960 |
| S40 | gate 200 ms | 294 | 0 | 160 | 153 | 45.6% | 400 | 860 | 920 |
| S40 | gate 300 ms | 294 | 0 | 255 | 248 | 13.3% | 600 | 960 | 960 |
| S40 | silero p>=0.50 for 64 ms | 294 | 0 | 8 | 8 | 97.3% | 116 | 696 | 888 |
| N10 | gate 100 ms | 294 | 252 | 252 | 0 | 14.3% | 90 | 260 | 760 |
| N10 | gate 200 ms | 294 | 232 | 233 | 1 | 20.7% | 70 | 330 | 900 |
| N10 | gate 300 ms | 294 | 213 | 215 | 2 | 26.9% | 140 | 510 | 1220 |
| N10 | silero p>=0.50 for 64 ms | 294 | 3 | 6 | 1 | 98.0% | 106 | 696 | 920 |
| N5 | gate 100 ms | 294 | 274 | 274 | 0 | 6.8% | 100 | 590 | 590 |
| N5 | gate 200 ms | 294 | 257 | 257 | 0 | 12.6% | 80 | 690 | 880 |
| N5 | gate 300 ms | 294 | 248 | 249 | 1 | 15.3% | 150 | 380 | 980 |
| N5 | silero p>=0.50 for 64 ms | 294 | 7 | 14 | 0 | 95.2% | 134 | 664 | 856 |

### ar-command

| condition | detector | clips | already fired on the background | no new firing for the person | of those, caught by today's gate | fired for the person | delay p50 ms | p95 | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S20 | gate 100 ms | 281 | 0 | 0 | 0 | 100.0% | 100 | 100 | 200 |
| S20 | gate 200 ms | 281 | 0 | 0 | 0 | 100.0% | 200 | 210 | 360 |
| S20 | gate 300 ms | 281 | 0 | 7 | 7 | 97.5% | 300 | 440 | 530 |
| S20 | silero p>=0.50 for 64 ms | 281 | 0 | 0 | 0 | 100.0% | 68 | 106 | 482 |
| S30 | gate 100 ms | 281 | 0 | 0 | 0 | 100.0% | 110 | 140 | 400 |
| S30 | gate 200 ms | 281 | 0 | 0 | 0 | 100.0% | 210 | 370 | 500 |
| S30 | gate 300 ms | 281 | 0 | 38 | 38 | 86.5% | 310 | 500 | 630 |
| S30 | silero p>=0.50 for 64 ms | 281 | 0 | 0 | 0 | 100.0% | 74 | 106 | 360 |
| S40 | gate 100 ms | 281 | 0 | 0 | 0 | 100.0% | 160 | 320 | 400 |
| S40 | gate 200 ms | 281 | 0 | 84 | 84 | 70.1% | 290 | 460 | 500 |
| S40 | gate 300 ms | 281 | 0 | 225 | 225 | 19.9% | 430 | 540 | 980 |
| S40 | silero p>=0.50 for 64 ms | 281 | 0 | 0 | 0 | 100.0% | 84 | 124 | 450 |
| N10 | gate 100 ms | 281 | 238 | 238 | 0 | 15.3% | 30 | 100 | 110 |
| N10 | gate 200 ms | 281 | 216 | 216 | 0 | 23.1% | 70 | 200 | 380 |
| N10 | gate 300 ms | 281 | 198 | 199 | 1 | 29.2% | 120 | 300 | 390 |
| N10 | silero p>=0.50 for 64 ms | 281 | 5 | 5 | 1 | 98.2% | 72 | 120 | 360 |
| N5 | gate 100 ms | 281 | 257 | 257 | 0 | 8.5% | 80 | 110 | 120 |
| N5 | gate 200 ms | 281 | 245 | 245 | 0 | 12.8% | 140 | 300 | 350 |
| N5 | gate 300 ms | 281 | 231 | 231 | 0 | 17.8% | 150 | 400 | 450 |
| N5 | silero p>=0.50 for 64 ms | 281 | 5 | 5 | 0 | 98.2% | 82 | 204 | 408 |

### en-sentence

| condition | detector | clips | already fired on the background | no new firing for the person | of those, caught by today's gate | fired for the person | delay p50 ms | p95 | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S20 | gate 100 ms | 65 | 0 | 0 | 0 | 100.0% | 90 | 130 | 330 |
| S20 | gate 200 ms | 65 | 0 | 0 | 0 | 100.0% | 200 | 260 | 430 |
| S20 | gate 300 ms | 65 | 0 | 0 | 0 | 100.0% | 300 | 360 | 570 |
| S20 | silero p>=0.50 for 64 ms | 65 | 0 | 0 | 0 | 100.0% | 72 | 174 | 382 |
| S30 | gate 100 ms | 65 | 0 | 0 | 0 | 100.0% | 110 | 230 | 370 |
| S30 | gate 200 ms | 65 | 0 | 0 | 0 | 100.0% | 220 | 370 | 490 |
| S30 | gate 300 ms | 65 | 0 | 0 | 0 | 100.0% | 350 | 590 | 790 |
| S30 | silero p>=0.50 for 64 ms | 65 | 0 | 0 | 0 | 100.0% | 78 | 140 | 382 |
| S40 | gate 100 ms | 65 | 0 | 0 | 0 | 100.0% | 180 | 310 | 810 |
| S40 | gate 200 ms | 65 | 0 | 0 | 0 | 100.0% | 360 | 640 | 910 |
| S40 | gate 300 ms | 65 | 0 | 0 | 0 | 100.0% | 600 | 1290 | 1690 |
| S40 | silero p>=0.50 for 64 ms | 65 | 0 | 0 | 0 | 100.0% | 86 | 146 | 382 |
| N10 | gate 100 ms | 65 | 54 | 54 | 0 | 16.9% | 70 | 220 | 220 |
| N10 | gate 200 ms | 65 | 51 | 51 | 0 | 21.5% | 170 | 320 | 320 |
| N10 | gate 300 ms | 65 | 47 | 47 | 0 | 27.7% | 230 | 590 | 590 |
| N10 | silero p>=0.50 for 64 ms | 65 | 1 | 1 | 0 | 98.5% | 82 | 140 | 382 |
| N5 | gate 100 ms | 65 | 55 | 55 | 0 | 15.4% | 90 | 190 | 190 |
| N5 | gate 200 ms | 65 | 47 | 47 | 0 | 27.7% | 150 | 290 | 290 |
| N5 | gate 300 ms | 65 | 45 | 45 | 0 | 30.8% | 220 | 390 | 390 |
| N5 | silero p>=0.50 for 64 ms | 65 | 0 | 0 | 0 | 100.0% | 82 | 172 | 446 |

### Short commands by word (all conditions)

| word | clips | gate 100 ms missed | gate 200 ms missed | gate 300 ms missed | silero p>=0.50 for 64 ms missed |
| --- | --- | --- | --- | --- | --- |
| ar-command/cancel | 210 | 71 | 72 | 88 | 1 |
| ar-command/close | 250 | 91 | 91 | 108 | 3 |
| ar-command/no | 235 | 85 | 109 | 139 | 1 |
| ar-command/ok | 255 | 87 | 90 | 121 | 2 |
| ar-command/stop | 215 | 75 | 96 | 123 | 0 |
| ar-command/yes | 240 | 86 | 87 | 121 | 3 |
| en-command/go | 365 | 124 | 158 | 223 | 6 |
| en-command/no | 330 | 118 | 133 | 170 | 4 |
| en-command/stop | 390 | 148 | 209 | 266 | 20 |
| en-command/yes | 385 | 144 | 176 | 222 | 3 |

## Speech-to-text opened by noise today (report half, non-speech noise)

| noise level dBFS | hours | streams opened | per hour | share of the noise sent to speech-to-text |
| --- | --- | --- | --- | --- |
| -45 | 0.59 | 229 | 390.3 | 61% |
| -35 | 0.59 | 106 | 180.6 | 98% |
| -25 | 0.59 | 76 | 129.5 | 99% |

## Every Silero setting on the report half

| rule | newly missed | all missed | false stops/h non-speech | false stops/h speech-like | delay p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- |
| silero p>=0.50 for 32 ms | 14 | 53 | 10.8 | 85.1 | 48 | 486 |
| silero p>=0.50 for 64 ms | 15 | 44 | 8.5 | 79.4 | 80 | 536 |
| silero p>=0.50 for 96 ms | 15 | 43 | 8.0 | 77.0 | 112 | 568 |
| silero p>=0.50 for 160 ms | 20 | 44 | 6.8 | 74.6 | 178 | 632 |
| silero p>=0.50 for 256 ms | 36 | 74 | 5.1 | 73.8 | 274 | 728 |
| silero p>=0.60 for 32 ms | 15 | 48 | 8.0 | 79.4 | 52 | 504 |
| silero p>=0.60 for 64 ms | 18 | 46 | 6.2 | 76.2 | 84 | 536 |
| silero p>=0.60 for 96 ms | 19 | 46 | 6.2 | 72.1 | 116 | 568 |
| silero p>=0.60 for 160 ms | 24 | 55 | 5.1 | 69.7 | 180 | 632 |
| silero p>=0.60 for 256 ms | 48 | 94 | 5.1 | 69.7 | 276 | 728 |
| silero p>=0.70 for 32 ms | 19 | 52 | 6.8 | 73.8 | 56 | 504 |
| silero p>=0.70 for 64 ms | 22 | 54 | 5.7 | 69.7 | 88 | 546 |
| silero p>=0.70 for 96 ms | 24 | 56 | 5.1 | 69.7 | 120 | 582 |
| silero p>=0.70 for 160 ms | 35 | 68 | 5.1 | 68.1 | 186 | 664 |
| silero p>=0.70 for 256 ms | 71 | 128 | 4.5 | 65.7 | 282 | 728 |
| silero p>=0.80 for 32 ms | 25 | 54 | 5.1 | 68.1 | 66 | 536 |
| silero p>=0.80 for 64 ms | 28 | 60 | 5.1 | 66.5 | 98 | 568 |
| silero p>=0.80 for 96 ms | 34 | 69 | 4.0 | 65.7 | 130 | 600 |
| silero p>=0.80 for 160 ms | 50 | 95 | 4.0 | 64.9 | 194 | 664 |
| silero p>=0.80 for 256 ms | 119 | 200 | 4.0 | 61.6 | 290 | 728 |
| silero p>=0.90 for 32 ms | 43 | 81 | 4.0 | 62.4 | 80 | 536 |
| silero p>=0.90 for 64 ms | 54 | 99 | 4.0 | 58.4 | 114 | 568 |
| silero p>=0.90 for 96 ms | 66 | 119 | 4.0 | 56.7 | 146 | 600 |
| silero p>=0.90 for 160 ms | 94 | 163 | 4.0 | 56.7 | 210 | 664 |
| silero p>=0.90 for 256 ms | 254 | 393 | 3.4 | 55.9 | 304 | 728 |

| today's gate | newly missed | all missed | false stops/h non-speech | false stops/h speech-like | delay p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- |
| gate 100 ms | 0 | 1138 | 178.9 | 165.4 | 110 | 400 |
| gate 200 ms | 263 | 1319 | 162.5 | 137.8 | 210 | 550 |
| gate 300 ms | 683 | 1673 | 141.5 | 120.8 | 300 | 660 |
