"""Fake STT as a Pipecat processor. Returns the manifest transcript of the clip the load generator says it is playing.
It never looks at the audio. Interim text grows word by word while the person speaks.
Two turn-end sources:
  local    -> final transcript right after VAD stop; Smart Turn (in the UserTurnProcessor) decides the turn end.
  provider -> after `provider_silence_ms` of silence the fake provider says "end of turn"
              (final transcript + ProposedUserStoppedSpeakingFrame). No Smart Turn.
"""
import asyncio
import datetime

from pipecat.frames.frames import (
    Frame,
    InterimTranscriptionFrame,
    ProposedUserStoppedSpeakingFrame,
    TranscriptionFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from .util import manifest

_M = None


def clip_info(hint: dict | None) -> tuple[str, float]:
    global _M
    if _M is None:
        _M = manifest()["clips"]
    if not hint:
        return "[no clip hint]", 3000.0
    c = _M.get(hint.get("clipId"))
    text = hint.get("text") or (c["transcript"] if c else "[unknown clip]")
    return text, float(c["durationMs"] if c else 3000)


class FakeSTT(FrameProcessor):
    def __init__(self, lane, turn_end: str, provider_silence_ms: int, counters: dict, **kw):
        super().__init__(**kw)
        self.lane, self.turn_end, self.silence_ms, self.c = lane, turn_end, provider_silence_ms, counters
        self._partial: asyncio.Task | None = None
        self._eot: asyncio.Task | None = None

    def _ts(self) -> str:
        return datetime.datetime.now(datetime.timezone.utc).isoformat()

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)
        if isinstance(frame, VADUserStartedSpeakingFrame):
            self._cancel(self._eot)
            self._cancel(self._partial)
            self._partial = self.create_task(self._partials(), f"{self}-partials")
        elif isinstance(frame, VADUserStoppedSpeakingFrame):
            self._cancel(self._partial)
            text, _ = clip_info(self.lane.hint)
            if self.turn_end == "local":
                await self.push_frame(TranscriptionFrame(text=text, user_id=self.lane.pid, timestamp=self._ts(), finalized=True))
            else:
                wait = max(0.0, self.silence_ms / 1000.0 - frame.stop_secs)
                self._eot = self.create_task(self._provider_eot(wait, text), f"{self}-eot")

    @staticmethod
    def _cancel(t):
        if t and not t.done():
            t.cancel()

    async def _partials(self):
        text, dur = clip_info(self.lane.hint)
        words = text.split()
        t0 = asyncio.get_running_loop().time()
        while len(words) > 1:
            await asyncio.sleep(0.3)
            k = min(len(words) - 1, max(1, int(len(words) * (asyncio.get_running_loop().time() - t0) * 1000 / dur)))
            await self.push_frame(InterimTranscriptionFrame(text=" ".join(words[:k]), user_id=self.lane.pid, timestamp=self._ts()))
            self.c["stt_partials"] = self.c.get("stt_partials", 0) + 1

    async def _provider_eot(self, wait: float, text: str):
        await asyncio.sleep(wait)
        await self.push_frame(TranscriptionFrame(text=text, user_id=self.lane.pid, timestamp=self._ts(), finalized=True))
        await self.push_frame(ProposedUserStoppedSpeakingFrame())
        self.c["stt_provider_eot"] = self.c.get("stt_provider_eot", 0) + 1
