"""KG Chart - pronunciation check, step 1: which languages can Azure score?

For each language, Azure's own voice says a short known phrase (so nobody has to record anything). The clip is
sent back to Azure speech-to-text three times:
    1. plain recognition                    -> does Azure understand this language? ("Understood?" mode)
    2. with pronunciation assessment         -> does it return a score for this language? ("Score" mode)
    3. pronunciation assessment, wrong text  -> does the score really drop when the words don't match?
and the script prints one line per language plus a summary of which mode each language should use.
Nothing is uploaded and nothing in Supabase changes.

Needs the same two env vars as gen_kg_audio.py:
    AZURE_SPEECH_KEY, AZURE_SPEECH_REGION

    python tools/try_pronunciation.py              # all languages (11 short clips, about 33 recognition calls)
    python tools/try_pronunciation.py --lang my    # one language
    python tools/try_pronunciation.py --save       # also keep the WAV clips in audio-cache/pron-test/
    python tools/try_pronunciation.py --lang my --text "ဘာလိုချင်လဲ"
        # one sentence: what Azure hears (and how it splits it into words), then the score for the sentence
        # written as is, split into syllables, and split the way Azure split it. Shows how to send sentences.

The results also go to audio-cache/pron-test/results.json: paste the printed summary (or that file) back to Claude.
Cost: a few seconds of speech per language, well inside Azure's free monthly allowance.
"""
import base64
import json
import os
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "audio-cache" / "pron-test"
WAV_FORMAT = "riff-16khz-16bit-mono-pcm"  # exactly what the app will send: WAV, 16 kHz, mono

# lang -> (Azure locale, voice, a short phrase the voice says, a different phrase used as the "wrong text")
# Locales and voices are the same as tools/gen_kg_audio.py VOICES (female voice).
TESTS = {
    "my": ("my-MM", "my-MM-NilarNeural", "ကျေးဇူးတင်ပါတယ်", "ဘယ်လောက်လဲ"),
    "ja": ("ja-JP", "ja-JP-NanamiNeural", "ありがとうございます", "駅はどこですか"),
    "zh": ("zh-CN", "zh-CN-XiaoxiaoNeural", "谢谢你", "多少钱"),
    "si": ("si-LK", "si-LK-ThiliniNeural", "බොහොම ස්තූතියි", "කීයද"),
    "ko": ("ko-KR", "ko-KR-SunHiNeural", "감사합니다", "얼마예요"),
    "ta": ("ta-IN", "ta-IN-PallaviNeural", "மிக்க நன்றி", "எவ்வளவு"),
    "th": ("th-TH", "th-TH-PremwadeeNeural", "ขอบคุณมาก", "เท่าไหร่"),
    "ms": ("ms-MY", "ms-MY-YasminNeural", "Terima kasih", "Berapa harganya"),
    "mr": ("mr-IN", "mr-IN-AarohiNeural", "पुन्हा सांगा", "किती झाले"),
    "kn": ("kn-IN", "kn-IN-SapnaNeural", "ಧನ್ಯವಾದಗಳು", "ಎಷ್ಟು ಆಯಿತು"),
    "te": ("te-IN", "te-IN-ShrutiNeural", "ధన్యవాదాలు", "ఎంత అయింది"),
}

PUNCT = set("။၊.,!?。、？！，．")


def plain(text: str) -> str:
    """NFC, no spaces or punctuation: how the app will compare what Azure heard with what was expected."""
    t = unicodedata.normalize("NFC", text or "")
    return "".join(ch for ch in t if not ch.isspace() and ch not in PUNCT).lower()


def call(req: urllib.request.Request, timeout: int = 60):
    """(status, body text). Retries only on throttling."""
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                time.sleep(2 ** attempt)
                continue
            return e.code, e.read()
        except (urllib.error.URLError, TimeoutError) as e:
            return 0, str(e).encode()


def synth(text: str, locale: str, voice: str, key: str, region: str) -> bytes:
    ssml = f"<speak version='1.0' xml:lang='{locale}'><voice name='{voice}'>{escape(text)}</voice></speak>"
    req = urllib.request.Request(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
        data=ssml.encode("utf-8"),
        headers={"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
                 "X-Microsoft-OutputFormat": WAV_FORMAT, "User-Agent": "kg-chart-pron-test"})
    status, body = call(req)
    if status != 200:
        raise RuntimeError(f"text-to-speech HTTP {status}: {body[:200].decode('utf-8', 'replace')}")
    return body


