#!/usr/bin/env python3
"""Fair load round table: single-process rows (results/load) and pooled rows (results/load-pool). Mean (±spread) over VALID repeats; INVALID counted.
Usage: pool_table.py SINGLE_DIR POOL_DIR"""
import csv, glob, statistics as st, sys, collections
single, pool = sys.argv[1], sys.argv[2]
g = collections.defaultdict(list)
for f in sorted(glob.glob(f"{single}/load-runs-*.csv")):
    for r in csv.DictReader(open(f)):
        if int(r["n"]) in (5, 10, 20):
            g[(r["engine"], r["turnEnd"], int(r["n"]), "single process (1)")].append(r)
for f in sorted(glob.glob(f"{pool}/load-pool-runs-*.csv")):
    for r in csv.DictReader(open(f)):
        spec = r.get("procsSpec", "")
        lab = f"one per conversation ({r['procs']})" if spec == "N" else f"pool of {r['procs']}"
        g[(r["engine"], r["turnEnd"], int(r["n"]), lab)].append(r)
def m(rs, k, p=0):
    v = [float(r[k]) for r in rs if r.get(k) not in (None, "")]
    if not v: return "-"
    s = st.pstdev(v) if len(v) > 1 else 0
    return f"{st.mean(v):.{p}f} (±{s:.{p}f})"
def mx(rs, k, p=0):
    v = [float(r[k]) for r in rs if r.get(k) not in (None, "")]
    return f"{max(v):.{p}f}" if v else "-"
nm = {"ts": "A", "pipecat": "B"}
def order(key):
    e, t, n, lab = key
    rank = 0 if lab.startswith("single") else (1 if lab.startswith("pool of 2") else 2 if lab.startswith("pool of 4") else 3)
    return (t != "local", e != "ts", n, rank, lab)
print("| Config | N | processes | valid/runs | total CPU % (all processes) | total RSS MB (peak) | worst process loop delay p95 ms | end of speech to turn p50 ms | talk-over stop p50 / p95 ms | busiest process CPU % | load generator CPU % | whole box busy % of 4 cores |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|")
for key in sorted(g, key=order):
    e, t, n, lab = key
    rs = g[key]; ok = [r for r in rs if r["valid"] == "VALID"]
    bad = len(rs) - len(ok)
    cfg = f"{nm[e]}-{t}"
    if not ok:
        print(f"| {cfg} | {n} | {lab} | 0/{len(rs)} INVALID | | | | | | | | |")
        continue
    boxcol = m(ok, "boxBusyPctOf4Cores", 0) if "boxBusyPctOf4Cores" in ok[0] else "(not recorded)"
    pc = m(ok, "procCpuMaxPct", 0) if "procCpuMaxPct" in ok[0] else "(one process)"
    print(f"| {cfg} | {n} | {lab} | {len(ok)}/{len(rs)}{' (' + str(bad) + ' INVALID)' if bad else ''} | {m(ok,'engineCpuPctOfOneCore')} | {m(ok,'rssMbPeak')} | {mx(ok,'loopLagP95Ms',1)} | {m(ok,'eosToTurnP50Ms')} | {m(ok,'talkOverStopP50Ms')} / {m(ok,'talkOverStopP95Ms')} | {pc} | {m(ok,'loadgenCpuPctOfOneCore')} | {boxcol} |")

bad_keys = [k for k in sorted(g, key=order) if not any(r["valid"] == "VALID" for r in g[k])]
if bad_keys:
    print("\nINVALID cells (numbers shown for information only, never used above). Reasons are in the CSV `invalidReasons` column.\n")
    print("| Config | N | processes | runs | total CPU % | total RSS MB | worst process loop delay p95 ms | end of speech to turn p50 ms | talk-over stop p50 ms | timeouts / cycles | load generator loop delay p95 ms | box busy % of 4 cores | why INVALID |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for key in bad_keys:
        e, t, n, lab = key; rs = g[key]
        why = "; ".join(sorted({x.strip().split(":")[0].split(" (")[0][:60] for r in rs for x in r["invalidReasons"].split(" | ")}))
        to = sum(float(r["cyclesTimeout"]) for r in rs); cy = sum(float(r["cyclesCounted"]) for r in rs)
        lg = m(rs, "loadgenLagP95Ms", 0) if "loadgenLagP95Ms" in rs[0] else "-"
        box = m(rs, "boxBusyPctOf4Cores", 0) if "boxBusyPctOf4Cores" in rs[0] else "(not recorded)"
        print(f"| {nm[e]}-{t} | {n} | {lab} | {len(rs)} | {m(rs,'engineCpuPctOfOneCore')} | {m(rs,'rssMbPeak')} | {mx(rs,'loopLagP95Ms',1)} | {m(rs,'eosToTurnP50Ms')} | {m(rs,'talkOverStopP50Ms')} | {int(to)} / {int(cy)} | {lg} | {box} | {why} |")
