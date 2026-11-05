#!/usr/bin/env python3
"""Compact load table for the scorecard: mean +- spread over VALID repeats. INVALID runs are counted, not averaged. Usage: load_table.py DIR"""
import csv, glob, statistics as st, sys, collections
d = sys.argv[1] if len(sys.argv) > 1 else "results/load"
g = collections.defaultdict(list)
for f in sorted(glob.glob(f"{d}/load-runs-*.csv")):
    for r in csv.DictReader(open(f)):
        g[(r["engine"], r["turnEnd"], int(r["n"]))].append(r)
def m(rs, k, p=0):
    v = [float(r[k]) for r in rs if r.get(k) not in (None, "")]
    if not v: return "-"
    s = st.pstdev(v) if len(v) > 1 else 0
    return f"{st.mean(v):.{p}f} (±{s:.{p}f})"
name = {"ts": "A", "pipecat": "B"}
print("| Config | N | valid runs | engine CPU % of one core | CPU % per talker | RSS MB | loop delay p95 ms | end of speech to turn p50 ms | say to first audio p95 ms | talk-over stop p50 / p95 ms |")
print("|---|---|---|---|---|---|---|---|---|---|")
for (e, t, n), rs in sorted(g.items(), key=lambda x: (x[0][0] != "ts", x[0][1] != "local", x[0][2])):
    ok = [r for r in rs if r["valid"] == "VALID"]
    cfg = f"{name[e]}-{t}"
    if not ok:
        r0 = rs[0]
        print(f"| {cfg} | {n} | 0/{len(rs)} INVALID | (not used) | | | | | | |")
        continue
    print(f"| {cfg} | {n} | {len(ok)}/{len(rs)} | {m(ok,'engineCpuPctOfOneCore',0)} | {m(ok,'cpuPctPerConversation',1)} | {m(ok,'rssMbPeak',0)} | {m(ok,'loopLagP95Ms',1)} | {m(ok,'eosToTurnP50Ms',0)} | {m(ok,'sayToFirstAudioP95Ms',0)} | {m(ok,'talkOverStopP50Ms',0)} / {m(ok,'talkOverStopP95Ms',0)} |")
