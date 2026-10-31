# Clip sources and licences

Wikimedia Commons, archive.org, LibriVox, OpenSLR, Zenodo and Hugging Face are blocked from the build sandbox
(proxy answers 403). Everything below was fetched from GitHub (raw files or release assets).
`build_clips.sh` converts them to 16 kHz mono s16 wav. `manifest.json` has the sha256 of every converted file.

| Clip id | Language | Real person? | Source URL | Licence |
|---|---|---|---|---|
| en_jfk (11 s) | English | yes | https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac | Speech: US federal work, public domain. Repo: MIT. |
| en_ls_experience (2.0 s), en_ls_halt (2.7 s), en_ls_power (2.6 s) | English | yes | https://github.com/mozilla/DeepSpeech/releases/download/v0.9.3/audio-0.9.3.tar.gz (LibriSpeech 2830-3980-0043, 4507-16021-0012, 8455-210777-0068) | LibriSpeech: CC BY 4.0 (LibriVox recordings are public domain). Transcripts from the DeepSpeech README. |
| en_concat3 (~5.3 s) | English | yes (derived) | speech parts of the three LibriSpeech clips above, joined with 60 ms silence by `build_clips.sh` | CC BY 4.0 |
| ar_egy_demo (10 s) | Arabic (Egyptian) | yes | https://raw.githubusercontent.com/ARBML/klaam/main/samples/demo.wav | Repo is MIT. The repo does not say who recorded the clip or under what terms. Treat as "MIT repo sample, speaker licence unknown". The text in the manifest is the model output printed in `notebooks/demo.ipynb`, so it is approximate. |
| ar_iraqi_1 (5.6 s), ar_iraqi_2 (6.4 s), ar_iraqi_3 (4.7 s) | Arabic (MSA / Iraqi) | NO. Synthetic TTS output | https://github.com/hayderkharrufa/iraqi-dialect-tts-corpus/tree/main/resources/generated_speech_samples | CC BY 4.0 (Kharrufa, Taha, Baraq, 2024, DOI 10.5281/zenodo.11170567) |
| bot-voice-24k (30 s) | unknown | yes | https://raw.githubusercontent.com/snakers4/silero-vad/master/tests/data/test.wav (first 30 s) | silero-vad repo: MIT. Used only as "recorded speech" for the fake TTS. |

## Honest limits for Arabic (S11)

* Only ONE Arabic clip is a real person (10 s, one speaker). Three more are synthetic voices.
  That is a thin sample. S11 results say "comparable on these 4 clips", not "Arabic works".
* The fake STT text for Arabic is a label or an approximate ASR line. The turn-end test measures timing and
  the Smart Turn decision, not recognition.
* No long, natural Arabic conversation with pauses and false endings was available. Smart Turn's real
  Arabic quality is NOT proven by this folder.
