# Offline comparison: today's volume gate and Silero (Stage 1, corrected)

Run check: 7351 clips from 3 finished shards; every clip of the fixture list is present exactly once. Raw results sha256 `5f45e6def0039fe9`. Probabilities are kept at full precision; rounding them to 8 bits (as the first run did) changes the frozen rule's firings in 0 of 7351 clips.

Rule under test: **silero p>=0.50 for 64 ms** (frozen from the first run). Baseline: the worker's own Recognition class with a **specified fake provider** (waits 1.8 s of quiet, no end-of-speech events), not every deployed provider.

## What the test set is made of (report half)

Variants of one recording are not independent: the same recording appears at several levels or conditions. Rates below are measured on this set only; they are not field rates and carry no confidence interval for production.

| part | distinct recordings | distinct speakers | unique duration | clips after variants | variants |
| --- | --- | --- | --- | --- | --- |
| noise: nonspeech | 59 | n/a | 35.2 min | 177 | 105.6 min (3 levels) |
| noise: scene | 7 | n/a | 7.0 min | 21 | 21.0 min (3 levels) |
| noise: speechlike | 31 | n/a | 24.7 min | 93 | 74.0 min (3 levels) |
| speech: en-command | 294 | 230 | 2.8 min of speech | 1470 | 5 conditions |
| speech: ar-command | 281 | 14 | 2.3 min of speech | 1405 | 5 conditions |
| speech: en-sentence | 65 | not known | 4.2 min of speech | 325 | 5 conditions |

Speakers of short commands found on both halves: 0 (the file name starts with the contributor id in both datasets). Sentences are split by file only; their speakers are not known, so "unseen speaker" is NOT claimed for them. The background mixed under speech comes from one shared pool on both halves.

## Detector firings on noise only

The bot is assumed to be speaking the whole time, so each firing would be one stop. Playback itself was not exercised. Groups come from the source's class name.

### nonspeech

| noise level dBFS | detector | distinct recordings | hours incl. variants | firings | per hour | recordings with a firing |
| --- | --- | --- | --- | --- | --- | --- |
| -45 | gate 100 ms | 59 | 0.59 | 137 | 233.5 | 50 |
| -45 | gate 200 ms | 59 | 0.59 | 110 | 187.5 | 44 |
| -45 | gate 300 ms | 59 | 0.59 | 79 | 134.6 | 39 |
| -45 | silero p>=0.50 for 64 ms | 59 | 0.59 | 3 | 5.1 | 2 |
| -35 | gate 100 ms | 59 | 0.59 | 102 | 173.8 | 59 |
| -35 | gate 200 ms | 59 | 0.59 | 100 | 170.4 | 59 |
| -35 | gate 300 ms | 59 | 0.59 | 96 | 163.6 | 59 |
| -35 | silero p>=0.50 for 64 ms | 59 | 0.59 | 7 | 11.9 | 5 |
| -25 | gate 100 ms | 59 | 0.59 | 76 | 129.5 | 59 |
| -25 | gate 200 ms | 59 | 0.59 | 76 | 129.5 | 59 |
| -25 | gate 300 ms | 59 | 0.59 | 74 | 126.1 | 59 |
| -25 | silero p>=0.50 for 64 ms | 59 | 0.59 | 5 | 8.5 | 4 |
| all | gate 100 ms | 59 | 1.76 | 315 | 178.9 | 59 |
| all | gate 200 ms | 59 | 1.76 | 286 | 162.5 | 59 |
| all | gate 300 ms | 59 | 1.76 | 249 | 141.5 | 59 |
| all | silero p>=0.50 for 64 ms | 59 | 1.76 | 15 | 8.5 | 6 |

### scene

