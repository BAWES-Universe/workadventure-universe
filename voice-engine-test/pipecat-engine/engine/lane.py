"""One human = one lane = one Pipecat pipeline with its own SmallWebRTC connection.
Pipecat is built for one bot and one caller per pipeline. A bubble with several humans is therefore several pipelines
(one per lane) that share a Bubble object (bot speech, mode, voice state). See bubble.py."""
import asyncio
import logging
import time

import numpy as np
from pipecat.audio.turn.smart_turn.base_smart_turn import SmartTurnParams
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    InterimTranscriptionFrame,
    InterruptionFrame,
    MetricsFrame,
    OutputAudioRawFrame,
    TranscriptionFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.turns.user_start import VADUserTurnStartStrategy
from pipecat.turns.user_stop import ExternalUserTurnStopStrategy, TurnAnalyzerUserTurnStopStrategy
from pipecat.turns.user_turn_processor import UserTurnProcessor
from pipecat.turns.user_turn_strategies import UserTurnStrategies

from .fakes import FakeSTT
from .util import FRAME_MS, TTS_RATE, now_ms

log = logging.getLogger("lane")

# Pinned settings (the "strategy settings" the J6.3 review asked to pin)
VAD_PARAMS = dict(confidence=0.7, start_secs=0.2, stop_secs=0.2, min_volume=0.6)  # pipecat defaults, written out
SMART_TURN = dict(stop_secs=3.0, pre_speech_ms=500.0, max_duration_secs=8.0)       # pipecat defaults, written out
USER_TURN_STOP_TIMEOUT = 5.0                                                        # pipecat default, written out


def make_strategies(turn_end: str) -> UserTurnStrategies:
    start = [VADUserTurnStartStrategy()]  # enable_interruptions defaults to True
    if turn_end == "local":
        stop = [TurnAnalyzerUserTurnStopStrategy(turn_analyzer=LocalSmartTurnAnalyzerV3(params=SmartTurnParams(**SMART_TURN)), wait_for_transcript=True)]
    else:
        stop = [ExternalUserTurnStopStrategy(timeout=0.5, wait_for_transcript=True)]
    return UserTurnStrategies(start=start, stop=stop)


class DropProbe(FrameProcessor):
    """Counts input frames, finds RTP timestamp gaps (= audio that never arrived) and gates the mic by mode / voice state."""

    def __init__(self, lane, counters, **kw):
        super().__init__(**kw)
        self.lane, self.c = lane, counters
        self._last_pts: int | None = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, InputAudioRawFrame):
            c = self.c
            c["frames_in"] = c.get("frames_in", 0) + 1
            c["bytes_in"] = c.get("bytes_in", 0) + len(frame.audio)
            self.lane.last_frame_at = time.monotonic()
            pts = getattr(frame, "pts", None)
            if pts is not None:
                if self._last_pts is not None:
                    gap = (pts - self._last_pts) / 48.0 - FRAME_MS  # pts is in 48 kHz ticks
                    if gap > FRAME_MS * 0.5:
                        self.lane.dropped.append((now_ms(), gap))
                        c["dropped_audio_ms"] = c.get("dropped_audio_ms", 0) + gap
                self._last_pts = pts
            if not self.lane.listening():
                if not self.lane.turn_open:
                    c["frames_gated"] = c.get("frames_gated", 0) + 1
                    return
                frame.audio = bytes(len(frame.audio))  # let VAD and the turn analyzer close the open turn with silence
        await self.push_frame(frame, direction)


class LaneBridge(FrameProcessor):
    """Sits after the turn processor. Turns Pipecat events into bridge messages, hosts bot audio output, implements barge-in."""

    def __init__(self, lane, counters, **kw):
        super().__init__(**kw)
        self.lane, self.c = lane, counters

    async def play(self, pcm: bytes):
        self.c["audio_out_chunks"] = self.c.get("audio_out_chunks", 0) + 1
        self.c["audio_out_bytes"] = self.c.get("audio_out_bytes", 0) + len(pcm)
        await self.push_frame(OutputAudioRawFrame(audio=pcm, sample_rate=TTS_RATE, num_channels=1))

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        lane, b = self.lane, self.lane.bubble
        if isinstance(frame, UserStartedSpeakingFrame):
            lane.turn_open = True
            lane.turn_seq += 1
            lane.turn_id = f"{lane.pid}-t{lane.turn_seq}"
            lane.speech_started_at = now_ms()
            lane.metrics = None
            self.c["vad_starts"] = self.c.get("vad_starts", 0) + 1
            if lane.listening():
                was = b.speaker.speaking
                await b.bridge.send("user.speech_started", lane=lane.idx, participantId=lane.pid, whileBotSpeaking=was, turnId=lane.turn_id)
                if was:
                    await b.barge_in(lane)
        elif isinstance(frame, InterruptionFrame):
            await b.barge_in(lane)
        elif isinstance(frame, InterimTranscriptionFrame):
            if lane.listening() and lane.turn_open:
                await b.bridge.send("user.turn", lane=lane.idx, participantId=lane.pid, turnId=lane.turn_id, text=frame.text, partial=True, droppedAudioMs=lane.dropped_ms_since(lane.speech_started_at))
        elif isinstance(frame, MetricsFrame):
            for d in frame.data:
                if getattr(d, "processor", "") == "BaseSmartTurn":
                    lane.metrics = d
                    lane.smart_turn_log.append((lane.turn_id, bool(d.is_complete), float(d.probability), float(d.e2e_processing_time_ms)))
        elif isinstance(frame, TranscriptionFrame):
            lane.final_text = frame.text
        elif isinstance(frame, UserStoppedSpeakingFrame):
            was_open, lane.turn_open = lane.turn_open, False
            if was_open and lane.listening() and lane.final_text is not None:
                dropped = lane.dropped_ms_since(lane.speech_started_at)
                if b.turn_end == "provider":
                    reason = "provider_eot"
                else:
                    reason = "smart_turn" if (lane.metrics is not None and lane.metrics.is_complete) else "stop_secs_timeout"
                await b.bridge.send(
                    "user.turn", lane=lane.idx, participantId=lane.pid, turnId=lane.turn_id, text=lane.final_text, partial=False,
                    droppedAudioMs=dropped, incomplete=dropped > 0, speechMs=round(now_ms() - lane.speech_started_at), endReason=reason,
                    speechStartedAt=lane.speech_started_at, turnEndedAt=now_ms(),
                )
                self.c["turns_final"] = self.c.get("turns_final", 0) + 1
            lane.final_text = None
        await self.push_frame(frame, direction)


