"""KG Chart - Phase 9 step 1: generate native-audio MP3s with Azure Speech and upload them to Supabase Storage.

Adapted from the Burmese app's gen_speak_audio.py. Reads every word (kg_chart_vocabulary_translations.native_text),
topic question (kg_chart_topic_translations.question_native) and sentence (kg_chart_sentences.native_text) for one language, makes a male + female clip for
each unique text, uploads to  vocabulary-assets/audio/<lang>/<m|f>/<hash>.mp3  and writes  audio/<lang>/clips.json
(the list the app uses to know which clips exist).

Needs three env vars on the PC (never in the repo or the app):
    AZURE_SPEECH_KEY, AZURE_SPEECH_REGION, SUPABASE_SERVICE_KEY

    python tools/gen_kg_audio.py --dry-run        # count texts + characters, no Azure calls, no uploads
    python tools/gen_kg_audio.py                  # Tamil (default): only clips not yet in storage
    python tools/gen_kg_audio.py --lang ms        # another language
    python tools/gen_kg_audio.py --force          # regenerate + re-upload everything for that language

Clips are also kept in audio-cache/ next to tools/ so a failed upload doesn't cost another Azure call.
Run again any time words are added or edited: edited text = new hash = new clip.
"""
import json
import os
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

SUPABASE_URL = "https://ulgrfumbwjovbjzjiems.supabase.co"
BUCKET = "vocabulary-assets"
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "audio-cache"
RATE = "-15%"  # same as the Burmese app: 15% slower for beginners
FORMAT = "audio-24khz-48kbitrate-mono-mp3"

# lang code -> (SSML xml:lang, male voice, female voice). Check names in the Azure voice gallery.
VOICES = {
    "ta": ("ta-IN", "ta-IN-ValluvarNeural", "ta-IN-PallaviNeural"),
    "ms": ("ms-MY", "ms-MY-OsmanNeural", "ms-MY-YasminNeural"),
    "my": ("my-MM", "my-MM-ThihaNeural", "my-MM-NilarNeural"),
    "zh": ("zh-CN", "zh-CN-YunxiNeural", "zh-CN-XiaoxiaoNeural"),
    "ko": ("ko-KR", "ko-KR-InJoonNeural", "ko-KR-SunHiNeural"),
    "th": ("th-TH", "th-TH-NiwatNeural", "th-TH-PremwadeeNeural"),
    "te": ("te-IN", "te-IN-MohanNeural", "te-IN-ShrutiNeural"),
    "si": ("si-LK", "si-LK-SameeraNeural", "si-LK-ThiliniNeural"),
    "ja": ("ja-JP", "ja-JP-KeitaNeural", "ja-JP-NanamiNeural"),
    "mr": ("mr-IN", "mr-IN-ManoharNeural", "mr-IN-AarohiNeural"),
    "kn": ("kn-IN", "kn-IN-GaganNeural", "kn-IN-SapnaNeural"),
}


def norm(text: str) -> str:
    """Must match the app exactly: NFC + trim + collapse inner whitespace."""
    return " ".join(unicodedata.normalize("NFC", text or "").split())


