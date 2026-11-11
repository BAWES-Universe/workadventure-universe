"""A second opinion on what is in a recording, from two tools that are neither of the detectors under test:
Whisper (base, multilingual, via sherpa-onnx) says which words it hears, and the WebRTC project's voice detector
(a classic statistical one, strictest mode) says where it finds a voice. This is a machine opinion, NOT a person listening.

  python3 -I scripts/adjudicate.py <whisper dir> sources <data dir> <per-clip.tsv>   > sources.tsv   (every speech recording)
  python3 -I scripts/adjudicate.py <whisper dir> clips   <wav dir>                   > clips.tsv     (exported clips and noise spans)
  python3 -I scripts/adjudicate.py -             labels  <sources.tsv> <clips.tsv>   > adjudication.tsv  (the labels report.ts reads)
  python3 -I scripts/adjudicate.py -             tables  <adjudication.tsv> <clips.tsv> <per-clip.tsv> <newly-missed.tsv>   (the tables of ADJUDICATION.md)

Labels, by fixed rules (nobody picks them by hand):
  speech recording   valid speech  Whisper hears the expected word, or hears other words and the voice detector finds a voice
                     no speech     Whisper hears no words (nothing, or only a sound tag such as "[Music]") and under 100 ms of voice is found
                     uncertain     anything else
  noise recording    background voice  the same place in the recording, cut at two different loudness levels, gives Whisper
                                       nearly the same words (two or more): a consistent sentence is a voice, a made-up one changes
                     no speech         Whisper hears no words in any span where the detector fired
                     uncertain         anything else

Needs: pip install sherpa-onnx webrtcvad-wheels numpy; the Whisper files from
https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2
"""
import os, re, sys, wave
import numpy as np, sherpa_onnx, webrtcvad

whisper_dir, mode = sys.argv[1], sys.argv[2]
RECOGNISERS = {}
def whisper(lang, x):
    if lang not in RECOGNISERS:
        RECOGNISERS[lang] = sherpa_onnx.OfflineRecognizer.from_whisper(
            encoder=f"{whisper_dir}/base-encoder.int8.onnx", decoder=f"{whisper_dir}/base-decoder.int8.onnx",
            tokens=f"{whisper_dir}/base-tokens.txt", language=lang, task="transcribe", num_threads=1)
    s = RECOGNISERS[lang].create_stream()
    s.accept_waveform(16000, x)
    RECOGNISERS[lang].decode_stream(s)
    return s.result.text.strip()

def read(path, seconds=None):
    w = wave.open(path)
    assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2, path
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return x[: int(seconds * 16000)] if seconds else x

def levelled(x):
    """The same loudness for every recording, so a quiet one is not judged on loudness."""
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    return x * min(30.0, 0.7 / peak) if peak > 0 else x

VAD = webrtcvad.Vad(3)
def voice(x):
    """Where the WebRTC detector finds a voice: start of the first and end of the last run of at least 30 ms, and the total."""
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    flags = [VAD.is_speech(pcm[i:i + 160].tobytes(), 16000) for i in range(0, len(pcm) - 159, 160)]
    first = last = None
    run = 0
    for i, f in enumerate(flags + [False]):
        if f:
            run += 1
        else:
            if run >= 3:
                if first is None:
                    first = (i - run) * 0.01
                last = i * 0.01
            run = 0
    return first, last, sum(flags) * 10

EXPECTED = {
    "en": {"stop": ["stop"], "no": ["no", "know", "nope"], "yes": ["yes", "yeah"], "go": ["go"]},
    "ar": {"stop": ["توقف", "قف"], "no": ["لا"], "yes": ["نعم"], "cancel": ["الغاء", "الغ"], "close": ["اغلق", "اغلاق"], "ok": ["موافق"]},
}
def plain(text):
    # A sound tag ("[Music]", "(crunching)", even one cut short) is Whisper saying it hears no words
    text = re.sub(r"\[[^\]]*\]?|\([^)]*\)?", " ", text)
    text = re.sub(r"[ً-ْـ]", "", text.lower())
    text = re.sub(r"[إأآا]", "ا", text)
    return re.sub(r"[^\w\s]", "", text).strip()
def distance(a, b):
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, row[0] = row[0], i
        for j, cb in enumerate(b, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (ca != cb))
    return row[-1]
def matches(lang, word, text):
    words = plain(text).split()
    return any(distance(w, e) <= (1 if len(e) > 2 else 0) for w in words for e in EXPECTED[lang].get(word, []))

def opinion(text, voice_ms, matched):
    words = plain(text)
    if matched:
        return "valid speech", "Whisper hears the expected word"
    if words and voice_ms >= 100:
        return "valid speech", "Whisper hears other words and the voice detector finds a voice"
    if not words and voice_ms < 100:
        return "no speech", "Whisper hears no words and the voice detector finds under 100 ms of voice"
    return "uncertain", "Whisper hears words but no voice is found" if words else "the voice detector reacts but Whisper hears no words"

def rows(path):
    lines = open(path, encoding="utf8").read().split("\n")
    head = lines[0].split("\t")
    return [dict(zip(head, line.split("\t"))) for line in lines[1:] if line]

