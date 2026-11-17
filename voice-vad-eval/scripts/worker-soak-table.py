"""The long run of the built image, observer off beside on, from the files scripts/worker-soak.sh leaves.
  python3 -I scripts/worker-soak-table.py <out dir>
"""
import json, os, sys

out = sys.argv[1]


def load(name):
    path = os.path.join(out, name)
    return json.load(open(path)) if os.path.exists(path) else None


def trace(name, seconds):
    """The worker's own samples (one every 5 s) over the measured stretch: the last `seconds` before the summary was written."""
    rows = [line.split("\t") for line in open(os.path.join(out, name)).read().split("\n")[1:] if line]
    rows = [[float(x) if x else 0.0 for x in r] for r in rows]
    end = rows[-1][0]
    return [r for r in rows if r[0] >= end - seconds]


def slope_per_hour(rows, column):
    """Least-squares slope of one column against time, in MB per hour."""
    n = len(rows)
    mx = sum(r[0] for r in rows) / n
    my = sum(r[column] for r in rows) / n
    sxx = sum((r[0] - mx) ** 2 for r in rows)
    return 3600 * sum((r[0] - mx) * (r[column] - my) for r in rows) / sxx if sxx else 0.0


def mean(rows, column):
    return sum(r[column] for r in rows) / len(rows) if rows else 0.0


runs = {}
for which in ("off", "on"):
    w = load(f"soak-{which}.worker.json")
    if not w:
        continue
    runs[which] = dict(w=w, lane=load(f"soak-{which}.lane.load.json"), room=load(f"soak-{which}.room.load.json"), shut=load(f"soak-{which}.shutdown.json"), t=trace(f"soak-{which}.trace.tsv", w["seconds"]), how=open(os.path.join(out, f"soak-{which}.container.txt")).read().strip())

rows = []


def row(label, f):
    rows.append([label] + [f(runs[which]) if which in runs else "" for which in ("off", "on")])


def minutes(r, first):
    t = r["t"]
    start = t[0][0]
    end = t[-1][0]
    return [x for x in t if (x[0] < start + 300 if first else x[0] > end - 300)]


# trace columns: 0 uptime_s, 1 container_mb, 2 container_anon_mb, 3 process_rss_mb, 4 js_heap_used_mb, 5 js_external_mb, 6 sessions, 7 lanes, 8 observer_streams, 9 observer_waiting_ms, 10 loop_delay_max_ms
row("measured, minutes", lambda r: f'{r["w"]["seconds"] / 60:.1f}')
row("people: on their own connections + in LiveKit rooms (bubbles)", lambda r: f'{r["lane"]["streams"]} + {r["room"]["streams"]} ({r["lane"]["bubbles"]} + {r["room"]["bubbles"]})')
row("how the container ended", lambda r: r["how"].split(" started=")[0])
row("memory, container peak, MB (share of the cap)", lambda r: f'{r["w"]["memory"]["peakMb"]} ({100 * r["w"]["memory"]["peakShareOfLimit"]:.0f}%)')
row("process RSS, MB: first 5 minutes / last 5 minutes / highest", lambda r: f'{mean(minutes(r, True), 3):.0f} / {mean(minutes(r, False), 3):.0f} / {max(x[3] for x in r["t"]):.0f}')
row("process RSS trend over the run, MB per hour", lambda r: f'{slope_per_hour(r["t"], 3):+.1f}')
row("container memory without file cache, MB: first 5 / last 5 minutes; trend per hour", lambda r: f'{mean(minutes(r, True), 2):.0f} / {mean(minutes(r, False), 2):.0f}; {slope_per_hour(r["t"], 2):+.1f}')
row("JavaScript heap in use, MB: first 5 / last 5 minutes; trend per hour", lambda r: f'{mean(minutes(r, True), 4):.0f} / {mean(minutes(r, False), 4):.0f}; {slope_per_hour(r["t"], 4):+.1f}')
row("memory kills", lambda r: r["w"]["memory"]["oomKills"])
row("CPU, cores (throttled, s)", lambda r: f'{r["w"]["cpu"]["coresUsed"]:.3f} ({r["w"]["cpu"]["throttledSeconds"]})')
row("event-loop delay p50 / p99 / max, ms", lambda r: f'{r["w"]["eventLoopDelayMs"]["p50"]} / {r["w"]["eventLoopDelayMs"]["p99"]} / {r["w"]["eventLoopDelayMs"]["max"]}')
row("event-loop delay, worst in any 5 s: median / highest, ms", lambda r: f'{sorted(x[10] for x in r["t"])[len(r["t"]) // 2]:.0f} / {max(x[10] for x in r["t"]):.0f}')


def heard(r):
    sent_ms = r["lane"]["measured"]["sent"] * 20 + r["room"]["measured"]["sent"] * 10
    return f'{r["w"]["heard"]["ms"] / 1000:.0f} of {sent_ms / 1000:.0f} ({100 * r["w"]["heard"]["ms"] / sent_ms:.1f}%)'


