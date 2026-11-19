#!/usr/bin/env bash
# Downloads the pinned model and the test audio into ./data (about 1 GB). Nothing here is committed.
# Licences: Silero VAD MIT; MS-SNSD MIT; Arabic Speech Commands CC BY 4.0; Speech Commands (mini) CC BY 4.0.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data && cd data

curl -fsSL -o silero_vad_v6.2.3.onnx https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.onnx
echo "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3  silero_vad_v6.2.3.onnx" | sha256sum -c -

# A clone that was made but not finished (the checkout failed, the run was stopped) is finished on the next run: the clone is
# made only when there is none, and the sparse set and the pinned checkout are done every time
fetch_repo() { # dir, url, commit, sparse paths...
    local dir=$1 url=$2 commit=$3; shift 3
    [ -d "$dir/.git" ] || { rm -rf "$dir"; git clone --filter=blob:none --no-checkout "$url" "$dir"; }
    git -C "$dir" sparse-checkout set --no-cone "$@"
    git -C "$dir" checkout "$commit"
}

fetch_repo ms-snsd https://github.com/microsoft/MS-SNSD.git fe61c4ba0d9ac8dd7e23d719cc79f8947e1dc742 \
    '/noise_test/' '/noise_train/' '/clean_test/' '/LICENSE' '/README.md'

fetch_repo asc https://github.com/abdulkaderghandoura/arabic-speech-commands-dataset.git 72f3438212ff6cf8fbe5ae8068361840646429bd \
    '/dataset/stop/' '/dataset/no/' '/dataset/yes/' '/dataset/cancel/' '/dataset/close/' '/dataset/ok/' '/background_noise/' '/LICENSE' '/README.md'

# Extracted beside it and put in place only when the extraction ended, so a stopped one is not taken for the whole
if [ ! -d mini_speech_commands ]; then
    rm -rf mini_speech_commands.partial mini_speech_commands.zip
    curl -fsSL -o mini_speech_commands.zip https://storage.googleapis.com/download.tensorflow.org/data/mini_speech_commands.zip
    mkdir mini_speech_commands.partial
    unzip -q mini_speech_commands.zip -d mini_speech_commands.partial
    # The archive holds one folder of that name
    if [ -d mini_speech_commands.partial/mini_speech_commands ]; then
        mv mini_speech_commands.partial/mini_speech_commands mini_speech_commands && rmdir mini_speech_commands.partial
    else
        mv mini_speech_commands.partial mini_speech_commands
    fi
    rm -f mini_speech_commands.zip
fi
echo "data ready in $(pwd)"
