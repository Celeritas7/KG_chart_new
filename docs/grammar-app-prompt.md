# New app: Grammar Compare (sister app of KG Chart)

Paste this whole file into a new chat as the first message.

## What I want
A grammar app built the same way as my vocabulary app KG Chart. It lets me learn a grammar point by seeing how several languages handle it side by side.

The idea, which I've already checked is sound:
- **The nodes are grammar concepts, not languages.** For example "counters", "past tense", "topic marker", "verb at the end", "politeness endings".
- **Each concept has one entry per language:** the form, 2–3 example sentences, audio, and a short note on how it differs.
- **Each entry says how close it is to the other languages:** `close`, `partial` or `none` (no equivalent). The danger is false matches. は is not the same as a Chinese topic, and one Burmese particle can cover two Japanese ones. A "no equivalent" entry is content too.
- **Start small:** 20–30 concepts. First Japanese and Burmese, which are the most alike (verb last, particles after nouns), then Chinese.
- **One extra column in my own language** to anchor everything. Ask me which one.
- **Show every example in Devanagari too,** as KG Chart does. That's how I read new scripts.

## What already exists (reuse it, don't rebuild it)
KG Chart is on GitHub as `Celeritas7/KG_chart_new`. Read it before proposing anything.
- `index.html`: the learner app. React 18 in one file, with in-browser Babel and Tailwind, no build step, hosted on GitHub Pages.
  Views: Chart (a picture grid per topic), Cards (sort words into 5 rating buckets), Quiz (many quiz types, including Build the Word and Type the Word), Progress, and a Learning Path where topics unlock.
- `kg-chart-admin.html`: the admin page, vanilla JS (content, rules, flags, typed mistakes, pronunciation checks).
- `kg-chart-review.html`: a phone-first page where native speakers check content.
- `js/kg-shared.js`: code shared by the app, admin and review page. `js/kg-audio.js`: the audio player.
- **Script converters:** `Celeritas7/language-utils`, loaded live from `celeritas7.github.io/language-utils`. Each language's `.js` exports `toDev`, `toRoman` and `breakSyllables`. Reuse these for the Devanagari and romanised lines.
- **Audio:** made ahead of time with Azure Speech by `tools/gen_kg_audio.py` on my PC and stored in Supabase Storage (bucket `vocabulary-assets`). The clip name is a hash of the text: FNV-1a 32-bit over NFC-normalised text, with a `clips.json` manifest per language. Example sentences can use the same contract.
- **Pronunciation check:** Supabase Edge Function `kg-pronounce` (Azure pronunciation assessment).
- **Database:** Supabase project `ulgrfumbwjovbjzjiems`, tables `kg_chart_*`. Learner `mangaonkaraniket@gmail.com`, admin `anikettelexistence@gmail.com`.
- Lessons already learned in KG Chart: Burmese typed text has to be normalised before comparing (marks typed in another order look the same on screen), and Zawgyi keyboards break matching.

## What I don't know yet: decide this with me first
1. **Which KG Chart views make sense for grammar?** Go through each one and say keep, change or drop, and why. My guesses:
   - Chart → a grid of concepts, where opening one shows the side-by-side compare view. The compare view is the new main screen.
   - Cards → rate each concept per language with the same 5 buckets.
   - Quiz → new types, e.g. pick the right particle or form, put the words in order (like Build the Word, but for sentences), type the sentence, "which language does this pattern belong to", and match a sentence to its translation in the other language.
   - Progress and Learning Path → probably keep, with levels of concepts instead of topics.
   - Review page → keep. Native speakers checking each language's entries is even more important here.
2. **A separate repo, or a mode inside KG Chart?** Weigh the shared code (login, ratings, audio, review page) against keeping KG Chart simple.
3. **Where the content lives.** Advice I got earlier said to keep it as static files (one JSON or CSV per language, keyed by concept id) so it needs no database. But KG Chart keeps ratings and progress in Supabase, and the admin edits content there. Tell me which you recommend: content in files and progress in Supabase, everything in Supabase, or something else.
4. **The data format:** concept id, level, title, explanation, the per-language form, examples (native text, Devanagari, romanisation, meaning, audio hash), closeness, and notes. Show it on 2–3 real concepts before anything else.

## First steps
1. Read KG Chart (above) and answer points 1–4 briefly, with one recommendation each, not a survey.
2. Draft the first 20–30 concepts for Japanese and Burmese (Chinese marked "later"), with one short example per language. Mark anything you're not sure of with ⚠ so a native speaker can check it. Don't present guesses as fact.
3. Only after I agree: build the smallest working version, which is the concept grid plus the compare view for about 5 concepts.

## How to work with me
- Plain, short explanations. I'm learning Burmese and I'm not a grammar expert.
- Check the code or the data before saying something is broken or works. Say what you tested, and say what you couldn't test.
- One small change per commit, on its own branch. Open a pull request only when I ask. I merge.
- I run the PC scripts myself (audio generation, uploads) on Windows. Give me the exact commands.
- Keys stay in environment variables on my PC, never in the pages, the repo or chat.
- Commit the design docs. In KG Chart, `docs/` and `sql/` were in `.gitignore`, so new chats couldn't see the roadmap.