row("audio the worker heard, of what was sent to be heard, s", heard)
row("came / went (failed to come back)", lambda r: f'{r["lane"]["joins"] + r["room"]["joins"]} / {r["lane"]["leaves"] + r["room"]["leaves"]} ({r["lane"]["joinFailures"] + r["room"]["joinFailures"]})')
row("times one person stopped being heard for a moment", lambda r: r["lane"]["mutes"] + r["room"]["mutes"])
row("replies the bots spoke", lambda r: r["lane"]["said"] + r["room"]["said"])
row("turns today's gate opened; times it stopped the bot's voice", lambda r: f'{r["w"]["heard"]["speechTurns"]}; {r["w"]["heard"]["bargeIns"]}')
row("generator errors; bridge links lost", lambda r: f'{len(r["lane"]["errors"]) + len(r["room"]["errors"])}; {r["lane"]["linkDowns"] + r["room"]["linkDowns"]}')
row("closing with everyone still connected, ms (sessions, connections at that moment)", lambda r: f'{r["shut"]["closeMs"]} ({r["shut"]["sessionsAtClose"]}, {r["shut"]["lanesAtClose"]})' if r["shut"] else "no record")
print("| | observer off | observer on |")
print("| --- | --- | --- |")
for r in rows:
    print("| " + " | ".join(str(x) for x in r) + " |")

if "on" in runs:
    o = runs["on"]["w"]["observerWork"]
    r = runs["on"]
    print()
    print("| the observer's own work, switched on | proximity WebRTC | LiveKit room |")
    print("| --- | --- | --- |")
    lane_sent = r["lane"]["measured"]["sent"] * 20
    room_sent = r["room"]["measured"]["sent"] * 10
    print(f'| audio sent to be heard, s | {lane_sent / 1000:.0f} | {room_sent / 1000:.0f} |')
    print(f'| handed to the observer by the sessions, s (share of sent) | {o["offeredMs"]["lane"] / 1000:.0f} ({100 * o["offeredMs"]["lane"] / lane_sent:.1f}%) | {o["offeredMs"]["room"] / 1000:.0f} ({100 * o["offeredMs"]["room"] / room_sent:.1f}%) |')
    print(f'| answered and kept, s (share of handed over) | {o["acceptedMs"]["lane"] / 1000:.0f} ({100 * o["coverage"]["lane"]:.2f}%) | {o["acceptedMs"]["room"] / 1000:.0f} ({100 * o["coverage"]["room"]:.2f}%) |')
    for path in ("lane", "room"):
        b = o["besideTodaysGate"][path]
    print(f'| today\'s gate said "speaking" | {o["besideTodaysGate"]["lane"]["todaysGateSaidSpeaking"]} | {o["besideTodaysGate"]["room"]["todaysGateSaidSpeaking"]} |')
    print(f'| the observer\'s rule fired | {o["besideTodaysGate"]["lane"]["observerFirings"]} | {o["besideTodaysGate"]["room"]["observerFirings"]} |')
    print(f'| the two within 600 ms of each other, same person | {o["besideTodaysGate"]["lane"]["within600msOfEachOther"]} | {o["besideTodaysGate"]["room"]["within600msOfEachOther"]} |')
    w = o["windows"]
    lost = o["lostMs"]
    print()
    print("| the observer's work, both paths | |")
    print("| --- | --- |")
    for label, value in [
        ("status at the end", o["status"]),
        ("windows the detector answered for", w["completed"]),
        ("of them: kept / thrown away because the person was no longer heard / thrown away because their stream had started afresh / too old by the clock", f'{w["accepted"]} / {w["revoked"]} / {w["stale"]} / {w["expired"]}'),
        ("windows in calls that failed", w["failed"]),
        ("calls to the detector; people per call mean / most; call mean / max, ms", f'{o["calls"]}; {o["meanPeoplePerCall"]} / {o["mostPeopleInACall"]}; {o["meanCallMs"]} / {o["maxCallMs"]}'),
        ("age of a kept answer, from the window's newest sample, mean / max, ms", f'{o["meanAgeMs"]} / {o["maxAgeMs"]}'),
        ("age of a kept answer, from the window's oldest sample, max, ms (limit 400)", o["maxOldestSampleAgeMs"]),
        ("most audio waiting at once, everyone together, ms (limit 16000); most people watched; longest line for the detector", f'{o["peakQueuedMs"]}; {o["peakStreams"]}; {o["peakLine"]}'),
        ("audio let go without an answer, ms: observer's bounds / too old / last bit shorter than a window / person no longer heard / failed call / start afresh after missing audio", f'{lost["overflow"]} / {lost["expired"]} / {lost["idle"]} / {lost["revoked"]} / {lost["failed"]} / {lost["reset"]}'),
        ("deadline passed; switched itself off; errors; frames turned away after a session closed; people refused", f'{o["timedOut"]}; {o["gaveUp"]}; {o["errors"]}; {o["refusedAfterClose"]}; {o["streamsRefused"]}'),
        ("people's streams started / ended", f'{o["streamsStarted"]} / {o["streamsEnded"]}'),
        ("while a bot was speaking: audio observed, s; observer firings; times today's gate stopped the voice", f'{o["besideTodaysGate"]["acceptedSecondsWhileBotSpoke"]}; {o["besideTodaysGate"]["observerFiringsWhileBotSpoke"]}; {o["besideTodaysGate"]["todaysGateStoppedTheVoice"]}'),
        ("at the close: what the observer held just before, and after", f'{json.dumps(r["shut"]["observerAtClose"])} then {json.dumps(r["shut"]["observerAfterClose"])}' if r["shut"] else "no record"),
    ]:
        print(f"| {label} | {value} |")
