#!/usr/bin/env bash
# Copies the two ONNX models from the pinned pipecat-ai wheel (so both engines run the SAME model files) and checks sha256.
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p models
PKG=../pipecat-engine/.venv/lib/python3.13/site-packages/pipecat
cp "$PKG/audio/vad/data/silero_vad.onnx" models/silero_vad.onnx
cp "$PKG/audio/turn/smart_turn/data/smart-turn-v3.2-cpu.onnx" models/smart-turn-v3.2-cpu.onnx
(cd models && sha256sum -c ../models.sha256)