def recognise(wav, locale, key, region, reference=None):
    """One short-audio recognition call; with `reference`, pronunciation assessment is asked for."""
    headers = {"Ocp-Apim-Subscription-Key": key, "Accept": "application/json",
               "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000"}
    if reference is not None:
        params = {"ReferenceText": reference, "GradingSystem": "HundredMark", "Granularity": "Word",
                  "Dimension": "Comprehensive", "EnableMiscue": "True"}
        headers["Pronunciation-Assessment"] = base64.b64encode(json.dumps(params, ensure_ascii=False).encode("utf-8")).decode()
    req = urllib.request.Request(
        f"https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1"
        f"?language={locale}&format=detailed", data=wav, headers=headers)
    status, body = call(req)
    try:
        data = json.loads(body.decode("utf-8"))
    except ValueError:
        data = {"_raw": body[:300].decode("utf-8", "replace")}
    return status, data


def scores(data: dict):
    """The pronunciation scores in a reply, or None. Newer replies nest them under PronunciationAssessment."""
    best = (data.get("NBest") or [{}])[0]
    pa = best.get("PronunciationAssessment") or best
    if "PronScore" not in pa and "AccuracyScore" not in pa:
        return None
    pick = lambda k: round(pa[k]) if isinstance(pa.get(k), (int, float)) else None
    return {"pron": pick("PronScore"), "accuracy": pick("AccuracyScore"), "fluency": pick("FluencyScore"),
            "completeness": pick("CompletenessScore")}


def heard(data: dict) -> str:
    best = (data.get("NBest") or [{}])[0]
    return data.get("DisplayText") or best.get("Display") or best.get("Lexical") or ""


def run_one(lang: str, key: str, region: str, save: bool) -> dict:
    locale, voice, phrase, wrong = TESTS[lang]
    res = {"lang": lang, "locale": locale, "phrase": phrase}
    try:
        wav = synth(phrase, locale, voice, key, region)
    except RuntimeError as e:
        res["error"] = str(e)
        return res
    if save:
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / f"{lang}.wav").write_bytes(wav)
    # 1. plain recognition
    st, d = recognise(wav, locale, key, region)
    res["stt_http"] = st
    res["stt_status"] = d.get("RecognitionStatus")
    res["heard"] = heard(d)
    res["stt_ok"] = st == 200 and d.get("RecognitionStatus") == "Success"
    res["understood"] = res["stt_ok"] and plain(res["heard"]) == plain(phrase)
    # 2. pronunciation assessment, right text
    st, d = recognise(wav, locale, key, region, reference=phrase)
    res["pa_http"] = st
    res["pa_status"] = d.get("RecognitionStatus")
    res["pa_scores"] = scores(d) if st == 200 else None
    if st != 200:
        res["pa_error"] = (d.get("_raw") or json.dumps(d, ensure_ascii=False))[:200]
    # 3. pronunciation assessment, wrong text: a real score should drop
    if res["pa_scores"]:
        st, d = recognise(wav, locale, key, region, reference=wrong)
        res["pa_wrong_scores"] = scores(d) if st == 200 else None
    s, w = res.get("pa_scores"), res.get("pa_wrong_scores")
    res["score_works"] = bool(s and s["pron"] is not None and s["pron"] >= 60
                              and (not w or w["pron"] is None or w["pron"] <= s["pron"] - 20))
    res["mode"] = "score" if res["score_works"] else "understood" if res["stt_ok"] else "none"
    return res


def burmese_syllables(text: str) -> str:
    """Spaces between Burmese syllables: a new syllable starts at a consonant (or independent vowel) that is not
    killed by asat (်), not stacked (္ before or after) and not the start of the text."""
    out, chars = [], list(unicodedata.normalize("NFC", text))
    for i, ch in enumerate(chars):
        j = i + 1
        while j < len(chars) and chars[j] == "\u1037":  # dot below (့) can sit before asat: ကြည့်
            j += 1
        nxt = chars[j] if j < len(chars) else ""
        prev = chars[i - 1] if i else ""
        starts = ("\u1000" <= ch <= "\u1021" or "\u1023" <= ch <= "\u102a" or ch == "\u103f") \
            and nxt not in ("\u103a", "\u1039") and prev != "\u1039"
        if starts and out and out[-1] != " ":
            out.append(" ")
        out.append(ch)
    return "".join(out).strip()


def words_of(data: dict):
    best = (data.get("NBest") or [{}])[0]
    out = []
    for w in best.get("Words") or []:
        p = w.get("PronunciationAssessment") or w
        acc = p.get("AccuracyScore")
        out.append(f"{w.get('Word', '')}:{p.get('ErrorType', '-')}" + (f"/{round(acc)}" if isinstance(acc, (int, float)) else ""))
    return out


