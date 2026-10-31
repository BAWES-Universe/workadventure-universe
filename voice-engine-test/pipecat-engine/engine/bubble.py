"""A bubble = one session = one bot, one or more human lanes. Owns the bridge socket, bot speech and the mode/voice state.
Pipecat has no such thing (one pipeline = one caller), so this file is our own glue."""
import asyncio
import logging
import time

from .bridge import Bridge
from .lane import Lane
from .util import FRAME_MS, FakeTTS, now_ms

log = logging.getLogger("bubble")
GRACE_S = 8.0
MODES = {"off", "listen_only", "talk", "type_and_listen", "speak_and_read"}


class Segment:
    def __init__(self, sid: str, text: str):
        self.sid, self.text = sid, text
        self.total_ms = 0
        self.played_ms = 0
        self.delivered_all = True


class BotSpeaker:
    """Paces fake TTS audio at 1x in 20 ms chunks (960 bytes at 24 kHz mono s16) and fans it out to every lane that plays audio."""

    def __init__(self, bubble: "Bubble"):
        self.b = bubble
        self.queue: list[Segment] = []
        self.current: Segment | None = None
        self.speaking = False
        self._wake = asyncio.Event()
        self._cancel_cur = False
        self._task = asyncio.create_task(self._run(), name=f"speaker-{bubble.sid}")

    def enqueue(self, seg: Segment):
        self.queue.append(seg)
        self._wake.set()

    def retract(self, sid: str):
        for s in list(self.queue):
            if s.sid == sid:
                self.queue.remove(s)
                return s, "queued"
        if self.current and self.current.sid == sid:
            self._cancel_cur = True
            return self.current, "playing"
        return None, "unknown"

    def stop_current(self):
        if self.speaking:
            self._cancel_cur = True

    async def _run(self):
        tts: FakeTTS = self.b.engine.tts
        c = self.b.engine.counters
        while True:
            while not self.queue:
                self._wake.clear()
                await self._wake.wait()
            seg = self.queue.pop(0)
            self.current, self.speaking, self._cancel_cur = seg, True, False
            pcm = tts.synth(seg.text)
            seg.total_ms = len(pcm) // tts.chunk * FRAME_MS
            c["tts_generated_ms"] = c.get("tts_generated_ms", 0) + seg.total_ms
            c["segments_started"] = c.get("segments_started", 0) + 1
            t0 = time.monotonic()
            k = 0
            reason, interrupted = "completed", False
            last_prog = t0
            try:
                for i in range(0, len(pcm), tts.chunk):
                    if self._cancel_cur or not self.b.should_continue():
                        interrupted = True
                        reason = self.b.stop_reason or ("voice_stop" if self.b.voice != "active" else "mode")
                        break
                    targets = [ln for ln in self.b.lanes.values() if ln.plays() and ln.bridge_proc and not ln.gone]
                    if targets:
                        chunk = pcm[i:i + tts.chunk]
                        assert len(chunk) == tts.chunk
                        await asyncio.gather(*[ln.bridge_proc.play(chunk) for ln in targets])
                        seg.played_ms += FRAME_MS
                    else:
                        seg.delivered_all = False
                    k += 1
                    if time.monotonic() - last_prog > 0.5:
                        last_prog = time.monotonic()
                        await self.b.bridge.send("playback.progress", segmentId=seg.sid, playedMs=seg.played_ms, totalMs=seg.total_ms, finished=False, interrupted=False)
                    delay = t0 + k * FRAME_MS / 1000 - time.monotonic()
                    if delay > 0:
                        await asyncio.sleep(delay)
            finally:
                self.speaking = False
                self.current = None
            if interrupted:
                c["segments_cancelled"] = c.get("segments_cancelled", 0) + 1
                c["tts_cancelled_ms"] = c.get("tts_cancelled_ms", 0) + (seg.total_ms - seg.played_ms)
            else:
                c["segments_completed"] = c.get("segments_completed", 0) + 1
                if not seg.delivered_all:
                    reason = "lane_loss"
            c["tts_played_ms"] = c.get("tts_played_ms", 0) + seg.played_ms
            await self.b.bridge.send("playback.progress", segmentId=seg.sid, playedMs=seg.played_ms, totalMs=seg.total_ms, finished=True, interrupted=interrupted, reason=reason)
            self.b.stop_reason = None


