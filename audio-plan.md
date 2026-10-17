# Phase 9 — Native audio (Azure Speech, pre-generated)

Status (17 Oct 2026): **step 1 delivered** (generator script). Steps 2–3 not started.

## Decisions
- Storage: Supabase Storage, bucket `vocabulary-assets`, folder `audio/`. Loaded on first play, then cached by the browser.
- First language: Tamil. Both voices (♂ Valluvar / ♀ Pallavi). Clips 15% slower (`-15%`), same as the Burmese app.
- The PC script reads the words and uploads the clips itself, using `SUPABASE_SERVICE_KEY` (env var on the PC only).
- 🔊 on: Chart cards, Flashcards, topic question, every quiz type, Build the Word (after answering).
- Quizzes: 🔊 on the native prompt and on each native option; auto-play the correct word when the answer shows.
- New quiz types: **Listen → Image** and **Listen → Native text**. Both required for unlocking.
- Unlock rule becomes: every word **2×** in each of **6** types (Colours = 120 answers, same as today).
- Topics already completed stay completed.
- No clip yet: Listen → Image shows the native text instead; Listen → Native text shows the English word or the image instead. The word still counts.
- 🐢 slow replay (plays at 0.7× in the browser, no extra clips). Mute toggle for auto-play (Listen quizzes still play).
- Mute + ♂/♀ remembered on the account (not just the device).

## File + hash contract (script and app must match)
- Text = NFC, trimmed, inner whitespace collapsed to single spaces.
- Hash = FNV-1a 32-bit over the UTF-8 bytes, 8 lowercase hex chars.
- Clip URL: `https://ulgrfumbwjovbjzjiems.supabase.co/storage/v1/object/public/vocabulary-assets/audio/<lang>/<m|f>/<hash>.mp3`
- Manifest: `audio/<lang>/clips.json` → `{ lang, rate, voices, generated_at, m:[hashes], f:[hashes] }`. The app only plays hashes listed here.

## Step 1 — run the generator (Tamil)
1. Copy `handoff/tools/gen_kg_audio.py` to `KG_chart_new/tools/gen_kg_audio.py`.
2. Add `audio-cache/` to `KG_chart_new/.gitignore` (local copies of the clips; they stay off GitHub).
3. Save the service key once (Supabase → Project Settings → API → `service_role` → Reveal):
   `setx SUPABASE_SERVICE_KEY "paste-key-here"`. Then close and reopen the terminal.
   Never put this key in `index.html`, the repo, or chat. It bypasses all database rules.
4. In `KG_chart_new`: `python tools/gen_kg_audio.py --dry-run`. You should see about 230–240 unique texts and their character count.
5. `python tools/gen_kg_audio.py`. It makes male, then female clips, uploads each one, and writes `clips.json` at the end.
6. Check: open `https://ulgrfumbwjovbjzjiems.supabase.co/storage/v1/object/public/vocabulary-assets/audio/ta/clips.json` in a browser. Copy one hash from the `f` list into the clip URL above and play it.
7. If anything failed, run step 5 again. It only does what's missing.

Troubleshooting
- `mime type ... not supported` on upload: Supabase → Storage → vocabulary-assets → Edit bucket → allowed MIME types: add `audio/mpeg` and `application/json` (or clear the list).
- `401` / `403` from Supabase: wrong or missing `SUPABASE_SERVICE_KEY` (anon key won't work for uploads).
- Azure `401`: check `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION`. Azure `400`: a voice name is wrong; check the gallery.

## Checklist
1. ✅ Decisions (above).
2. ✅ Generator script `tools/gen_kg_audio.py` (reads DB, generates, uploads, writes clips.json).
3. ☐ Run step 1 for Tamil (you).
4. ☐ Step 2: `speak(text, lang)` player in `index.html` + 🔊 buttons (Chart, Flashcards, topic question, quiz prompt + options, Build the Word), auto-play on answer, 🐢 slow, mute, ♂/♀, saved on the account (needs a small SQL file for the settings column).
5. ☐ Step 3: Listen → Image + Listen → Native text quiz types; unlock rule 2× × 6 types; existing completions kept.
6. ☐ Admin: list words with no clip (optional).
7. ☐ Phone test: ♂/♀, mute, 🐢, a word with no clip, an edited word (new hash → fallback until the generator is rerun).
8. ☐ Other languages: `python tools/gen_kg_audio.py --lang ms` (and my, zh, ko, th, te, si).
9. ☐ README: "add/edit words → rerun the generator".

## Rules
- Azure and service keys stay in PC env vars. The browser never calls Azure.
- Editing a word in admin changes its hash, so it falls back to text until the generator is rerun.

## Later (separate phase)
Pronunciation assessment (speech recognition). Needs a Supabase Edge Function to hold the key.
