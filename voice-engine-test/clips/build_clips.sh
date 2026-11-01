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
# bot voice: the (MIT, silero-vad) test recording with pauses longer than 120 ms removed, first 30 s, 24 kHz s16 mono.
# Used only as "recorded speech" by the fake TTS, so pauses inside bot audio cannot be mistaken for "bot stopped".
ffmpeg -v error -y -i "$SRC/silero_test.wav" -af "silenceremove=start_periods=1:start_threshold=-33dB:stop_periods=-1:stop_duration=0.12:stop_threshold=-33dB" -t 30 -ac 1 -ar 24000 -sample_fmt s16 "$(dirname "$OUT")/bot-voice-24k.wav"
# derived: the speech part of three LibriSpeech utterances (leading/trailing silence trimmed) joined with 60 ms of silence, so the whole
# thing is one continuous 5.3 s utterance with no pause that reaches the 200 ms VAD stop time. Used for the packet-loss test (S7).
ffmpeg -v error -y -i "$OUT/en_ls_halt.wav" -i "$OUT/en_ls_power.wav" -i "$OUT/en_ls_experience.wav" -f lavfi -t 0.06 -i anullsrc=r=16000:cl=mono \
  -filter_complex "[0]atrim=0.536:2.664,asetpts=PTS-STARTPTS[a];[1]atrim=0.568:2.216,asetpts=PTS-STARTPTS[b];[2]atrim=0.344:1.8,asetpts=PTS-STARTPTS[c];[a][3][b][3][c]concat=n=5:v=0:a=1,aformat=sample_fmts=s16:sample_rates=16000:channel_layouts=mono" "$OUT/en_concat3.wav"
