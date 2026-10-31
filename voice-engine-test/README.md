# Voice engine bake-off (issue #1701)

Two voice engines behind one bridge protocol, with fake speech-to-text, fake text-to-speech and a fake brain.
No paid API, no secrets, no production code touched. Everything lives in this folder.

* Engine B: Pipecat 1.15.0 (Python), `pipecat-engine/`
* Engine A: thin TypeScript engine (Node 22, werift, libopus WASM, onnxruntime-node), `ts-engine/`
* Bridge protocol: `bridge/PROTOCOL.md`, `bridge/schema.json`, fake brain `bridge/src/brain.ts`
* Load generator and scenarios (separate processes from the engines): `loadgen/`, `scenarios/`, `signaling/`
* Test clips and licences: `clips/` (see `clips/SOURCES.md`)
* The results and the scorecard are written to `results/` (a copy is kept in `/mnt/project-files/voice-engine-test/results/`).

All numbers come from a 4-core cloud sandbox. They are not server capacity.

## Install

```bash
cd voice-engine-test
npm ci                                         # Node 22+, installs the load generator and the TS engine
python3 -m venv pipecat-engine/.venv           # Python 3.13 was used
pipecat-engine/.venv/bin/pip install -r pipecat-engine/requirements.txt
ts-engine/fetch-models.sh                      # copies the two ONNX models out of the pip package, checks sha256
```

Both engines use the same two model files (Silero VAD and Smart Turn v3.2 cpu). Checksums are in `ts-engine/models.sha256`.

## Run the scenarios (S1 to S13)

```bash
# <engine> = pipecat | ts     <turn-end> = local | provider
npx tsx scenarios/run.ts pipecat local  "" results/scenarios      # all scenarios, about 7 minutes
npx tsx scenarios/run.ts ts provider S2,S6 results/scenarios       # only some
```

Each run starts the fake brain, the signaling server and one engine as separate processes, then drives them with real
WebRTC peers. The result is `results/scenarios/<engine>-<turn-end>.json`: one PASS/FAIL/BLOCKED row per scenario with a reason and evidence.
A PASS always comes from named checks that fail when the behaviour is wrong.

Smoke test only: `npx tsx scenarios/smoke.ts`.

## Run the load test

```bash
npx tsx scenarios/load.ts pipecat local --n 1,5,10,20 --reps 3 --warmup 15 --measure 60 --out results/load
```

For each N it starts a fresh stack, connects N one-to-one conversations (one human peer plus one bot each),
waits through the warm-up, then measures for 60 s. The people talk about 40% of the time; about 15% of turns are talk-overs.
Output: `load-runs-<engine>-<turn-end>.csv` (one row per run), `load-cycles-...csv` (one row per conversation cycle).
Runs that fail supervision are written as INVALID with the reasons. They are never dropped.
`scripts/summarize_load.py` builds the mean and spread table.

## Check that the TypeScript Smart Turn features equal Python's

```bash
pipecat-engine/.venv/bin/python pipecat-engine/tools/parity_ref.py      # writes the reference cases to /tmp/parity
npx tsx ts-engine/test/parity.ts                                          # compares features, probabilities, decisions
```

## The emotion stub (S13)

`--emotion-stub` on either engine turns on a stub step that adds `emotion:{label,confidence,source:"stub"}` to `user.turn`
(loudness only, no model). `pipecat-engine/engine/emotion_stub.py` and `ts-engine/src/emotion.ts`. Scenario S13 tests it.

## Safety

No dev runner and no open endpoint: the engine stats server, the fake brain and the signaling server bind to 127.0.0.1 only.