| noise level dBFS | detector | distinct recordings | hours incl. variants | firings | per hour | recordings with a firing |
| --- | --- | --- | --- | --- | --- | --- |
| -45 | gate 100 ms | 7 | 0.12 | 31 | 265.7 | 7 |
| -45 | gate 200 ms | 7 | 0.12 | 23 | 197.1 | 7 |
| -45 | gate 300 ms | 7 | 0.12 | 18 | 154.3 | 6 |
| -45 | silero p>=0.50 for 64 ms | 7 | 0.12 | 0 | 0.0 | 0 |
| -35 | gate 100 ms | 7 | 0.12 | 8 | 68.6 | 7 |
| -35 | gate 200 ms | 7 | 0.12 | 8 | 68.6 | 7 |
| -35 | gate 300 ms | 7 | 0.12 | 8 | 68.6 | 7 |
| -35 | silero p>=0.50 for 64 ms | 7 | 0.12 | 0 | 0.0 | 0 |
| -25 | gate 100 ms | 7 | 0.12 | 8 | 68.6 | 7 |
| -25 | gate 200 ms | 7 | 0.12 | 8 | 68.6 | 7 |
| -25 | gate 300 ms | 7 | 0.12 | 8 | 68.6 | 7 |
| -25 | silero p>=0.50 for 64 ms | 7 | 0.12 | 1 | 8.6 | 1 |
| all | gate 100 ms | 7 | 0.35 | 47 | 134.3 | 7 |
| all | gate 200 ms | 7 | 0.35 | 39 | 111.4 | 7 |
| all | gate 300 ms | 7 | 0.35 | 34 | 97.1 | 7 |
| all | silero p>=0.50 for 64 ms | 7 | 0.35 | 1 | 2.9 | 1 |

### speechlike

| noise level dBFS | detector | distinct recordings | hours incl. variants | firings | per hour | recordings with a firing |
| --- | --- | --- | --- | --- | --- | --- |
| -45 | gate 100 ms | 31 | 0.41 | 131 | 318.6 | 31 |
| -45 | gate 200 ms | 31 | 0.41 | 97 | 235.9 | 31 |
| -45 | gate 300 ms | 31 | 0.41 | 76 | 184.8 | 31 |
| -45 | silero p>=0.50 for 64 ms | 31 | 0.41 | 34 | 82.7 | 22 |
| -35 | gate 100 ms | 31 | 0.41 | 40 | 97.3 | 31 |
| -35 | gate 200 ms | 31 | 0.41 | 40 | 97.3 | 31 |
| -35 | gate 300 ms | 31 | 0.41 | 40 | 97.3 | 31 |
| -35 | silero p>=0.50 for 64 ms | 31 | 0.41 | 30 | 73.0 | 23 |
| -25 | gate 100 ms | 31 | 0.41 | 33 | 80.3 | 31 |
| -25 | gate 200 ms | 31 | 0.41 | 33 | 80.3 | 31 |
| -25 | gate 300 ms | 31 | 0.41 | 33 | 80.3 | 31 |
| -25 | silero p>=0.50 for 64 ms | 31 | 0.41 | 34 | 82.7 | 26 |
| all | gate 100 ms | 31 | 1.23 | 204 | 165.4 | 31 |
| all | gate 200 ms | 31 | 1.23 | 170 | 137.8 | 31 |
| all | gate 300 ms | 31 | 1.23 | 149 | 120.8 | 31 |
| all | silero p>=0.50 for 64 ms | 31 | 1.23 | 98 | 79.4 | 26 |

### Time a reply would be held, through the same lifecycle

Both columns go through the worker's unchanged Recognition class and the same two fake providers; "held" runs from user.speech_started to the end of that stretch. For Silero only the per-frame verdict is swapped (a 20 ms frame counts as speech when the last complete 32 ms window is at or above 0.50); the 100 ms total, the 1.8 s quiet and the events are today's code. "Provider hears words" is the worst case: a provider that returns a word for every 300 ms of whatever it is sent, so every opened stream announces speech. The last column is only detector activity (share of windows at or above 0.50), not hold time.