def text_mode(lang: str, text: str, key: str, region: str) -> None:
    locale, voice, _, _ = TESTS[lang]
    text = unicodedata.normalize("NFC", text).strip()
    print(f"Sentence: {text}   ({lang}, {locale}, voice {voice})\n")
    wav = synth(text, locale, voice, key, region)
    st, d = recognise(wav, locale, key, region)
    best = (d.get("NBest") or [{}])[0]
    lexical = best.get("Lexical") or ""
    print(f"Azure hears:      '{heard(d)}'   (HTTP {st}, {d.get('RecognitionStatus')})")
    print(f"Azure's words:    '{lexical}'   ({len(lexical.split())} word(s))\n")
    variants = [("as is", text)]
    if lang == "my":
        variants.append(("syllables", burmese_syllables(text)))
    if lexical and lexical.replace(" ", "") != text.replace(" ", "") and len(lexical.split()) > 1:
        pass  # Azure heard different text: its split isn't a fair reference
    elif lexical and len(lexical.split()) > 1:
        variants.append(("Azure's split", lexical))
    seen = set()
    for name, ref in variants:
        if ref in seen:
            continue
        seen.add(ref)
        st, d = recognise(wav, locale, key, region, reference=ref)
        s = scores(d) if st == 200 else None
        if s:
            print(f"{name:14} '{ref}'\n               score {s['pron']} (accuracy {s['accuracy']}, fluency {s['fluency']}, "
                  f"completeness {s['completeness']})  words: {' '.join(words_of(d)) or '-'}")
        else:
            print(f"{name:14} '{ref}'\n               no score (HTTP {st}, {d.get('RecognitionStatus')})")
    print("\nPaste all of this back to Claude.")


def line(r: dict) -> str:
    if "error" in r:
        return f"{r['lang']:3} {r['locale']:6}  ERROR  {r['error']}"
    s, w = r.get("pa_scores"), r.get("pa_wrong_scores")
    stt = (f"heard '{r['heard']}'" + (" ✓" if r["understood"] else " (differs)")) if r["stt_ok"] \
        else f"not recognised (HTTP {r['stt_http']}, {r['stt_status']})"
    if s:
        pa = f"score {s['pron']} (accuracy {s['accuracy']}, fluency {s['fluency']}, completeness {s['completeness']})"
        if w:
            pa += f"; wrong text {w['pron']}"
    else:
        pa = f"no score (HTTP {r['pa_http']}{', ' + r['pa_status'] if r.get('pa_status') else ''})"
    return f"{r['lang']:3} {r['locale']:6}  {r['mode'].upper():10}  {stt}  |  {pa}"


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows console + Burmese text
    except AttributeError:
        pass
    args = sys.argv[1:]
    langs = list(TESTS)
    if "--lang" in args:
        i = args.index("--lang")
        if i + 1 >= len(args) or args[i + 1] not in TESTS:
            sys.exit(f"--lang needs one of: {', '.join(TESTS)}")
        langs = [args[i + 1]]
    save = "--save" in args
    key, region = os.environ.get("AZURE_SPEECH_KEY"), os.environ.get("AZURE_SPEECH_REGION")
    if not key or not region:
        sys.exit("Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION first (the same as for gen_kg_audio.py).")
    if "--text" in args:
        i = args.index("--text")
        if i + 1 >= len(args) or len(langs) != 1:
            sys.exit('Use it like: python tools/try_pronunciation.py --lang my --text "ဘာလိုချင်လဲ"')
        text_mode(langs[0], args[i + 1], key, region)
        return

    print(f"Testing {len(langs)} language(s) in region {region}...\n")
    results = []
    for lang in langs:
        r = run_one(lang, key, region, save)
        results.append(r)
        print(line(r), flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    by = lambda m: ", ".join(r["lang"] for r in results if r.get("mode") == m) or "—"
    print("\nSummary (paste this back to Claude):")
    print(f"  SCORE      (pronunciation assessment works): {by('score')}")
    print(f"  UNDERSTOOD (speech-to-text only):            {by('understood')}")
    print(f"  NONE       (neither worked):                 {by('none')}")
    errors = [r["lang"] for r in results if "error" in r]
    if errors:
        print(f"  ERRORS: {', '.join(errors)} (see above)")
    print(f"\nDetails: {OUT / 'results.json'}")


if __name__ == "__main__":
    main()
