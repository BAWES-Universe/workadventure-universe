| | observer off | observer on |
| --- | --- | --- |
| measured, minutes | 10.0 | 10.0 |
| people: on their own connections + in LiveKit rooms (bubbles) | 10 + 7 (4 + 3) | 10 + 7 (4 + 3) |
| how the container ended | running=false oom_killed=false exit_code=0 | running=false oom_killed=false exit_code=0 |
| memory, container peak, MB (share of the cap) | 120 (23%) | 153 (30%) |
| process RSS, MB: first 5 minutes / last 5 minutes / highest | 160 / 163 / 164 | 216 / 218 / 219 |
| process RSS trend over the run, MB per hour | +39.3 | +31.3 |
| container memory without file cache, MB: first 5 / last 5 minutes; trend per hour | 97 / 99; +25.8 | 130 / 132; +21.0 |
| JavaScript heap in use, MB: first 5 / last 5 minutes; trend per hour | 38 / 38; +9.6 | 38 / 39; +12.1 |
| memory kills | 0 | 0 |
| CPU, cores (throttled, s) | 0.389 (1.23) | 0.510 (4.19) |
| event-loop delay p50 / p99 / max, ms | 5.1 / 8.2 / 107.9 | 5.2 / 9.2 / 96.1 |
| event-loop delay, worst in any 5 s: median / highest, ms | 32 / 108 | 33 / 96 |
| audio the worker heard, of what was sent to be heard, s | 9522 of 9917 (96.0%) | 9537 of 9917 (96.2%) |
| came / went (failed to come back) | 98 / 81 (0) | 98 / 81 (0) |
| times one person stopped being heard for a moment | 61 | 61 |
| replies the bots spoke | 430 | 430 |
| turns today's gate opened; times it stopped the bot's voice | 387; 136 | 397; 138 |
| generator errors; bridge links lost | 0; 0 | 0; 0 |
| closing with everyone still connected, ms (sessions, connections at that moment) | 56 (7, 13) | 28 (7, 13) |

| the observer's own work, switched on | proximity WebRTC | LiveKit room |
| --- | --- | --- |
| audio sent to be heard, s | 5820 | 4097 |
| handed to the observer by the sessions, s (share of sent) | 5821 (100.0%) | 3717 (90.7%) |
| answered and kept, s (share of handed over) | 5507 (94.62%) | 3398 (91.41%) |
| today's gate said "speaking" | 203 | 78 |
| the observer's rule fired | 300 | 173 |
| the two within 600 ms of each other, same person | 33 | 10 |

| the observer's work, both paths | |
| --- | --- |
| status at the end | on |
| windows the detector answered for | 278273 |
| of them: kept / thrown away because the person was no longer heard / thrown away because their stream had started afresh / too old by the clock | 278273 / 0 / 0 / 0 |
| windows in calls that failed | 0 |
| calls to the detector; people per call mean / most; call mean / max, ms | 140785; 2 / 15; 1.11 / 77 |
| age of a kept answer, from the window's newest sample, mean / max, ms | 2 / 106 |
| age of a kept answer, from the window's oldest sample, max, ms (limit 400) | 147 |
| most audio waiting at once, everyone together, ms (limit 16000); most people watched; longest line for the detector | 1652; 15; 15 |
| audio let go without an answer, ms: observer's bounds / too old / last bit shorter than a window / person no longer heard / failed call / start afresh after missing audio | 630590 / 0 / 672 / 1186 / 0 / 964 |
| deadline passed; switched itself off; errors; frames turned away after a session closed; people refused | 0; 0; 0; 0; 47463 |
| people's streams started / ended | 192 / 192 |
| while a bot was speaking: audio observed, s; observer firings; times today's gate stopped the voice | 3821; 129; 136 |
| at the close: what the observer held just before, and after | {"status": "on", "streams": 15, "queuedMs": 142, "inFlight": 0, "lined": 0, "callOut": false} then {"status": "closed", "streams": 0, "queuedMs": 0, "inFlight": 0, "lined": 0, "callOut": false} |