| noise | level dBFS | held: gate, silent provider | held: Silero verdict, silent provider | held: gate, provider hears words | held: Silero verdict, provider hears words | Silero windows at or above 0.50 |
| --- | --- | --- | --- | --- | --- | --- |
| nonspeech | -45 | 45.3% | 0.3% | 57.5% | 0.4% | 0.1% |
| nonspeech | -35 | 95.6% | 0.6% | 96.5% | 0.7% | 0.2% |
| nonspeech | -25 | 98.1% | 0.5% | 98.4% | 0.8% | 0.2% |
| scene | -45 | 51.5% | 0.0% | 71.4% | 0.0% | 0.0% |
| scene | -35 | 95.8% | 0.0% | 96.2% | 0.4% | 0.0% |
| scene | -25 | 99.3% | 0.0% | 99.7% | 0.4% | 0.0% |
| speechlike | -45 | 59.7% | 53.4% | 73.9% | 54.0% | 39.4% |
| speechlike | -35 | 98.1% | 59.7% | 98.3% | 60.2% | 48.0% |
| speechlike | -25 | 99.3% | 66.4% | 99.3% | 67.1% | 52.5% |

### Non-speech noise by class (all three levels together)

| class | recordings | hours incl. variants | gate 100 ms (firings, per hour) | gate 200 ms (firings, per hour) | gate 300 ms (firings, per hour) | silero p>=0.50 for 64 ms (firings, per hour) |
| --- | --- | --- | --- | --- | --- | --- |
| AirConditioner | 12 | 0.37 | 34, 92.7 | 29, 79.0 | 28, 76.3 | 4, 10.9 |
| Car | 1 | 0.05 | 8, 160.0 | 6, 120.0 | 6, 120.0 | 0, 0.0 |
| CopyMachine | 6 | 0.19 | 30, 156.8 | 29, 151.6 | 24, 125.5 | 0, 0.0 |
| Field | 1 | 0.05 | 5, 100.0 | 3, 60.0 | 3, 60.0 | 0, 0.0 |
| Munching | 8 | 0.19 | 43, 224.6 | 41, 214.1 | 36, 188.0 | 8, 41.8 |
| ShuttingDoor | 10 | 0.23 | 103, 453.0 | 95, 417.8 | 79, 347.4 | 0, 0.0 |
| SqueakyChair | 6 | 0.14 | 23, 166.2 | 23, 166.2 | 18, 130.1 | 2, 14.5 |
| Typing | 5 | 0.17 | 16, 92.7 | 16, 92.7 | 16, 92.7 | 0, 0.0 |
| VacuumCleaner | 4 | 0.13 | 19, 146.3 | 17, 130.9 | 17, 130.9 | 0, 0.0 |
| WasherDryer | 4 | 0.14 | 23, 161.5 | 18, 126.4 | 15, 105.4 | 0, 0.0 |
| battery_charger | 1 | 0.05 | 3, 60.0 | 3, 60.0 | 2, 40.0 | 0, 0.0 |
| cooking | 1 | 0.05 | 8, 160.0 | 6, 120.0 | 5, 100.0 | 1, 20.0 |

### Three 100 ms bursts with pauses (synthetic; share of clips with a firing)

| burst level dBFS | clips | gate 100 ms | gate 200 ms | gate 300 ms | silero p>=0.50 for 64 ms |
| --- | --- | --- | --- | --- | --- |
| -30 | 10 | 10/10 | 10/10 | 10/10 | 0/10 |
| -20 | 10 | 10/10 | 10/10 | 10/10 | 0/10 |

## Speech: three outcomes

VALID / EARLY / NONE as defined in scoring.ts and RESULTS.md. "Fired on background" = fired before the person's recording begins; in the two noise conditions the background starts 1 s before the person, and a detector that has fired on it does not fire again for the person. Delay = estimated onset to the VALID firing, offline, no network or playout, not clamped (negative = fired on a soft first sound).

### en-command

