#!/usr/bin/env python3
"""Reads results/load/load-runs-*.csv and prints a markdown table: mean +- stdev (min-max) over VALID repeats per engine config and N.
INVALID runs are counted and listed, never averaged in. Usage: summarize_load.py DIR"""
import csv, glob, statistics as st, sys, collections

d = sys.argv[1] if len(sys.argv) > 1 else "results/load"
rows = []
for f in sorted(glob.glob(f"{d}/load-runs-*.csv")):
    rows += list(csv.DictReader(open(f)))
g = collections.defaultdict(list)
for r in rows:
    g[(r["engine"], r["turnEnd"], int(r["n"]))].append(r)

def fnum(r, k):
    try:
        return float(r[k])
    except (KeyError, ValueError):
        return None

def ms(rs, k, p=1):
    v = [x for x in (fnum(r, k) for r in rs) if x is not None]
    if not v:
        return "n/a"
    m = st.mean(v)
    sd = st.pstdev(v) if len(v) > 1 else 0.0
    return f"{m:.{p}f} +-{sd:.{p}f}"

cols = [("CPU % of one core", "engineCpuPctOfOneCore", 1), ("CPU % per talker", "cpuPctPerConversation", 2), ("RSS MB end", "rssMbEnd", 0), ("RSS MB peak", "rssMbPeak", 0),
        ("loop lag p95 ms", "loopLagP95Ms", 1), ("end of speech to turn p50 ms", "eosToTurnP50Ms", 0), ("turn to first bot audio p50 ms", "turnToFirstAudioP50Ms", 0),
        ("say to first audio p95 ms", "sayToFirstAudioP95Ms", 0), ("talk-over stop p50 ms", "talkOverStopP50Ms", 0), ("talk-over stop p95 ms", "talkOverStopP95Ms", 0),
        ("stale audio ms total", "staleAudioMsTotal", 0), ("loadgen CPU %", "loadgenCpuPctOfOneCore", 0)]
print("| engine | turn end | N | valid/runs | " + " | ".join(c[0] for c in cols) + " |")
print("|---|---|---|---|" + "---|" * len(cols))
for (e, t, n), rs in sorted(g.items()):
    ok = [r for r in rs if r["valid"] == "VALID"]
    print(f"| {e} | {t} | {n} | {len(ok)}/{len(rs)} | " + " | ".join(ms(ok, k, p) for _, k, p in cols) + " |")
bad = [r for r in rows if r["valid"] != "VALID"]
if bad:
    print("\nINVALID runs (not averaged):")
    for r in bad:
        print(f"- {r['run']}: {r['invalidReasons']}")
print("\nCounters (mean over VALID runs, per measured window):")
cc = ["segStarted", "segCompleted", "segCancelled", "ttsGeneratedMs", "ttsPlayedMs", "ttsCancelledMs", "lgTxPackets", "lgRxPackets", "lgRxBytes", "turnsFinal", "bargeIns"]
print("| engine | turn end | N | " + " | ".join(cc) + " |")
print("|---|---|---|" + "---|" * len(cc))
for (e, t, n), rs in sorted(g.items()):
    ok = [r for r in rs if r["valid"] == "VALID"]
    print(f"| {e} | {t} | {n} | " + " | ".join(ms(ok, k, 0) for k in cc) + " |")