class Bubble:
    def __init__(self, engine, sid: str, bubble_id: str):
        self.engine, self.sid, self.bubble_id = engine, sid, bubble_id
        self.turn_end = engine.turn_end
        self.default_mode = "talk"
        self.voice = "active"
        self.lanes: dict[str, Lane] = {}
        self.bridge = Bridge(f"{engine.brain_url}/bridge", sid, self.on_brain, engine.counters)
        self.speaker: BotSpeaker | None = None
        self.stop_reason: str | None = None
        self.started = False
        self.closing = False
        self.grace: asyncio.Task | None = None
        self._status_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self.segments: dict[str, Segment] = {}

    # ----- lanes -----
    async def add_lane(self, pid: str, idx: int, sdp: str) -> dict:
        async with self._lock:
            if self.grace:
                self.grace.cancel()
                self.grace = None
            if not self.started:
                await self.bridge.connect()
                self.speaker = BotSpeaker(self)
                self.started = True
                await self.bridge.send("session.start", bubbleId=self.bubble_id, participants=[{"participantId": pid, "lane": idx}], mode=self.default_mode,
                                       engine={"id": self.engine.engine_id, "kind": "pipecat", "turnEnd": self.turn_end})
                self._status_task = asyncio.create_task(self._status_loop(), name=f"status-{self.sid}")
            old = self.lanes.get(pid)
            rejoin = old is not None
            if old:
                await old.stop()
            lane = Lane(self, pid, idx)
            if old:
                lane.mode = old.mode
            self.lanes[pid] = lane
            answer = await lane.start(sdp)
            await self.bridge.send("participant.join", participantId=pid, lane=idx, rejoin=rejoin)
            return answer

    async def lane_gone(self, lane: Lane, reason: str):
        if lane.gone or self.closing:
            return
        lane.gone = True
        await self.bridge.send("participant.leave", participantId=lane.pid, lane=lane.idx, reason=reason)
        asyncio.create_task(lane.stop())
        if all(ln.gone for ln in self.lanes.values()):
            self.grace = asyncio.create_task(self._grace(), name=f"grace-{self.sid}")

    async def _grace(self):
        await asyncio.sleep(GRACE_S)
        await self.close()

    def should_continue(self) -> bool:
        """Keep speaking while voice is active and, if anyone is connected, at least one connected lane plays audio."""
        if self.voice != "active":
            return False
        live = [ln for ln in self.lanes.values() if not ln.gone]
        return not live or any(ln.plays() for ln in live)

    # ----- speech control -----
    async def barge_in(self, src: Lane):
        """Local, no round trip to the brain. Stops bot audio on every lane."""
        if not self.speaker or not (self.speaker.speaking or self.speaker.queue):
            return
        t = time.monotonic()
        self.stop_reason = "barge_in"
        self.speaker.stop_current()
        queued, self.speaker.queue = self.speaker.queue, []
        await asyncio.gather(*[ln.interrupt() for ln in self.lanes.values() if not ln.gone])
        for s in queued:
            await self.bridge.send("playback.progress", segmentId=s.sid, playedMs=0, totalMs=0, finished=True, interrupted=True, reason="barge_in")
            self.engine.counters["segments_cancelled"] = self.engine.counters.get("segments_cancelled", 0) + 1
        self.engine.counters["barge_ins"] = self.engine.counters.get("barge_ins", 0) + 1
        self.engine.barge_in_ms.append((time.monotonic() - t) * 1000)

    async def stop_voice(self, reason: str):
        self.voice = "stopped"
        self.stop_reason = "voice_stop"
        if self.speaker:
            self.speaker.stop_current()
            queued, self.speaker.queue = self.speaker.queue, []
            for s in queued:
                await self.bridge.send("playback.progress", segmentId=s.sid, playedMs=0, totalMs=0, finished=True, interrupted=True, reason="voice_stop")
        await asyncio.gather(*[ln.interrupt() for ln in self.lanes.values() if not ln.gone])
        await self.send_status()

    # ----- brain messages -----
    async def on_brain(self, m: dict):
        t = m.get("type")
        c = self.engine.counters
        if t == "bot.say":
            sid = m.get("segmentId")
            if m.get("committed") is not True or not isinstance(m.get("text"), str) or not m["text"]:
                c["say_rejected"] = c.get("say_rejected", 0) + 1
                await self.bridge.send("playback.progress", segmentId=sid or "?", playedMs=0, totalMs=0, finished=True, interrupted=False, reason="rejected")
                return
            if self.voice != "active":
                c["say_rejected"] = c.get("say_rejected", 0) + 1
                await self.bridge.send("playback.progress", segmentId=sid, playedMs=0, totalMs=0, finished=True, interrupted=False, reason="rejected")
                return
            seg = Segment(sid, m["text"])
            self.segments[sid] = seg
            self.speaker.enqueue(seg)
        elif t == "bot.retract":
            seg, where = self.speaker.retract(m.get("segmentId"))
            if where == "queued":
                await self.bridge.send("playback.progress", segmentId=seg.sid, playedMs=0, totalMs=0, finished=True, interrupted=True, reason="retract")
            elif where == "playing":
                self.stop_reason = "retract"
                for ln in self.lanes.values():
                    await ln.interrupt()
        elif t == "mode.set":
            mode = m.get("mode")
            if mode not in MODES:
                return
            pid = m.get("participantId")
            targets = [self.lanes[pid]] if pid in self.lanes else ([] if pid else list(self.lanes.values()))
            if not pid:
                self.default_mode = mode
            for ln in targets:
                was_plays = ln.plays()
                ln.mode = mode
                if was_plays and not ln.plays():
                    await ln.interrupt()
            if self.speaker and self.speaker.speaking and not any(ln.plays() for ln in self.lanes.values()):
                self.stop_reason = "mode"
                self.speaker.stop_current()
            await self.send_status()
        elif t == "voice.stop":
            await self.stop_voice(m.get("reason", "other"))
        elif t == "session.end":
            await self.close()

    async def send_status(self):
        await self.bridge.send(
            "engine.status", engineId=self.engine.engine_id, voice=self.voice, mode=self.default_mode,
            lanes=[{"participantId": ln.pid, "lane": ln.idx, "healthy": ln.healthy(), "mode": ln.mode} for ln in self.lanes.values() if not ln.gone],
            counters={k: v for k, v in self.engine.counters.items() if isinstance(v, (int, float))},
        )

    async def _status_loop(self):
        while not self.closing:
            await asyncio.sleep(1.0)
            await self.send_status()

    async def close(self):
        if self.closing:
            return
        self.closing = True
        for t in (self._status_task, self.grace):
            if t and t is not asyncio.current_task():
                t.cancel()
        if self.speaker:
            self.speaker._task.cancel()
        await asyncio.gather(*[ln.stop() for ln in self.lanes.values()], return_exceptions=True)
        await self.bridge.close()
        self.engine.bubbles.pop(self.sid, None)