| condition | detector | clips | fired on background | VALID | EARLY only | NONE | VALID share | delay p50 ms | p95 | max | VALID within 400 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S20 | gate 100 ms | 294 | 0 | 294 | 0 | 0 | 100.0% | 100 | 190 | 760 | 99.0% |
| S20 | gate 200 ms | 294 | 0 | 292 | 0 | 2 | 99.3% | 200 | 380 | 860 | 95.2% |
| S20 | gate 300 ms | 294 | 0 | 258 | 0 | 36 | 87.8% | 300 | 540 | 960 | 88.4% |
| S20 | silero p>=0.50 for 64 ms | 294 | 0 | 290 | 2 | 2 | 98.6% | 78 | 600 | 920 | 83.1% |
| S30 | gate 100 ms | 294 | 0 | 293 | 0 | 1 | 99.7% | 120 | 630 | 820 | 89.1% |
| S30 | gate 200 ms | 294 | 0 | 270 | 0 | 24 | 91.8% | 220 | 740 | 940 | 83.0% |
| S30 | gate 300 ms | 294 | 0 | 168 | 0 | 126 | 57.1% | 330 | 860 | 1000 | 69.6% |
| S30 | silero p>=0.50 for 64 ms | 294 | 0 | 291 | 0 | 3 | 99.0% | 86 | 600 | 824 | 82.5% |
| S40 | gate 100 ms | 294 | 0 | 287 | 0 | 7 | 97.6% | 200 | 720 | 960 | 79.4% |
| S40 | gate 200 ms | 294 | 0 | 134 | 0 | 160 | 45.6% | 400 | 860 | 920 | 51.5% |
| S40 | gate 300 ms | 294 | 0 | 39 | 0 | 255 | 13.3% | 600 | 960 | 960 | 15.4% |
| S40 | silero p>=0.50 for 64 ms | 294 | 0 | 286 | 0 | 8 | 97.3% | 116 | 696 | 888 | 80.8% |
| N10 | gate 100 ms | 294 | 254 | 33 | 7 | 254 | 11.2% | 100 | 580 | 760 | 93.9% |
| N10 | gate 200 ms | 294 | 232 | 54 | 7 | 233 | 18.4% | 100 | 360 | 900 | 96.3% |
| N10 | gate 300 ms | 294 | 214 | 71 | 7 | 216 | 24.1% | 180 | 510 | 1220 | 90.1% |
| N10 | silero p>=0.50 for 64 ms | 294 | 3 | 287 | 1 | 6 | 97.6% | 106 | 696 | 920 | 81.5% |
| N5 | gate 100 ms | 294 | 274 | 14 | 6 | 274 | 4.8% | 100 | 590 | 590 | 92.9% |
| N5 | gate 200 ms | 294 | 258 | 33 | 3 | 258 | 11.2% | 100 | 690 | 880 | 93.9% |
| N5 | gate 300 ms | 294 | 251 | 39 | 3 | 252 | 13.3% | 180 | 580 | 980 | 94.9% |
| N5 | silero p>=0.50 for 64 ms | 294 | 7 | 279 | 1 | 14 | 94.9% | 134 | 664 | 856 | 80.6% |

### ar-command

