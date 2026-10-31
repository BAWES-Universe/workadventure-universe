"""Optional "emotion from audio" step (STUB). Plugs in after the turn processor: it sees the person's raw audio frames for the turn and, at the
turn end, attaches {label, confidence, source:"stub"} to the user.turn that LaneBridge sends. The label comes from loudness only.
No model, no download. A real model would replace `label_for` and nothing else."""
import numpy as np
from pipecat.frames.frames import Frame, InputAudioRawFrame, UserStartedSpeakingFrame, UserStoppedSpeakingFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

MAX_SAMPLES = 16000 * 30


def label_for(pcm16k: np.ndarray) -> dict:
    """Same rule as ts-engine/src/emotion.ts. Mean level of the active 20 ms frames, in dBFS."""
    n = len(pcm16k) // 320 * 320
    if n == 0:
        return {"label": "neutral", "confidence": 0.0, "source": "stub"}
    f = pcm16k[:n].astype(np.float64).reshape(-1, 320) / 32768.0
    db = 10 * np.log10((f * f).mean(axis=1) + 1e-12)
    act = db[db > -45]
    m = float(act.mean()) if len(act) else -90.0
    if m >= -16:
        return {"label": "excited", "confidence": round(min(1.0, 0.5 + (m + 16) / 10), 3), "source": "stub"}
    if m <= -28:
        return {"label": "calm", "confidence": round(min(1.0, 0.5 + (-28 - m) / 10), 3), "source": "stub"}
    return {"label": "neutral", "confidence": 0.5, "source": "stub"}


class EmotionStub(FrameProcessor):
    def __init__(self, lane, **kw):
        super().__init__(**kw)
        self.lane, self._buf, self._on = lane, [], False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, UserStartedSpeakingFrame):
            self._buf, self._on = [], True
        elif isinstance(frame, InputAudioRawFrame) and self._on and sum(len(b) for b in self._buf) < MAX_SAMPLES * 2:
            self._buf.append(frame.audio)
        elif isinstance(frame, UserStoppedSpeakingFrame) and self._on:
            self._on = False
            self.lane.emotion = label_for(np.frombuffer(b"".join(self._buf), dtype=np.int16))
            self._buf = []
        await self.push_frame(frame, direction)
