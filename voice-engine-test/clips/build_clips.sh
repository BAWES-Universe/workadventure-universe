#!/usr/bin/env bash
# Rebuilds clips/wav/*.wav (16 kHz mono s16) and clips/bot-voice-24k.wav from the downloaded sources.
# Usage: clips/build_clips.sh <dir with downloaded sources>   (see SOURCES.md for the URLs)
set -euo pipefail
SRC="$1"; OUT="$(cd "$(dirname "$0")" && pwd)/wav"; mkdir -p "$OUT"
conv() { ffmpeg -v error -y -i "$1" -ac 1 -ar 16000 -sample_fmt s16 "$OUT/$2.wav"; }
conv "$SRC/jfk.flac"                          en_jfk
conv "$SRC/audio/2830-3980-0043.wav"          en_ls_experience
conv "$SRC/audio/4507-16021-0012.wav"         en_ls_halt
conv "$SRC/audio/8455-210777-0068.wav"        en_ls_power
conv "$SRC/klaam/samples/demo.wav"            ar_egy_demo
conv "$SRC/iraqi/arabic_jamalaka.wav"         ar_iraqi_1
conv "$SRC/iraqi/iraqi_hathallon.wav"         ar_iraqi_2
conv "$SRC/iraqi/iraqi_nafha.wav"             ar_iraqi_3
# bot voice: first 30 s of the (MIT, silero-vad) test recording, 24 kHz s16 mono, used by the fake TTS
ffmpeg -v error -y -t 30 -i "$SRC/silero_test.wav" -ac 1 -ar 24000 -sample_fmt s16 "$(dirname "$OUT")/bot-voice-24k.wav"