def fnv1a8(text: str) -> str:
    """FNV-1a 32-bit over the UTF-8 bytes of norm(text), 8 lowercase hex chars. The app uses the same function."""
    h = 0x811C9DC5
    for b in norm(text).encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def sb_request(method: str, path: str, key: str, body=None, headers=None):
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    h.update(headers or {})
    data = body
    if isinstance(body, (dict, list)):
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(SUPABASE_URL + path, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        return json.loads(raw) if raw and r.headers.get_content_type() == "application/json" else raw


def fetch_texts(lang: str, key: str) -> list[str]:
    q = urllib.parse.quote(lang)
    words = sb_request("GET", f"/rest/v1/kg_chart_vocabulary_translations?select=native_text&language_code=eq.{q}&limit=10000", key)
    topics = sb_request("GET", f"/rest/v1/kg_chart_topic_translations?select=question_native&language_code=eq.{q}&limit=1000", key)
    try:  # sentence quizzes (kg-chart-sentences.sql); skipped if that table isn't there yet
        sentences = sb_request("GET", f"/rest/v1/kg_chart_sentences?select=native_text&language_code=eq.{q}&limit=10000", key)
    except urllib.error.HTTPError as e:
        print(f"   (no sentences table yet: {e.code}, skipping sentences)")
        sentences = []
    texts = [w["native_text"] for w in words] + [t["question_native"] for t in topics] + [s["native_text"] for s in sentences]
    seen, out = set(), []
    for t in texts:
        n = norm(t)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def list_storage(prefix: str, key: str) -> set[str]:
    names, offset = set(), 0
    while True:
        page = sb_request("POST", f"/storage/v1/object/list/{BUCKET}", key,
                          {"prefix": prefix, "limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}})
        names.update(o["name"] for o in page if o.get("name"))
        if len(page) < 1000:
            return names
        offset += 1000


def upload(path: str, data: bytes, ctype: str, cache: str, key: str) -> None:
    sb_request("POST", f"/storage/v1/object/{BUCKET}/{path}", key, data,
               {"Content-Type": ctype, "x-upsert": "true", "cache-control": cache})


def synth(text: str, xml_lang: str, voice: str, key: str, region: str) -> bytes:
    ssml = (
        f"<speak version='1.0' xml:lang='{xml_lang}'><voice name='{voice}'>"
        f"<prosody rate='{RATE}'>{escape(text)}</prosody></voice></speak>"
    )
    req = urllib.request.Request(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
        data=ssml.encode("utf-8"),
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": FORMAT,
            "User-Agent": "kg-chart-audio",
        },
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3:  # back off only on throttling
                raise
            time.sleep(2 ** attempt)


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows console + Tamil text
    except Exception:
        pass
    args = sys.argv[1:]
    force, dry = "--force" in args, "--dry-run" in args
    lang = args[args.index("--lang") + 1] if "--lang" in args else "ta"
    if lang not in VOICES:
        sys.exit(f"Unknown language '{lang}'. Known: {', '.join(VOICES)}")
    xml_lang, male, female = VOICES[lang]

    sb_key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not sb_key:
        sys.exit("Set SUPABASE_SERVICE_KEY first (Supabase > Project Settings > API > service_role).")
    az_key, region = os.environ.get("AZURE_SPEECH_KEY"), os.environ.get("AZURE_SPEECH_REGION")
    if not dry and (not az_key or not region):
        sys.exit("Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION first.")

    texts = fetch_texts(lang, sb_key)
    chars = sum(len(t) for t in texts)
    print(f"[{lang}] {len(texts)} unique texts, {chars} characters per voice, {chars * 2} for both voices")
    if dry:
        for t in texts[:10]:
            print(f"   {fnv1a8(t)}  {t}")
        print("Dry run: nothing generated or uploaded.")
        return

    failed = 0
    have = {}
    for g, voice in (("m", male), ("f", female)):
        prefix = f"audio/{lang}/{g}"
        in_storage = set() if force else list_storage(prefix, sb_key)
        todo = [t for t in texts if force or f"{fnv1a8(t)}.mp3" not in in_storage]
        print(f"\n{voice}: {len(texts) - len(todo)} already uploaded, {len(todo)} to do")
        for n, t in enumerate(todo, 1):
            name = f"{fnv1a8(t)}.mp3"
            local = CACHE / lang / g / name
            try:
                if force or not local.exists():
                    local.parent.mkdir(parents=True, exist_ok=True)
                    local.write_bytes(synth(t, xml_lang, voice, az_key, region))
                upload(f"{prefix}/{name}", local.read_bytes(), "audio/mpeg", "max-age=31536000", sb_key)
                in_storage.add(name)
                print(f"  [{n}/{len(todo)}] {name}  {t}")
            except Exception as e:  # keep going; rerun picks up what's missing
                failed += 1
                if isinstance(e, urllib.error.HTTPError):
                    e = f"{e.code} {e.read().decode('utf-8', 'replace')[:200]}"
                print(f"  [{n}/{len(todo)}] FAILED {t}: {e}")
        if force:
            in_storage = list_storage(prefix, sb_key)
        have[g] = sorted(n[:-4] for n in in_storage if n.endswith(".mp3"))

    # clips.json = hashes that really exist in storage; the app only plays clips listed here.
    manifest = {
        "lang": lang,
        "rate": RATE,
        "voices": {"m": male, "f": female},
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "m": have["m"],
        "f": have["f"],
    }
    upload(f"audio/{lang}/clips.json", json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
           "application/json", "max-age=60", sb_key)
    print(f"\nclips.json: {len(have['m'])} male, {len(have['f'])} female (of {len(texts)} texts)")
    print("Done." if not failed else f"Done with {failed} failures - run again to retry them.")


if __name__ == "__main__":
    main()
