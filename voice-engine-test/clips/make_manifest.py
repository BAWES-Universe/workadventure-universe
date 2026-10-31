"""Writes manifest.json: id, file, language, duration, sha256, transcript (what the FAKE STT returns), notes."""
import hashlib, json, wave, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
CLIPS = [
 ("en_jfk","en","And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country.","human, US public domain (JFK 1961 inaugural, via openai/whisper tests/jfk.flac)"),
 ("en_ls_experience","en","experience proves this","human, LibriSpeech 2830-3980-0043 (CC BY 4.0)"),
 ("en_ls_halt","en","why should one halt on the way","human, LibriSpeech 4507-16021-0012 (CC BY 4.0)"),
 ("en_ls_power","en","your power is sufficient i said","human, LibriSpeech 8455-210777-0068 (CC BY 4.0)"),
 ("ar_egy_demo","ar","أكل بتاعهو بيبقى مميز قوي عرفة إزاي ف والل ه إحنا كلنا كل يوم بنعمل حيلة عشان نسهب الشنطة بتاعته ناخد الأكن ورجع أ","human Egyptian Arabic; transcript is the ASR output printed in ARBML/klaam notebooks/demo.ipynb (approximate)"),
 ("ar_iraqi_1","ar","[label] arabic_jamalaka","SYNTHETIC (TTS) Arabic, CC BY 4.0 hayderkharrufa/iraqi-dialect-tts-corpus; text is a label, true transcript unknown"),
 ("ar_iraqi_2","ar","[label] iraqi_hathallon","SYNTHETIC (TTS) Iraqi Arabic, CC BY 4.0; text is a label, true transcript unknown"),
 ("ar_iraqi_3","ar","[label] iraqi_nafha","SYNTHETIC (TTS) Iraqi Arabic, CC BY 4.0; text is a label, true transcript unknown"),
]
out = {"format":"s16le mono 16000 Hz wav","fakeSttNote":"The fake STT returns `transcript` for the clip being played. It never looks at the audio.","clips":{}}
for cid, lang, text, note in CLIPS:
    p = os.path.join(HERE,"wav",cid+".wav")
    w = wave.open(p); assert w.getframerate()==16000 and w.getnchannels()==1 and w.getsampwidth()==2
    out["clips"][cid] = {"file":"wav/%s.wav"%cid,"lang":lang,"durationMs":round(w.getnframes()*1000/16000),"sha256":hashlib.sha256(open(p,"rb").read()).hexdigest(),"transcript":text,"note":note}
# aliases used by scenarios: same audio, different fake-STT text (documented in PROTOCOL / scorecard)
out["clips"]["en_yes"] = dict(out["clips"]["en_ls_experience"], transcript="yes", note="alias of en_ls_experience audio; the fake STT is told it said 'yes' (S5)")
p = os.path.join(HERE,"bot-voice-24k.wav")
out["botVoice"] = {"file":"bot-voice-24k.wav","sha256":hashlib.sha256(open(p,"rb").read()).hexdigest(),"format":"s16le mono 24000 Hz wav, 30 s of recorded speech (silero-vad tests/data/test.wav, MIT repo)"}
json.dump(out, open(os.path.join(HERE,"manifest.json"),"w"), ensure_ascii=False, indent=1)
print("ok", len(out["clips"]))
