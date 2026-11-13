"""Shared helpers: clock, manifest, audio maths, fake TTS."""
import hashlib
import json
import time
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]  # voice-engine-test/
FRAME_MS = 20
TTS_RATE = 24000
MS_PER_CHAR = 65  # fake TTS: audio length scales with text length


def now_ms() -> float:
    return time.time() * 1000.0


def frame_bytes(sample_rate: int, channels: int, bytes_per_sample: int, ms: int) -> int:
    """Chunk size = rate x channels x sample width x duration (rule 5 in PROTOCOL.md)."""
    return round(sample_rate * channels * bytes_per_sample * ms / 1000)


def manifest() -> dict:
    return json.loads((ROOT / "clips" / "manifest.json").read_text(encoding="utf-8"))


class FakeTTS:
    """Fake TTS: slices real recorded speech (not tones). Length = 65 ms per character, whole 20 ms frames.
    Same file, same slicing rule as the TypeScript engine, so both engines say the same audio."""

    def __init__(self) -> None:
        m = manifest()["botVoice"]
        p = ROOT / "clips" / m["file"]
        if hashlib.sha256(p.read_bytes()).hexdigest() != m["sha256"]:
            raise RuntimeError("bot voice checksum mismatch")
        with wave.open(str(p)) as w:
            assert w.getframerate() == TTS_RATE and w.getnchannels() == 1 and w.getsampwidth() == 2
            self.pcm = w.readframes(w.getnframes())
        self.chunk = frame_bytes(TTS_RATE, 1, 2, FRAME_MS)  # 960 bytes. Never 1920.

    def duration_ms(self, text: str) -> int:
        return max(400, round(MS_PER_CHAR * len(text) / FRAME_MS) * FRAME_MS)

    def synth(self, text: str) -> bytes:
        n = self.duration_ms(text) // FRAME_MS * self.chunk
        h = int(hashlib.sha1(text.encode("utf-8")).hexdigest()[:8], 16)
        start = (h % (len(self.pcm) // 2)) * 2
        buf = self.pcm[start:] + self.pcm
        while len(buf) < n:
            buf += self.pcm
        return buf[:n]


def pct(xs, p):
    if not xs:
        return float("nan")
    s = sorted(xs)
    return s[min(len(s) - 1, max(0, int(np.ceil(p / 100 * len(s))) - 1))]