if mode == "tables":
    labels = {r["source"]: r for r in rows(sys.argv[3])}
    clips = {(r["id"], r["from"]): r for r in rows(sys.argv[4])}
    per_clip = {r["id"]: r for r in rows(sys.argv[5])}
    print("### Clips today's gate catches and the frozen rule does not (both halves)\n")
    print("| half | recording | condition | rule's outcome | Whisper on this very clip | label of the recording | why |\n| --- | --- | --- | --- | --- | --- | --- |")
    for line in open(sys.argv[6], encoding="utf8").read().split("\n"):
        if not line:
            continue
        half, clip_id, outcome = line.split("\t")
        _, source, condition = clip_id.split("|")
        heard = clips.get((clip_id, "0.00"), {}).get("whisper", "(not exported)")
        print(f'| {half} | `{source}` | {condition} | {outcome.upper()} | "{heard}" | **{labels[source]["label"]}** | {labels[source]["reason"]}. {labels[source]["detail"]} |')
    for group, title in (("nonspeech", "Non-speech recordings where the frozen rule fired (report half)"), ("scene", "Scene recordings where it fired"), ("speechlike", "Speech-like recordings where it fired (babble, neighbours, announcements)")):
        print(f"\n### {title}\n")
        print("| recording | firings (all levels) | label | why | what Whisper heard around each firing |\n| --- | --- | --- | --- | --- |")
        fired = {}
        for r in per_clip.values():
            if r["kind"] == "noise" and r["split"] == "report" and r["label"] == group and r["silero_firings"]:
                fired[r["source"]] = fired.get(r["source"], 0) + len(r["silero_firings"].split(" "))
        for source, n in sorted(fired.items()):
            l = labels[source]
            print(f'| `{source}` | {n} | **{l["label"]}** | {l["reason"]} | {l["detail"]} |')
elif mode == "labels":
    import difflib
    print("source\tlabel\treason\tdetail")
    for r in rows(sys.argv[3]):
        lang, word = r["language"], r["expected"]
        matched = matches(lang, word, r["whisper"]) if word != "sentence" else len(plain(r["whisper"]).split()) >= 3
        label, reason = opinion(r["whisper"], int(r["voice_ms"]), matched)
        print("\t".join([r["source"], label, reason, f'Whisper: "{r["whisper"]}"; voice found: {r["voice_ms"]} ms']))
    spans = {}
    for r in rows(sys.argv[4]):
        kind, source, level = r["id"].split("|")
        if kind == "noise":
            spans.setdefault(source, []).append((level, float(r["from"]), float(r["to"]), r["whisper"]))
    for source, found in sorted(spans.items()):
        label, reason = "uncertain", "Whisper hears words, but not the same words at the same place at two levels"
        if all(not plain(text) for _, _, _, text in found):
            label, reason = "no speech", "Whisper hears no words in any span where the detector fired"
        for la, a0, a1, ta in found:
            for lb, b0, b1, tb in found:
                overlap = min(a1, b1) - max(a0, b0)
                wa, wb = plain(ta).split(), plain(tb).split()
                if la != lb and overlap >= 0.5 * min(a1 - a0, b1 - b0) and len(wa) >= 2 and len(wb) >= 2 and difflib.SequenceMatcher(None, wa, wb).ratio() >= 0.6:
                    label, reason = "background voice", "Whisper hears nearly the same words at the same place at two levels"
        detail = "; ".join(f'{level} dBFS {a:.1f}-{b:.1f} s: "{text}"' for level, a, b, text in found)
        print("\t".join([source, label, reason, detail]))
elif mode == "sources":
    data, per_clip = sys.argv[3], sys.argv[4]
    seen = {}
    for line in open(per_clip, encoding="utf8").read().split("\n")[1:]:
        c = line.split("\t")
        if len(c) > 6 and c[2] == "speech":
            seen[c[6]] = (c[3], c[4])
    print("source\tlabel\treason\tlanguage\texpected\twhisper\tvoice_from\tvoice_to\tvoice_ms")
    for source, (set_, word) in sorted(seen.items()):
        lang = "ar" if set_ == "ar-command" else "en"
        folder = {"en": "mini_speech_commands", "ar": "asc/dataset", "sent": "ms-snsd/clean_test"}[source.split("/")[0]]
        x = levelled(read(os.path.join(data, folder, source.split("/", 1)[1]), 4 if set_ == "en-sentence" else None))
        text = whisper(lang, x)
        first, last, ms = voice(x)
        matched = matches(lang, word, text) if set_ != "en-sentence" else len(plain(text).split()) >= 3
        label, reason = opinion(text, ms, matched)
        print("\t".join([source, label, reason, lang, word, text, "" if first is None else f"{first:.2f}", "" if last is None else f"{last:.2f}", str(ms)]), flush=True)
else:
    wav_dir = sys.argv[3]
    print("file\tid\tfrom\tto\twhisper\tvoice_ms")
    for line in open(os.path.join(wav_dir, "index.tsv"), encoding="utf8").read().split("\n")[1:]:
        if not line:
            continue
        file, clip_id, a, b = line.split("\t")
        x = levelled(read(os.path.join(wav_dir, file)))
        lang = "ar" if "|ar/" in clip_id else "en"
        print("\t".join([file, clip_id, a, b, whisper(lang, x), str(voice(x)[2])]), flush=True)