class Lane:
    def __init__(self, bubble, pid: str, idx: int):
        self.bubble, self.pid, self.idx = bubble, pid, idx
        self.mode = bubble.default_mode
        self.hint: dict | None = None
        self.turn_open = False
        self.turn_seq = 0
        self.turn_id = ""
        self.speech_started_at = 0.0
        self.final_text: str | None = None
        self.metrics = None
        self.smart_turn_log: list = []
        self.dropped: list[tuple[float, float]] = []
        self.last_frame_at = time.monotonic()
        self.conn: SmallWebRTCConnection | None = None
        self.worker: PipelineWorker | None = None
        self.run_task: asyncio.Task | None = None
        self.bridge_proc: LaneBridge | None = None
        self.gone = False
        self.counters = bubble.engine.counters

    def listening(self) -> bool:
        return self.bubble.voice == "active" and self.mode in ("talk", "speak_and_read")

    def plays(self) -> bool:
        return self.bubble.voice == "active" and self.mode in ("talk", "listen_only", "type_and_listen")

    def healthy(self) -> bool:
        return (not self.gone) and self.conn is not None and self.conn.is_connected() and (time.monotonic() - self.last_frame_at) < 2.0

    def dropped_ms_since(self, t0: float) -> float:
        return round(sum(ms for (t, ms) in self.dropped if t >= t0 - 300))

    async def start(self, sdp: str) -> dict:
        eng = self.bubble.engine
        self.conn = SmallWebRTCConnection(ice_servers=None)
        await self.conn.initialize(sdp=sdp, type="offer")
        answer = self.conn.get_answer()
        transport = SmallWebRTCTransport(
            self.conn,
            TransportParams(audio_in_enabled=True, audio_out_enabled=True, audio_in_sample_rate=16000, audio_out_sample_rate=TTS_RATE, audio_in_channels=1, audio_out_channels=1),
        )
        self.bridge_proc = LaneBridge(self, self.counters)
        vad = VADProcessor(vad_analyzer=SileroVADAnalyzer(params=VADParams(**VAD_PARAMS)))
        procs = [
            transport.input(), DropProbe(self, self.counters), vad,
            FakeSTT(self, self.bubble.turn_end, eng.provider_silence_ms, self.counters),
            UserTurnProcessor(user_turn_strategies=make_strategies(self.bubble.turn_end), user_turn_stop_timeout=USER_TURN_STOP_TIMEOUT),
            self.bridge_proc, transport.output(),
        ]
        self.worker = PipelineWorker(Pipeline(procs), params=PipelineParams(audio_in_sample_rate=16000, audio_out_sample_rate=TTS_RATE), enable_rtvi=False, cancel_on_idle_timeout=False, check_dangling_tasks=False)
        runner = PipelineRunner(handle_sigint=False, check_dangling_tasks=False)
        self.run_task = asyncio.create_task(self._supervise(runner), name=f"lane-{self.pid}")
        for ev in ("closed", "failed"):
            self.conn.event_handler(ev)(self._on_conn_lost)
        self.conn.event_handler("disconnected")(self._on_disc)
        return answer

    async def _supervise(self, runner: PipelineRunner):
        """Every lane task is supervised: a crash is counted, reported to the brain and marks the engine run INVALID."""
        try:
            await runner.run(self.worker)
        except asyncio.CancelledError:
            raise
        except BaseException as e:  # noqa: BLE001
            self.counters["lane_failures"] = self.counters.get("lane_failures", 0) + 1
            self.bubble.engine.failures.append(f"lane {self.pid}: {type(e).__name__}: {e}")
            log.exception("lane %s failed", self.pid)
            await self.bubble.lane_gone(self, "failed")
        else:
            if not self.gone:  # pipeline ended while the lane was supposed to be alive
                self.counters["lane_early_exit"] = self.counters.get("lane_early_exit", 0) + 1
                self.bubble.engine.failures.append(f"lane {self.pid}: pipeline ended early")
                await self.bubble.lane_gone(self, "failed")

    async def _on_conn_lost(self, *_a):
        await self.bubble.lane_gone(self, "closed")

    async def _on_disc(self, *_a):
        async def later():
            await asyncio.sleep(4.0)
            if not self.gone and self.conn and not self.conn.is_connected():
                await self.bubble.lane_gone(self, "failed")
        asyncio.create_task(later())

    async def interrupt(self):
        if self.bridge_proc and self.worker:
            try:
                await self.bridge_proc.broadcast_interruption()
            except Exception:  # lane is shutting down
                pass

    async def stop(self):
        self.gone = True
        try:
            if self.worker:
                await self.worker.cancel()
        except Exception:
            pass
        if self.run_task and self.run_task is not asyncio.current_task():
            try:
                await asyncio.wait_for(self.run_task, 5)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                self.run_task.cancel()
        try:
            if self.conn:
                await self.conn.disconnect()
        except Exception:
            pass
