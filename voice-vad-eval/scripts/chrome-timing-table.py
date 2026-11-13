"""Tables from chrome-timing.ts output.  python3 -I scripts/chrome-timing-table.py <proximity.json> <livekit.json>"""
import json, sys, statistics as st


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    # nearest rank
    k = max(0, min(len(xs) - 1, int(round(p / 100 * len(xs) + 0.5)) - 1))
    return xs[k]


def cell(xs):
    if not xs:
        return "-"
    return f"{st.median(xs):.0f} / {pct(xs, 95):.0f} ({len(xs)})"


for path in sys.argv[1:]:
    d = json.load(open(path))
    print(f"\n### {d.get('transport', '?')} (Chrome {d['chrome']})\n")
    print("median / p95 ms (samples). 'silent' = sound starts at the mic to bot silent in Chrome.\n")
    print("| case | behaviour | trials | silent | worker cancel | pause (hold) | decide to go on | back in Chrome after go-on | stopped by the noise | voice over noise: silent | voice over noise: cancel |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for kind in ("voice", "hum", "fan"):
        for b in ("today", "pause"):
            ts = [t for t in d["trials"] if t["kind"] == kind and t["behaviour"] == b]
            g = lambda k: [t[k] for t in ts if k in t and t[k] is not None]
            print(f"| {kind} | {b} | {len(ts)} | {cell(g('silentMs'))} | {cell(g('cancelMs'))} | {cell(g('holdMs'))} | {cell(g('continueMs'))} | {cell(g('backMs'))} | {sum(1 for t in ts if t['stoppedByNoise'])} | {cell(g('voiceSilentMs'))} | {cell(g('voiceCancelMs'))} |")
    # paired difference for voice
    v = {}
    for t in d["trials"]:
        if t["kind"] == "voice":
            v.setdefault(t["k"], {})[t["behaviour"]] = t
    diffs = [p["pause"]["silentMs"] - p["today"]["silentMs"] for p in v.values() if "pause" in p and "today" in p and "silentMs" in p["pause"] and "silentMs" in p["today"]]
    if diffs:
        print(f"\nvoice, paired (pause minus today), silent in Chrome: median {st.median(diffs):+.0f} ms, p95 {pct(diffs, 95):+.0f} ms, worst {max(diffs):+.0f} ms, n={len(diffs)}")
    miss = [t for t in d["trials"] if t["kind"] == "voice" and t["behaviour"] == "pause" and t.get("cancelMs") is None]
    print(f"voice trials where the pause did not stop the reply: {len(miss)} of {sum(1 for t in d['trials'] if t['kind']=='voice' and t['behaviour']=='pause')}")
    for kind in ("hum", "fan"):
        ts = [t for t in d["trials"] if t["kind"] == kind and t["behaviour"] == "pause"]
        print(f"{kind}: pause went on in {sum(1 for t in ts if 'continueMs' in t)} of {len(ts)}; today stopped in {sum(1 for t in d['trials'] if t['kind']==kind and t['behaviour']=='today' and t['stoppedByNoise'])} of {sum(1 for t in d['trials'] if t['kind']==kind and t['behaviour']=='today')}")
    fan = [t for t in d["trials"] if t["kind"] == "fan" and t["behaviour"] == "pause" and "continueMs" in t]
    print(f"fan then voice: the voice stopped the reply in {sum(1 for t in fan if t.get('voiceCancelMs') is not None)} of {len(fan)}")
    print("counters (pause worker):", {k: v for k, v in d["counters"]["pause"].items() if k.startswith("yield_") and not k.endswith("_ms")})
    print("counters (today worker):", {k: v for k, v in d["counters"]["today"].items() if k.startswith(("yield_", "observer_loaded")) and v})