| condition | detector | clips | fired on background | VALID | EARLY only | NONE | VALID share | delay p50 ms | p95 | max | VALID within 400 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S20 | gate 100 ms | 281 | 0 | 281 | 0 | 0 | 100.0% | 100 | 100 | 200 | 100.0% |
| S20 | gate 200 ms | 281 | 0 | 281 | 0 | 0 | 100.0% | 200 | 210 | 360 | 100.0% |
| S20 | gate 300 ms | 281 | 0 | 274 | 0 | 7 | 97.5% | 300 | 440 | 530 | 89.4% |
| S20 | silero p>=0.50 for 64 ms | 281 | 0 | 281 | 0 | 0 | 100.0% | 68 | 106 | 482 | 99.6% |
| S30 | gate 100 ms | 281 | 0 | 281 | 0 | 0 | 100.0% | 110 | 140 | 400 | 100.0% |
| S30 | gate 200 ms | 281 | 0 | 281 | 0 | 0 | 100.0% | 210 | 370 | 500 | 97.5% |
| S30 | gate 300 ms | 281 | 0 | 243 | 0 | 38 | 86.5% | 310 | 500 | 630 | 82.7% |
| S30 | silero p>=0.50 for 64 ms | 281 | 0 | 281 | 0 | 0 | 100.0% | 74 | 106 | 360 | 100.0% |
| S40 | gate 100 ms | 281 | 0 | 281 | 0 | 0 | 100.0% | 160 | 320 | 400 | 100.0% |
| S40 | gate 200 ms | 281 | 0 | 197 | 0 | 84 | 70.1% | 290 | 460 | 500 | 84.3% |
| S40 | gate 300 ms | 281 | 0 | 56 | 0 | 225 | 19.9% | 430 | 540 | 980 | 41.1% |
| S40 | silero p>=0.50 for 64 ms | 281 | 0 | 281 | 0 | 0 | 100.0% | 84 | 124 | 450 | 99.6% |
| N10 | gate 100 ms | 281 | 238 | 35 | 8 | 238 | 12.5% | 50 | 110 | 110 | 100.0% |
| N10 | gate 200 ms | 281 | 219 | 60 | 2 | 219 | 21.4% | 80 | 210 | 380 | 100.0% |
| N10 | gate 300 ms | 281 | 199 | 78 | 3 | 200 | 27.8% | 140 | 310 | 390 | 100.0% |
| N10 | silero p>=0.50 for 64 ms | 281 | 5 | 276 | 0 | 5 | 98.2% | 72 | 120 | 360 | 100.0% |
| N5 | gate 100 ms | 281 | 259 | 22 | 0 | 259 | 7.8% | 90 | 110 | 120 | 100.0% |
| N5 | gate 200 ms | 281 | 246 | 34 | 1 | 246 | 12.1% | 140 | 300 | 350 | 100.0% |
| N5 | gate 300 ms | 281 | 233 | 47 | 1 | 233 | 16.7% | 160 | 400 | 450 | 93.6% |
| N5 | silero p>=0.50 for 64 ms | 281 | 5 | 275 | 1 | 5 | 97.9% | 82 | 204 | 408 | 99.6% |

### en-sentence

| condition | detector | clips | fired on background | VALID | EARLY only | NONE | VALID share | delay p50 ms | p95 | max | VALID within 400 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S20 | gate 100 ms | 65 | 0 | 65 | 0 | 0 | 100.0% | 90 | 130 | 330 | 100.0% |
| S20 | gate 200 ms | 65 | 0 | 65 | 0 | 0 | 100.0% | 200 | 260 | 430 | 98.5% |
| S20 | gate 300 ms | 65 | 0 | 65 | 0 | 0 | 100.0% | 300 | 360 | 570 | 95.4% |
| S20 | silero p>=0.50 for 64 ms | 65 | 0 | 65 | 0 | 0 | 100.0% | 72 | 174 | 382 | 100.0% |
| S30 | gate 100 ms | 65 | 0 | 65 | 0 | 0 | 100.0% | 110 | 230 | 370 | 100.0% |
| S30 | gate 200 ms | 65 | 0 | 65 | 0 | 0 | 100.0% | 220 | 370 | 490 | 96.9% |
| S30 | gate 300 ms | 65 | 0 | 65 | 0 | 0 | 100.0% | 350 | 590 | 790 | 69.2% |
| S30 | silero p>=0.50 for 64 ms | 65 | 0 | 65 | 0 | 0 | 100.0% | 78 | 140 | 382 | 100.0% |
| S40 | gate 100 ms | 65 | 0 | 65 | 0 | 0 | 100.0% | 180 | 310 | 810 | 98.5% |
| S40 | gate 200 ms | 65 | 0 | 65 | 0 | 0 | 100.0% | 360 | 640 | 910 | 53.8% |
| S40 | gate 300 ms | 65 | 0 | 65 | 0 | 0 | 100.0% | 600 | 1290 | 1690 | 7.7% |
| S40 | silero p>=0.50 for 64 ms | 65 | 0 | 65 | 0 | 0 | 100.0% | 86 | 146 | 382 | 100.0% |
| N10 | gate 100 ms | 65 | 55 | 10 | 0 | 55 | 15.4% | 90 | 220 | 220 | 100.0% |
| N10 | gate 200 ms | 65 | 52 | 13 | 0 | 52 | 20.0% | 170 | 320 | 320 | 100.0% |
| N10 | gate 300 ms | 65 | 47 | 18 | 0 | 47 | 27.7% | 230 | 590 | 590 | 88.9% |
| N10 | silero p>=0.50 for 64 ms | 65 | 2 | 63 | 0 | 2 | 96.9% | 82 | 140 | 382 | 100.0% |
| N5 | gate 100 ms | 65 | 55 | 10 | 0 | 55 | 15.4% | 90 | 190 | 190 | 100.0% |
| N5 | gate 200 ms | 65 | 47 | 18 | 0 | 47 | 27.7% | 150 | 290 | 290 | 100.0% |
| N5 | gate 300 ms | 65 | 45 | 20 | 0 | 45 | 30.8% | 220 | 390 | 390 | 100.0% |
| N5 | silero p>=0.50 for 64 ms | 65 | 0 | 65 | 0 | 0 | 100.0% | 82 | 172 | 446 | 98.5% |

