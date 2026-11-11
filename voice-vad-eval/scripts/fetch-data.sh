#!/usr/bin/env bash
# Downloads the pinned model and the test audio into ./data (about 1 GB). Nothing here is committed.
# Licences: Silero VAD MIT; MS-SNSD MIT; Arabic Speech Commands CC BY 4.0; Speech Commands (mini) CC BY 4.0.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data && cd data

curl -fsSL -o silero_vad_v6.2.3.onnx https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.onnx
echo "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3  silero_vad_v6.2.3.onnx" | sha256sum -c -

if [ ! -d ms-snsd ]; then
    git clone --filter=blob:none --no-checkout https://github.com/microsoft/MS-SNSD.git ms-snsd
    git -C ms-snsd sparse-checkout set --no-cone '/noise_test/' '/noise_train/' '/clean_test/' '/LICENSE' '/README.md'
    git -C ms-snsd checkout fe61c4ba0d9ac8dd7e23d719cc79f8947e1dc742
fi

if [ ! -d asc ]; then
    git clone --filter=blob:none --no-checkout https://github.com/abdulkaderghandoura/arabic-speech-commands-dataset.git asc
    git -C asc sparse-checkout set --no-cone '/dataset/stop/' '/dataset/no/' '/dataset/yes/' '/dataset/cancel/' '/dataset/close/' '/dataset/ok/' '/background_noise/' '/LICENSE' '/README.md'
    git -C asc checkout 72f3438212ff6cf8fbe5ae8068361840646429bd
fi

if [ ! -d mini_speech_commands ]; then
    curl -fsSL -o mini_speech_commands.zip https://storage.googleapis.com/download.tensorflow.org/data/mini_speech_commands.zip
    unzip -q mini_speech_commands.zip && rm -f mini_speech_commands.zip
fi
echo "data ready in $(pwd)"
