# KG Chart

Picture-chart vocabulary app for learning Asian languages through Devanagari. Learners see each word in its native script, in Devanagari and in English, hear it in a male or female voice, and work through topics by quiz.

- **Live app:** `index.html` (GitHub Pages, repo `Celeritas7/KG_chart_new`)
- **Admin:** `kg-chart-admin.html`
- **Database:** Supabase `ulgrfumbwjovbjzjiems`. Images and audio in Storage bucket `vocabulary-assets`.
- **Script converters:** loaded from `celeritas7.github.io/language-utils`, not from this repo.

Languages with audio: Tamil, Burmese, Chinese, Korean, Thai, Sinhala, Malay, Japanese. Telugu is inactive (no content yet). Marathi is planned.

## Run locally
Double-click `run-kg-chart.bat`. It opens the app at `http://localhost:8142/`. The admin is at `/kg-chart-admin.html`. It needs Node.js, or falls back to Python.

## Folders
```
index.html, kg-chart-admin.html   the two pages (must stay at root)
js/          browser code loaded by the pages (kg-audio.js)
tools/       scripts run by hand: kg-serve.js, upload_images.js, gen_kg_audio.py
sql/         SQL for the Supabase SQL editor, one file per change
docs/        plans, roadmap, notes, build history
data/        CSVs for import
```
Local only (in `.gitignore`): `images/`, `audio-cache/`, `workspace/`, `archive/`, `node_modules/`. Full layout and rules: `docs/STRUCTURE.md`.

## Common tasks
- **Generate audio for a language:** `python tools/gen_kg_audio.py --lang ta` (add `--dry-run` to count first). Needs the Azure Speech key; see `docs/audio-plan.md`.
- **Upload images:** `node tools/upload_images.js`.
- **Add a language:** add the row in admin → Languages (or an `add-<lang>.sql` in `sql/`), import words from the admin CSV template, then generate audio.
- **Database change:** put it in a new file in `sql/` and run it once in the Supabase SQL editor. Every file there is safe to run twice.

## Where things stand
See `docs/roadmap.md`. Next up: Type the Word quiz (phase 10, built, needs a phone test), Marathi (phase 11), unlock rules set in the admin (phase 12).

Earlier phases (RLS, users, learning path, Build the Word, images page): `docs/history-phases-1-8.md`.
