#!/usr/bin/env python3
"""Builds the S1..S13 markdown tables from results/scenarios/*.json. Usage: scorecard_table.py DIR"""
import json, sys
d = sys.argv[1] if len(sys.argv) > 1 else "results/scenarios"
cfgs = [("ts", "local"), ("ts", "provider"), ("pipecat", "local"), ("pipecat", "provider")]
names = {"S1": "Walk up", "S2": "Talk over", "S3": "Text+voice together", "S4": "Ask for work", "S5": "Asks first", "S6": "Voice runs out", "S7": "Words didn't all come through",
         "S8": "Several people in one bubble", "S9": "Mode switch", "S10": "Reconnect", "S11": "Arabic done talking", "S12": "UI only", "S13": "Customizability and emotion", "X1": "Committed-only speech + retract (extra)"}
data = {}
for e, t in cfgs:
    try:
        data[(e, t)] = {r["id"]: r for r in json.load(open(f"{d}/{e}-{t}.json"))["results"]}
    except FileNotFoundError:
        data[(e, t)] = {}
label = {"ts": "A", "pipecat": "B"}
print("| Scenario | " + " | ".join(f"{label[e]}-{t}" for e, t in cfgs) + " |")
print("|---|" + "---|" * len(cfgs))
for sid, nm in names.items():
    cells = []
    for c in cfgs:
        if sid == "S12":
            cells.append("N/A")
        else:
            r = data[c].get(sid)
            cells.append(r["status"] if r else "NOT RUN")
    print(f"| {sid} {nm} | " + " | ".join(cells) + " |")
print()
for sid, nm in names.items():
    if sid == "S12":
        print("**S12 UI only**: N/A for both engines. The test sandbox has no game UI; the engines are not involved.\n")
        continue
    print(f"**{sid} {nm}**")
    for c in cfgs:
        r = data[c].get(sid)
        print(f"- {label[c[0]]}-{c[1]}: {r['status'] if r else 'NOT RUN'}. {r['reason'] if r else ''} (evidence: `{c[0]}-{c[1]}.json`, id {sid})")
    print()
for c in cfgs:
    h = [r for r in data[c].values() if r["id"].startswith("HARNESS")]
    print(f"- {label[c[0]]}-{c[1]} harness checks (engine failures, schema violations, unexpected exits): " + ", ".join(f"{r['id']}={r['status']}" for r in h))