### All speech together (report half)

| detector | clips | fired on background | VALID | EARLY only | NONE | newly missed (baseline VALID, this not VALID) | from distinct recordings | newly missed, lenient (baseline VALID or EARLY, this NONE) | newly caught | delay p50 ms | p95 | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gate 100 ms | 3200 | 1135 | 2036 | 21 | 1143 | 0 | 0 | 0 | 0 | 110 | 400 | 960 |
| gate 200 ms | 3200 | 1054 | 1862 | 13 | 1325 | 263 | 240 | 263 | 89 | 210 | 560 | 940 |
| gate 300 ms | 3200 | 989 | 1506 | 14 | 1680 | 683 | 480 | 683 | 153 | 300 | 660 | 1690 |
| silero p>=0.50 for 64 ms | 3200 | 22 | 3150 | 5 | 45 | 17 | 11 | 15 | 1131 | 80 | 536 | 920 |

### Delay where the estimated onset can be believed

A single spoken word does not last 0.7 s. Where the energy estimate says a one-word recording is "speech" for longer than that, the estimate is the whole noisy file, its "onset" is the start of the file and not the word, and a delay measured from it says nothing about either detector. This rule looks only at the recording, not at any detector. Sentences are all kept.

| set | onset | detector | clips | VALID | delay p50 ms | p95 | max | VALID within 400 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en-command | estimate believable | gate 100 ms | 1015 | 627 | 110 | 290 | 420 | 99.4% |
| en-command | estimate believable | silero p>=0.50 for 64 ms | 1015 | 993 | 82 | 268 | 440 | 99.7% |
| en-command | estimate is the whole file | gate 100 ms | 455 | 294 | 150 | 770 | 960 | 68.4% |
| en-command | estimate is the whole file | silero p>=0.50 for 64 ms | 455 | 440 | 440 | 792 | 920 | 41.1% |
| ar-command | estimate believable | gate 100 ms | 1350 | 865 | 110 | 260 | 400 | 100.0% |
| ar-command | estimate believable | silero p>=0.50 for 64 ms | 1350 | 1339 | 76 | 122 | 482 | 99.9% |
| ar-command | estimate is the whole file | gate 100 ms | 55 | 35 | 110 | 350 | 380 | 100.0% |
| ar-command | estimate is the whole file | silero p>=0.50 for 64 ms | 55 | 55 | 84 | 344 | 408 | 98.2% |
| en-sentence | estimate believable | gate 100 ms | 325 | 215 | 110 | 280 | 810 | 99.5% |
| en-sentence | estimate believable | silero p>=0.50 for 64 ms | 325 | 323 | 78 | 172 | 446 | 99.7% |

