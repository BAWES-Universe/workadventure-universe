"""Reference side of the Smart Turn feature parity test. Uses Pipecat's own code (compute_whisper_log_mel_features and the ONNX model
through LocalSmartTurnAnalyzerV3._predict_endpoint). Writes /tmp/parity/cases.json plus one raw float32 feature file per case.
Run: pipecat-engine/.venv/bin/python pipecat-engine/tools/parity_ref.py"""
import json, sys, wave
from pathlib import Path

import numpy as np
from loguru import logger
logger.remove()
from pipecat.audio.turn.smart_turn._whisper_features import compute_whisper_log_mel_features
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3

ROOT = Path(__file__).resolve().parents[2]
OUT = Path("/tmp/parity"); OUT.mkdir(exist_ok=True)
M = json.loads((ROOT / "clips/manifest.json").read_text())
an = LocalSmartTurnAnalyzerV3()
rng = np.random.default_rng(1)
cases = []
def add(cid, name, audio):
    audio = audio.astype(np.float32)
    n = 128000
    a = audio[-n:] if len(audio) > n else np.pad(audio, (n - len(audio), 0))
    feats = compute_whisper_log_mel_features(a, do_normalize=True)
    res = an._predict_endpoint(audio)
    f = OUT / f"{len(cases):03d}.f32"; feats.astype(np.float32).tofile(f)
    af = OUT / f"{len(cases):03d}.audio.f32"; audio.tofile(af)
    cases.append({"case": f"{cid}:{name}", "clip": cid, "name": name, "samples": int(len(audio)), "featureFile": str(f), "audioFile": str(af), "probability": float(res["probability"]), "prediction": int(res["prediction"])})
for cid, c in M["clips"].items():
    if cid == "en_yes": continue
    w = wave.open(str(ROOT / "clips" / c["file"])); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768.0
    s, e = c["speechStartMs"] * 16, c["speechEndMs"] * 16
    sil = lambda ms: np.zeros(int(ms * 16), np.float32)
    add(cid, "speech_end+0", x[:e])
    add(cid, "speech_end+200ms_silence", np.concatenate([x[:e], sil(200)]))
    add(cid, "speech_end+1000ms_silence", np.concatenate([x[:e], sil(1000)]))
    add(cid, "mid_speech_cut", x[: s + (e - s) // 2])
    add(cid, "cut_300ms_before_end", x[: max(s + 1600, e - 4800)])
# 8 s windows from the 30 s bot-voice recording (resampled 24k->16k), a different speaker and mixed content
w = wave.open(str(ROOT / "clips/bot-voice-24k.wav")); bv = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768.0
bv16 = bv[::3 * 1][: len(bv) // 3 * 2] if False else np.interp(np.arange(0, len(bv) - 1, 1.5), np.arange(len(bv)), bv).astype(np.float32)
for i in range(6):
    st = int(rng.integers(0, len(bv16) - 128000)); add("botvoice", f"window_{i}", bv16[st: st + int(rng.integers(30000, 128000))])
(OUT / "cases.json").write_text(json.dumps(cases, indent=1))
print("cases", len(cases), "complete", sum(c["prediction"] for c in cases))
