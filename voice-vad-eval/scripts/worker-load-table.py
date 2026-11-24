"""The table of the whole-worker runs, from the files scripts/worker-load.sh leaves.
  python3 -I scripts/worker-load-table.py <out dir>
"""
import glob, json, os, sys

out = sys.argv[1]
rows = []
died = []
for f in sorted(glob.glob(os.path.join(out, "*.container.txt"))):
    # A worker that did not last its run leaves no summary, only how its container ended and its memory curve
    name = os.path.basename(f)[: -len(".container.txt")]
    if not os.path.exists(os.path.join(out, name + ".worker.json")):
        # A worker that never became healthy has no memory curve at all
        trace = os.path.join(out, name + ".memory.tsv")
        curve = [line.split("\t") for line in open(trace).read().split("\n")[1:] if line] if os.path.exists(trace) else []
        died.append((name, open(f).read().strip(), curve))
for f in sorted(glob.glob(os.path.join(out, "*.worker.json"))):
    name = os.path.basename(f)[: -len(".worker.json")]
    w = json.load(open(f))
    load_file = os.path.join(out, name + ".load.json")
    l = json.load(open(load_file)) if os.path.exists(load_file) else {}
    parts = name.split("-")  # [room-]off|on-N
    path = "LiveKit room" if parts[0] == "room" else "proximity WebRTC"
    streams = int(parts[-1])
    rows.append((path, streams, w["observer"], w, l))
rows.sort(key=lambda r: (r[0] != "proximity WebRTC", r[1], r[2] != "off"))
print("| path | people | observer | measured, s | memory: container peak, MB (share of 512) | process RSS peak, MB (share of 512) | CPU, cores | throttled, s | event-loop delay p50 / p99 / max, ms | audio heard by the worker, of what was sent | came and went | observer: audio judged, s | people per call mean / most | call mean / max, ms | wait mean / max, ms | most audio waiting, ms | dropped or too old, s | answers thrown away | errors |")
print("| " + " | ".join(["---"] * 19) + " |")
for path, streams, observer, w, l in rows:
    m, c, e, h, o = w["memory"], w["cpu"], w["eventLoopDelayMs"], w["heard"], w.get("observerWork") or {}
    rss = m["peakProcessRssMbSampled"]
    came = f'{l.get("joins", 0)} / {l.get("leaves", 0)}' + (f' ({l["joinFailures"]} failed)' if l.get("joinFailures") else "") if l else "n/a"
    sent = (l.get("measured") or {}).get("sent")
    heard = f'{h["frames"]} of {sent} ({100 * h["frames"] / sent:.1f}%)' if sent else str(h["frames"])
    cells = [path if streams else "idle", streams, observer, w["seconds"], f'{m["peakMb"]} ({m["peakMb"] / 5.12:.0f}%)', f'{rss} ({rss / 5.12:.0f}%)', f'{c["coresUsed"]:.3f}', c["throttledSeconds"], f'{e["p50"]} / {e["p99"]} / {e["max"]}', heard, came]
    if o:
        # The first build made one call per window and named its figures so
        per_call = f'{o["meanPeoplePerCall"]} / {o["mostPeopleInACall"]}' if "calls" in o else "1 / 1"
        call_ms = f'{o["meanCallMs"]} / {o["maxCallMs"]}' if "calls" in o else f'{o["meanRunMs"]} / {o["maxRunMs"]}'
        # Runs made before the counters were split (commit 3e6a768d and earlier) have one "dropped" and one "late" figure
        dropped = o["droppedMs"] if "droppedMs" in o else o["lostMs"]["overflow"] + o["lostMs"]["expired"]
        late = o["lateDiscarded"] if "lateDiscarded" in o else o["windows"]["revoked"] + o["windows"]["stale"] + o["windows"]["expired"]
        cells += [o["audioSecondsJudged"], per_call, call_ms, f'{o["meanAgeMs"]} / {o["maxAgeMs"]}', o["peakQueuedMs"], round(dropped / 1000, 1), late, o["errors"]]
    else:
        cells += ["", "", "", "", "", "", "", ""]
    print("| " + " | ".join(str(x) for x in cells) + " |")
# "Heard" and "sent" are counted over a stretch each process marks for itself; they are set against each other only when the
# two stretches are on record and begin and end within a second of each other
def seconds_apart(a, b):
    from datetime import datetime
    return abs((datetime.fromisoformat(a.replace("Z", "+00:00")) - datetime.fromisoformat(b.replace("Z", "+00:00"))).total_seconds())
not_comparable = []
for path, streams, observer, w, l in rows:
    if not streams:
        continue
    name = f'{"room-" if path == "LiveKit room" else ""}{observer}-{streams}'
    wm, lm = (w.get("measuredFrom"), w.get("measuredTo")), (l.get("measured") or {})
    lm = (lm.get("from"), lm.get("to"))
    if not all(wm) or not all(lm):
        not_comparable.append(f"{name}: the stretch each process measured is not recorded (an older harness), so heard and sent are not known to cover the same time")
    elif max(seconds_apart(wm[0], lm[0]), seconds_apart(wm[1], lm[1])) > 1:
        not_comparable.append(f"{name}: the worker's stretch ({wm[0]} to {wm[1]}) and the generator's ({lm[0]} to {lm[1]}) differ by more than a second")
if not_comparable:
    print()
    print("Heard and sent are not directly comparable in:")
    for line in not_comparable:
        print("- " + line)
print()
print("In the runs above: OOM kills:", sum(r[3]["memory"]["oomKills"] for r in rows), "; load generator errors:", sum(len(r[4].get("errors", [])) for r in rows), "; joins that failed:", sum(r[4].get("joinFailures", 0) for r in rows), "; bridge links lost:", sum(r[4].get("linkDowns", 0) for r in rows))
for name, how, curve in died:
    print()
    memory = ", ".join(f"{c[0]}: {c[1]} / {c[3]} / {c[4]}" for c in curve) if curve else "no memory trace was written"
    print(f"Did not last its run: {name} ({how}). Memory as it went (seconds since start: container MB / process RSS MB / JavaScript heap MB): " + memory)
