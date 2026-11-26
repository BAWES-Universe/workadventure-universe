"""Pipecat engine (engine B). One Python process, one asyncio loop, one Pipecat pipeline per human lane.
Usage: python -m engine.main --turn-end local|provider [--brain ws://127.0.0.1:8800] [--signaling ws://127.0.0.1:8700] [--stats-port 8811]"""
import argparse
import asyncio
import json
import logging
import os
import signal
import sys
import time

import websockets
from aiohttp import web
from loguru import logger as loguru_logger

from .bubble import Bubble
from .util import FakeTTS, now_ms, pct

log = logging.getLogger("engine")


class Engine:
    def __init__(self, a):
        self.turn_end = a.turn_end
        self.provider_silence_ms = a.provider_silence_ms
        self.emotion_stub = a.emotion_stub
        self.brain_url = a.brain
        self.engine_id = f"pipecat-{a.turn_end}-{os.getpid()}"
        self.tts = FakeTTS()
        self.counters: dict = {}
        self.failures: list[str] = []
        self.bubbles: dict[str, Bubble] = {}
        self.lags: list[float] = []
        self.barge_in_ms: list[float] = []
        self.window_start = time.time()
        self.window_cpu0 = time.process_time()
        self.hints: dict[tuple[str, str], dict] = {}

    # ----- signaling -----
    async def signaling_loop(self, url: str, stop: asyncio.Event):
        async with websockets.connect(f"{url}/engine", max_size=None, ping_interval=None) as ws:
            await ws.send(json.dumps({"type": "engine.hello", "engineId": self.engine_id, "kind": "pipecat", "turnEnd": self.turn_end}))
            log.warning("registered with signaling %s as %s", url, self.engine_id)
            async for raw in ws:
                m = json.loads(raw)
                if m["type"] == "offer":
                    asyncio.create_task(self._offer(ws, m))
                elif m["type"] == "fake.clip":
                    b = self.bubbles.get(m["sessionId"])
                    ln = b.lanes.get(m["participantId"]) if b else None
                    if ln:
                        ln.hint = {"clipId": m["clipId"], "text": m.get("text")}
                    else:
                        self.hints[(m["sessionId"], m["participantId"])] = {"clipId": m["clipId"], "text": m.get("text")}
                elif m["type"] == "hangup":
                    b = self.bubbles.get(m["sessionId"])
                    ln = b.lanes.get(m["participantId"]) if b else None
                    if ln:
                        await b.lane_gone(ln, "left")

    async def _offer(self, ws, m):
        try:
            sid = m["sessionId"]
            b = self.bubbles.get(sid)
            if b is None or b.closing:
                b = self.bubbles[sid] = Bubble(self, sid, m.get("bubbleId", sid))
            answer = await b.add_lane(m["participantId"], m["lane"], m["sdp"])
            ln = b.lanes[m["participantId"]]
            h = self.hints.pop((sid, m["participantId"]), None)
            if h:
                ln.hint = h
            await ws.send(json.dumps({"type": "answer", "reqId": m["reqId"], "sdp": answer["sdp"]}))
        except Exception as e:  # noqa: BLE001
            self.counters["offer_failures"] = self.counters.get("offer_failures", 0) + 1
            self.failures.append(f"offer: {type(e).__name__}: {e}")
            log.exception("offer failed")
            await ws.send(json.dumps({"type": "error", "reqId": m["reqId"], "message": str(e)}))

    # ----- stats / health -----
    async def lag_probe(self):
        """Event-loop delay: how late a 20 ms sleep wakes up."""
        while True:
            t = time.perf_counter()
            await asyncio.sleep(0.02)
            self.lags.append((time.perf_counter() - t - 0.02) * 1000)
            if len(self.lags) > 200000:
                del self.lags[:100000]

    @staticmethod
    def _clean(o):
        if isinstance(o, float) and (o != o or o in (float("inf"), float("-inf"))):
            return None
        if isinstance(o, dict):
            return {k: Engine._clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [Engine._clean(v) for v in o]
        return o

    def stats(self, reset=False) -> dict:
        wall = time.time() - self.window_start
        cpu = time.process_time() - self.window_cpu0
        lanes = [{"sid": b.sid, "pid": ln.pid, "healthy": ln.healthy(), "gone": ln.gone, "mode": ln.mode} for b in self.bubbles.values() for ln in b.lanes.values()]
        rss = int(open("/proc/self/status").read().split("VmRSS:")[1].split()[0]) / 1024
        out = {
            "engineId": self.engine_id, "kind": "pipecat", "turnEnd": self.turn_end, "pid": os.getpid(), "windowSeconds": wall,
            "cpuSeconds": cpu, "cpuPctOfOneCore": 100 * cpu / wall if wall else 0, "rssMb": rss,
            "loopLagMs": {"n": len(self.lags), "p50": pct(self.lags, 50), "p95": pct(self.lags, 95), "p99": pct(self.lags, 99), "max": max(self.lags) if self.lags else 0},
            "bargeInStopMs": {"n": len(self.barge_in_ms), "p50": pct(self.barge_in_ms, 50), "p95": pct(self.barge_in_ms, 95)},
            "counters": dict(self.counters), "failures": list(self.failures), "lanes": lanes,
            "smartTurn": [{"lane": ln.pid, "log": ln.smart_turn_log[-50:]} for b in self.bubbles.values() for ln in b.lanes.values() if ln.smart_turn_log],
        }
        if reset:
            self.lags.clear(); self.barge_in_ms.clear()
            self.window_start, self.window_cpu0 = time.time(), time.process_time()
            self.counters_at_reset = dict(self.counters)
        return self._clean(out)


async def amain(a):
    loguru_logger.remove()
    loguru_logger.add(sys.stderr, level="ERROR")
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    eng = Engine(a)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for s in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(s, stop.set)

    async def h_stats(req):
        return web.json_response(eng.stats(reset=req.query.get("reset") == "1"), dumps=lambda o: json.dumps(o, default=str, allow_nan=False))

    app = web.Application()
    app.add_routes([web.get("/stats", h_stats), web.get("/healthz", lambda r: web.json_response({"ok": True}))])
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", a.stats_port).start()
    tasks = [asyncio.create_task(eng.lag_probe(), name="lag"), asyncio.create_task(eng.signaling_loop(a.signaling, stop), name="signaling")]
    log.warning("pipecat engine up: turn-end=%s stats=:%d", a.turn_end, a.stats_port)
    waiter = asyncio.create_task(stop.wait())
    done, _ = await asyncio.wait([waiter, *tasks], return_when=asyncio.FIRST_COMPLETED)
    rc = 0
    for t in done:
        if t is not waiter and t.exception():
            log.error("task %s died: %r", t.get_name(), t.exception())
            rc = 1
    for b in list(eng.bubbles.values()):
        await b.close()
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await runner.cleanup()
    return rc


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--turn-end", choices=["local", "provider"], required=True)
    p.add_argument("--provider-silence-ms", type=int, default=500)
    p.add_argument("--brain", default="ws://127.0.0.1:8800")
    p.add_argument("--signaling", default="ws://127.0.0.1:8700")
    p.add_argument("--emotion-stub", action="store_true", help="add the loudness-based emotion stub to user.turn")
    p.add_argument("--stats-port", type=int, default=8811)
    p.add_argument("--vad-min-volume", type=float, default=None, help="documented VADParams.min_volume (pipecat default 0.6); only used for the talk-over latency experiment")
    a = p.parse_args()
    if a.vad_min_volume is not None:
        from engine import lane as _lane
        _lane.VAD_PARAMS["min_volume"] = a.vad_min_volume
    sys.exit(asyncio.run(amain(a)))


if __name__ == "__main__":
    main()