| all sets, estimate believable | clips | VALID | delay p50 ms | p95 | max | VALID within 400 ms |
| --- | --- | --- | --- | --- | --- | --- |
| gate 100 ms | 2690 | 1707 | 110 | 280 | 810 | 99.7% |
| silero p>=0.50 for 64 ms | 2690 | 2655 | 78 | 230 | 482 | 99.8% |

### Short commands by word (all conditions)

| word | clips | gate 100 ms not VALID | gate 200 ms not VALID | gate 300 ms not VALID | silero p>=0.50 for 64 ms not VALID |
| --- | --- | --- | --- | --- | --- |
| ar-command/cancel | 210 | 73 | 73 | 88 | 1 |
| ar-command/close | 250 | 92 | 94 | 108 | 3 |
| ar-command/no | 235 | 88 | 110 | 140 | 1 |
| ar-command/ok | 255 | 88 | 90 | 122 | 3 |
| ar-command/stop | 215 | 77 | 96 | 127 | 0 |
| ar-command/yes | 240 | 87 | 89 | 122 | 3 |
| en-command/go | 365 | 131 | 161 | 224 | 6 |
| en-command/no | 330 | 122 | 135 | 174 | 4 |
| en-command/stop | 390 | 150 | 209 | 269 | 22 |
| en-command/yes | 385 | 146 | 182 | 228 | 5 |

## Speech-to-text opened by non-speech noise (report half)

Same lifecycle for both, silent fake provider. A stream opens on the first frame counted as speech and stays open until 1.8 s of quiet.

| noise level dBFS | hours incl. variants | gate: streams opened | per hour | share of noise sent | Silero verdict: streams opened | per hour | share of noise sent |
| --- | --- | --- | --- | --- | --- | --- | --- |
| -45 | 0.59 | 229 | 390.3 | 60.7% | 4 | 6.8 | 0.4% |
| -35 | 0.59 | 106 | 180.6 | 97.7% | 7 | 11.9 | 0.8% |
| -25 | 0.59 | 76 | 129.5 | 99.1% | 8 | 13.6 | 0.9% |

## Every Silero setting on the report half (for information; the rule is not re-picked)

| rule | newly missed | lenient | not VALID | firings/h non-speech | firings/h speech-like | delay p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| silero p>=0.50 for 32 ms | 20 | 14 | 63 | 10.8 | 85.1 | 48 | 486 |
| silero p>=0.50 for 64 ms | 17 | 15 | 50 | 8.5 | 79.4 | 80 | 536 |
| silero p>=0.50 for 96 ms | 17 | 15 | 46 | 8.0 | 77.0 | 112 | 568 |
| silero p>=0.50 for 160 ms | 21 | 20 | 46 | 6.8 | 74.6 | 178 | 632 |
| silero p>=0.50 for 256 ms | 36 | 36 | 75 | 5.1 | 73.8 | 274 | 728 |
| silero p>=0.60 for 32 ms | 20 | 15 | 55 | 8.0 | 79.4 | 52 | 504 |
| silero p>=0.60 for 64 ms | 20 | 18 | 51 | 6.2 | 76.2 | 84 | 536 |
| silero p>=0.60 for 96 ms | 22 | 20 | 50 | 6.2 | 72.1 | 116 | 568 |
| silero p>=0.60 for 160 ms | 25 | 24 | 57 | 5.1 | 69.7 | 180 | 632 |
| silero p>=0.60 for 256 ms | 48 | 48 | 95 | 5.1 | 69.7 | 276 | 728 |
| silero p>=0.70 for 32 ms | 22 | 19 | 57 | 6.8 | 73.8 | 56 | 504 |
| silero p>=0.70 for 64 ms | 23 | 22 | 56 | 5.7 | 69.7 | 88 | 546 |
| silero p>=0.70 for 96 ms | 25 | 24 | 58 | 5.1 | 69.7 | 122 | 582 |
| silero p>=0.70 for 160 ms | 35 | 35 | 69 | 5.1 | 68.1 | 186 | 664 |
| silero p>=0.70 for 256 ms | 71 | 71 | 130 | 4.5 | 65.7 | 282 | 728 |
| silero p>=0.80 for 32 ms | 26 | 26 | 57 | 5.1 | 68.1 | 66 | 536 |
| silero p>=0.80 for 64 ms | 27 | 28 | 61 | 5.1 | 66.5 | 98 | 568 |
| silero p>=0.80 for 96 ms | 34 | 35 | 71 | 4.0 | 65.7 | 130 | 600 |
| silero p>=0.80 for 160 ms | 49 | 50 | 97 | 4.0 | 64.9 | 196 | 664 |
| silero p>=0.80 for 256 ms | 121 | 123 | 204 | 4.0 | 61.6 | 290 | 728 |
| silero p>=0.90 for 32 ms | 42 | 43 | 81 | 4.0 | 62.4 | 80 | 536 |
| silero p>=0.90 for 64 ms | 53 | 54 | 99 | 4.0 | 58.4 | 114 | 568 |
| silero p>=0.90 for 96 ms | 65 | 66 | 119 | 4.0 | 56.7 | 146 | 600 |
| silero p>=0.90 for 160 ms | 93 | 94 | 163 | 4.0 | 56.7 | 210 | 664 |
| silero p>=0.90 for 256 ms | 249 | 253 | 393 | 3.4 | 55.9 | 304 | 728 |
| gate 100 ms | 0 | 0 | 1164 | 178.9 | 165.4 | 110 | 400 |
| gate 200 ms | 263 | 263 | 1338 | 162.5 | 137.8 | 210 | 560 |
| gate 300 ms | 683 | 683 | 1694 | 141.5 | 120.8 | 300 | 660 |

