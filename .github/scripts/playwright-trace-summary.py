#!/usr/bin/env python3
"""Prints what each failed test's Playwright trace recorded, so a CI log says what the browser did.

For every trace.zip under the given folder (default tests/test-results): navigations, console errors and
warnings, requests to the sign-in endpoints, the actions that failed with their last log lines, and every
action, request and the last heartbeat in the half minute before the first failure. A frozen page's
hang-stack.txt (see tests/utils/hangStack.ts) is printed first. Each trace is a collapsed group in the job
log. Traces are only recorded on the first retry, so a test that passed when retried has one too.
"""
import glob
import io
import json
import os
import re
import sys
import zipfile

ROOT = sys.argv[1] if len(sys.argv) > 1 else "tests/test-results"
MAX_LINES = 250
HEARTBEAT = "[heartbeat]"
KEY_URLS = re.compile(r"/me\b|anonymLogin|logout|login-screen|openid|/connect/|/register|/verify", re.I)
NAVIGATIONS = ("goto", "reload", "goBack", "goForward")


def events_of(trace_path):
    with zipfile.ZipFile(trace_path) as archive:
        for name in archive.namelist():
            if not (name.endswith(".trace") or name.endswith(".network")):
                continue
            for raw in io.TextIOWrapper(archive.open(name), encoding="utf-8", errors="replace"):
                try:
                    yield json.loads(raw)
                except ValueError:
                    continue


def summarize(trace_path):
    actions = {}  # callId -> "method params"
    logs = {}  # callId -> last log messages
    rows = []  # (time, text)
    requests = []  # every other request, kept for the window before a failure
    steps = []  # every other action (clicks, fills, expects), kept for the window before a failure
    heartbeats = []  # when the page's main thread last ran (see tests/utils/hangStack.ts)
    for event in events_of(trace_path):
        kind = event.get("type")
        if kind == "before":
            params = event.get("params", {})
            label = event.get("method", "?")
            detail = params.get("url") or params.get("selector") or ""
            actions[event.get("callId")] = f"{label} {detail}".strip()
            if event.get("method") in NAVIGATIONS:
                rows.append((event.get("startTime", 0), f"action   {actions[event.get('callId')]}"))
            else:
                extra = params.get("key") or params.get("value") or params.get("text") or params.get("expression") or ""
                steps.append((event.get("startTime", 0), f"action   {event.get('apiName', label)} {detail} {str(extra)[:80]}".rstrip()))
        elif kind == "log":
            logs.setdefault(event.get("callId"), []).append(event.get("message", ""))
        elif kind == "after" and event.get("error"):
            call = event.get("callId")
            message = event["error"].get("message", "").splitlines()[0][:200] if event["error"].get("message") else ""
            rows.append((event.get("endTime", 0), f"FAILED   {actions.get(call, call)}: {message}"))
            for line in logs.get(call, [])[-6:]:
                rows.append((event.get("endTime", 0), f"         log: {line[:200]}"))
        elif kind == "console" and event.get("text") == HEARTBEAT:
            heartbeats.append(event.get("time", 0))
        elif kind == "console" and event.get("messageType") in ("error", "warning"):
            rows.append((event.get("time", 0), f"console  {event['messageType']}: {event.get('text', '')[:300]}"))
        elif kind == "event":
            method = str(event.get("method", ""))
            if any(word in method.lower() for word in ("navigat", "error", "crash", "close", "dialog", "frame")) or method == "page":
                rows.append((event.get("time", 0), f"event    {method} {json.dumps(event.get('params', {}))[:200]}"))
        elif kind == "resource-snapshot":
            snapshot = event.get("snapshot", {})
            request = snapshot.get("request", {})
            url = request.get("url", "")
            status = snapshot.get("response", {}).get("status")
            resource_type = snapshot.get("_resourceType", "")
            time = snapshot.get("_monotonicTime", 0)
            if resource_type == "document" or KEY_URLS.search(url):
                frame = "" if resource_type != "document" else f" ({snapshot.get('_frameref', 'frame')})"
                rows.append((time, f"request  {request.get('method', '')} {url[:160]} -> {status}{frame}"))
            else:
                requests.append((time, f"request  {resource_type} {request.get('method', '')} {url[:160]} -> {status}"))
    # Every request in the half minute before the first failure, so a hang shows what was in flight.
    first_failure = min((t for t, text in rows if text.startswith("FAILED")), default=None)
    if first_failure is not None:
        rows.extend((t, text) for t, text in requests if first_failure - 30000 <= t <= first_failure + 1000)
        rows.extend((t, text) for t, text in steps if first_failure - 30000 <= t <= first_failure + 1000)
        last_beat = max((t for t in heartbeats if t <= first_failure + 1000), default=None)
        if last_beat is not None:
            rows.append((last_beat, "heartbeat: the page's main thread last ran here"))
    rows.sort(key=lambda row: row[0] or 0)
    start = rows[0][0] if rows else 0
    return [f"{((t or 0) - (start or 0)) / 1000:8.1f}s {text}" for t, text in rows]


def main():
    for stack_path in sorted(glob.glob(os.path.join(ROOT, "**", "hang-stack.txt"), recursive=True)):
        print(f"::group::frozen page {os.path.relpath(os.path.dirname(stack_path), ROOT)}")
        with open(stack_path, encoding="utf-8", errors="replace") as stack_file:
            print(stack_file.read().rstrip())
        print("::endgroup::")
    traces = sorted(glob.glob(os.path.join(ROOT, "**", "trace.zip"), recursive=True))
    if not traces:
        print(f"No trace under {ROOT}.")
        return
    for trace_path in traces:
        print(f"::group::trace {os.path.relpath(os.path.dirname(trace_path), ROOT)}")
        try:
            lines = summarize(trace_path)
        except Exception as error:  # a broken zip must not hide the other traces
            lines = [f"could not read the trace: {error}"]
        if len(lines) > MAX_LINES:
            lines = lines[: MAX_LINES // 2] + [f"... {len(lines) - MAX_LINES} lines left out ..."] + lines[-MAX_LINES // 2 :]
        print("\n".join(lines) if lines else "nothing recorded")
        print("::endgroup::")


if __name__ == "__main__":
    main()
