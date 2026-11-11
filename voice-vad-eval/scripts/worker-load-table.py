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
        curve = [line.split("\t") for line in open(os.path.join(out, name + ".memory.tsv")).read().split("\n")[1:] if line]
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
print("| path | people | observer | measured, s | memory: container peak, MB (share of 512) | process RSS peak, MB (share of 512) | CPU, cores | throttled, s | event-loop delay p50 / p99 / max, ms | audio heard by the worker, of what was sent | came and went | observer: audio judged, s | people per call mean / most | call mean / max, ms | wait mean / max, ms | most audio waiting, ms | dropped, s | late answers thrown away | errors |")
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
        cells += [o["audioSecondsJudged"], per_call, call_ms, f'{o["meanAgeMs"]} / {o["maxAgeMs"]}', o["peakQueuedMs"], round(o["droppedMs"] / 1000, 1), o["lateDiscarded"], o["errors"]]
    else:
        cells += ["", "", "", "", "", "", "", ""]
    print("| " + " | ".join(str(x) for x in cells) + " |")
print()
print("In the runs above: OOM kills:", sum(r[3]["memory"]["oomKills"] for r in rows), "; load generator errors:", sum(len(r[4].get("errors", [])) for r in rows), "; joins that failed:", sum(r[4].get("joinFailures", 0) for r in rows), "; bridge links lost:", sum(r[4].get("linkDowns", 0) for r in rows))
for name, how, curve in died:
    print()
    print(f"Did not last its run: {name} ({how}). Memory as it went (seconds since start: container MB / process RSS MB / JavaScript heap MB): " + ", ".join(f"{c[0]}: {c[1]} / {c[3]} / {c[4]}" for c in curve))