## The same scores after the second opinion

ADJUDICATION.md says which recordings were looked at, by what, and the fixed rules for each label. It is a machine opinion (Whisper and a second voice detector), not a person listening. The scores above are the originals and stay as they are. Below, the same rule is applied to both detectors.

### Speech: recordings labelled "no speech" taken out (2 on the report half; 2 "uncertain" ones stay in as speech)

| detector | clips | VALID | EARLY only | NONE | newly missed | from distinct recordings | newly missed, lenient | newly caught | delay p50 ms | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gate 100 ms | 3190 | 2030 | 21 | 1139 | 0 | 0 | 0 | 0 | 110 | 400 |
| gate 200 ms | 3190 | 1856 | 13 | 1321 | 263 | 240 | 263 | 89 | 210 | 560 |
| gate 300 ms | 3190 | 1499 | 14 | 1677 | 683 | 480 | 683 | 152 | 300 | 660 |
| silero p>=0.50 for 64 ms | 3190 | 3145 | 5 | 40 | 14 | 9 | 12 | 1129 | 80 | 526 |

### Non-speech noise: recordings where a voice was found taken out

Only recordings where the frozen rule fired were looked at (6 of the non-speech ones), so a voice in a recording where only the gate fired would not have been found. A recording taken out is taken out whole, for both detectors, with its time.

| non-speech set | detector | distinct recordings | hours incl. variants | firings | per hour | recordings with a firing |
| --- | --- | --- | --- | --- | --- | --- |
| as labelled by the source (original) | gate 100 ms | 59 | 1.76 | 315 | 178.9 | 59 |
| as labelled by the source (original) | silero p>=0.50 for 64 ms | 59 | 1.76 | 15 | 8.5 | 6 |
| without "background voice" recordings | gate 100 ms | 58 | 1.74 | 309 | 177.9 | 58 |
| without "background voice" recordings | silero p>=0.50 for 64 ms | 58 | 1.74 | 9 | 5.2 | 5 |
| also without "uncertain" recordings | gate 100 ms | 57 | 1.70 | 303 | 178.1 | 57 |
| also without "uncertain" recordings | silero p>=0.50 for 64 ms | 57 | 1.70 | 5 | 2.9 | 4 |
