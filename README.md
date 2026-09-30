# KG Chart — Admin panel patch + RLS handoff

## 1. `kg-chart-admin-patched.html`
Drop-in replacement for `kg-chart-admin.html` (same folder, same relative links). All Supabase logic is untouched. What changed:

- **Sidebar** now matches the design system: dark jade shell (`--sidebar-shell`, per-theme token), light rounded nav card, translucent header/footer dividers. Works in all 4 themes.
- **Flags page stat tiles**: Open flags / Vocabulary / Missing translations at the top (warn color when non-zero).
- **Accessibility**: flag rows expand via a real `<button aria-expanded>`; nav items are keyboard-operable (Tab + Enter/Space); `:focus-visible` rings on buttons, tabs, nav, theme swatches.

## 2. `kg-chart-rls.sql`
Run once in the Supabase SQL editor (Dashboard → SQL). Idempotent. It:

- Creates `kg_chart_admins` (seeded with your admin user id) + a `kg_chart_is_admin()` helper, so admin rights live server-side and adding an admin is one SQL insert — no code change.
- Content tables (`languages`, `topics`, `topic_translations`, `vocabulary`, `vocabulary_translations`): public read, **admin-only insert/update/delete**.
- `kg_chart_flags`: public read; signed-in learners can insert (`status='open'` only); only admin can resolve/dismiss/delete.
- `kg_chart_user_ratings`, `kg_chart_quiz_sessions`, `kg_chart_quiz_answers`: each user reads/writes only their own rows; admin can read all (Quiz Stats page keeps working).
- Storage bucket `vocabulary-assets`: admin-only upload/update/delete (public read unchanged).

## 3. Tamil support (Phase 3)
- `language-utils/tamil.js.txt` — new converter for the `language-utils` repo. Drop the `.txt` and commit as `tamil.js` at the repo root, next to `sinhala.js`. Exports `toDev`, `toRoman`, `breakSyllables`. Applies Tamil positional voicing: word-initial/doubled stops hard (க→क), post-nasal clusters voiced with anusvara (ங்க→ंग, ந்த→ंद), intervocalic soft (க→ग, ச→स). Handles decomposed ொ/ோ/ௌ via NFC, and ஃப→फ़.
- `index-patched.html` + `kg-chart-admin-patched.html` now map `ta` → `tamil.js` and load Noto Sans Tamil.
- `tamil-tester.html` — open to check 34 sample words + a live input box.
- `language-utils/telugu.js.txt` — replacement engine for the CDN (the current file there is chart data with no `toDev`). Same pure-lookup pattern as `sinhala.js`; drop the `.txt` and overwrite the repo-root `telugu.js`.
- Files are stored as `.js.txt` here only so this project's build doesn't treat them as its own modules.
- **Tamil won't show in the dropdown until it has a DB row** — run `add-tamil.sql` (inserts `ta` into `kg_chart_languages`, `is_active = true`). Tamil text in the learner app now uses Noto Sans Tamil (`LANGUAGE_FONTS.ta`).

## 4. Burmese converter fixes (Phase 2)
`language-utils/burmese.js.txt` → overwrite `burmese.js` in the repo root.
- Stacking mark `္` → conjunct (ကမ္ဘာ → कम्भा), kinzi `င်္` → anusvara (မင်္ဂလာပါ → मंगलाबा), great-sa `ဿ` → थ्थ.
- Tone marks `း` `့` no longer emit digits; override values cleaned (`बा2` → `बा`).
- Medial ha `ှ`: ရှ/ယှ → श, မှ/နှ/လှ → ह्म/ह्न/ह्ल (was `रह्ू`). `ည်` → ी. Myanmar digits → Devanagari digits.
- `breakSyllables`: final consonants (before `်`/`္`) stay with their syllable — တစ်·ရှူး, ဟုတ်·ကဲ့.

## Notes
- The anon key in the HTML is designed to be public **once RLS is on** — after running the SQL it grants nothing beyond these policies. The client-side `ADMIN_USER_ID` check is now just UX; enforcement is server-side.
- `upload_images.js` (Node) — if it uses the service-role key it bypasses RLS and keeps working; never ship that key to the browser.
- Test after applying: sign in as a non-admin and try editing a language — it should fail with a policy error.

## 5. User table + access (learner app)
- Run `kg-chart-users.sql` once, after `kg-chart-rls.sql`. If you ever re-run `kg-chart-rls.sql`, run the users file again after it.
- Creates `kg_chart_users` (`id`, `email`, `role`, `name`) — same shape as your other apps' auth tables — seeded with your admin email. Add people as rows in the Table Editor, or with the insert at the bottom of the file. `role` is `admin` or `operator`; admin rows also get admin rights (content edits, image uploads).
- The server enforces it: only a *confirmed* account whose email is in the table can read content, flags, or save ratings and quizzes.
- `index-patched.html` now opens on a sign-in card. After sign-in it checks the email with `kg_chart_is_allowed()`. Anyone not in the table is signed out straight away with an error message.
- The admin panel was already locked to `ADMIN_USER_ID`, so nothing changed there.
- Images in `vocabulary-assets` stay publicly readable by URL. They're just pictures, with no words or progress attached.

## 6. Build the Word quiz (learner app)
New **🧩 Build the Word** type in Quiz. Pick it, then set these options (they're remembered):
- **Prompt:** Image, English word, or Mix. Image falls back to English if the item has no image or the image fails to load.
- **Split into:** Characters (one tile per consonant, vowel sign, medial or asat; combining marks show on a dotted circle ◌) or Syllables (`breakSyllables()` from language-utils, falling back to grapheme clusters). This works for every language.
- **Tiles:** correct pieces only, or correct pieces plus 2–6 extra tiles drawn at random from the language.
- **Feedback:** Check at the end, or Mark each tile. Mark each tile shows green/red as you place; tap a red tile to remove it.
- **Hint button** on/off. A hint drops any wrong tail and places the next correct piece.
- Keyboard: Backspace removes the last tile, Enter checks or moves to the next word.
- The answer (script, Devanagari, English) shows after each word.
- Results save to Quiz Stats as `quiz_type = 'word_builder'`, with what was built in `kg_chart_quiz_answers.answer_text`. The users SQL adds that column (and `selected_vocabulary_id`, which the table was missing — the regular quiz's per-answer saving had been failing silently) and allows the new quiz type.

## Development phases — upcoming

### Phase 7 — Fix: Native ↔ Image quiz shuffling (bug) — ✅ fixed in `index-patched.html`, tested ✓
- **Cause:** when you pick one topic, the filtered word list was rebuilt on every render. That made the question generator run again, reshuffle, and re-render, in a loop. All topics reuses the same list, so it stayed stable.
- **Change:** the filtered lists are now memoized. Every question's 4 options are picked and shuffled once in `startQuiz`, then only read back afterwards. The biased `sort(() => Math.random() - 0.5)` was replaced with a proper shuffle.
- **Symptom:** In the Native → Image and Image → Native quizzes, the MCQ images and the question order keep reshuffling rapidly as soon as the quiz starts, so the test never settles.
- **Scope:** Happens only when a **specific topic** is selected. **All topics** is stable.
- **Fix:** Build the question list and each question's options once when the quiz starts, then freeze them for the whole session. Filtering by topic must not re-trigger a shuffle, a re-fetch, or an image reload.
- **Test:** Run both quiz types on at least 3 single topics, plus All topics. Options and order stay fixed until Next is pressed.

### Phase 8 — Guided learning path (topic unlocking) — ✅ built, needs testing
**Deploy:** run `kg-chart-phase8.sql` (after `kg-chart-users.sql`), then deploy `index-patched.html` and `kg-chart-admin-patched.html`. Until the SQL has run, the app behaves as before, with every topic open.
- **Learner app:** locked topics show 🔒 and are greyed out in the topic bar, with faced/total counts. Opening a locked topic shows how far along the previous topic is. The Quiz and Flashcard pickers disable locked topics, and "All" covers unlocked topics only. When a topic completes, a celebration pops up and opens the next topic after 6s. The Progress tab has a new **Learning Path** card: expand a topic to see the words × quiz types strength grid, and tap a word for its detail.
- Quizzes you leave early are now saved too, so every word you faced counts.
- **Admin → Topics:** 👁 Visible / 🙈 Hidden toggle, 🔓 Unlock (pick learners and a language), 🔒/🔓 Admin bypass switch, and ↺ Reset a learner.
- Locking is enforced in the app only. The server doesn't stop a learner from reading locked content.
- **Order:** topics unlock in the admin sort order. A new learner starts with the first visible topic unlocked.
- **Completion:** a topic is complete when **every word** in it has been faced in **at least one quiz type**. Flashcard ratings don't count. Words added to a topic after it's complete are optional, so it stays complete.
- **Locked topics:** greyed out with progress (e.g. 12/20). Everything except the topic list is locked: quiz, learn, chart and flashcards. The "All topics" quiz covers unlocked topics only. When a topic is completed, show a celebration and open the next topic automatically.
- **Hidden topics:** a per-topic Hidden / Visible toggle in admin (for topics without images). Hidden topics are left out of the path completely.
- **Admin:** a bypass setting in the admin panel. Admin can unlock a topic for chosen users from the Topics page, and can reset one user's progress. A reset re-locks topics, keeps the quiz history, and counts only answers given after it.
- **Per language:** progress and unlocks are tracked separately for each language.
- **Strength:** measured per word × quiz type as % correct over the last 5 attempts. Flashcard ratings are mixed in as one attempt: ratings 1–2 = correct, 3 = half, 4–5 = wrong. Colours: grey = not faced, red <40%, amber 40–79%, green ≥80%. A cell is coloured after 1 attempt. Shown as a grid per topic (words × quiz types) and on a per-word detail page.
- **Question order:** fully random.

#### Superseded draft
- **Now:** every topic and section is open from the start.
- **Target:** a new learner starts with **one topic** unlocked. The next topic unlocks only after the current one is completed.
- **Completion rule:** a topic is complete only when the learner has been quizzed on **every word** in the topic **in every quiz type** at least once. That means one saved answer for every word × quiz type pair, whether right or wrong. No minimum score is needed.
- **Open questions:**
  - Which topic comes first, and in what order do the rest unlock (topic `sort_order`?)
  - Can admins skip the gate or unlock topics for a user by hand?
  - Do locked topics stay visible (greyed out, with a progress hint), or are they hidden?
- **Likely build:** progress is worked out from `kg_chart_quiz_answers` for each user × topic × quiz type × word. Locked topics are enforced in the learner app, and optionally server-side as well.

## Images page (admin)
New **🖼️ Images** page in `kg-chart-admin-patched.html`. It lists every vocab item whose file is missing from `vocabulary-assets/<topic>/`. The sidebar badge shows the missing count.
- **🔍 Find image** searches Openverse (CC-licensed) or Wikimedia Commons, pre-filled with the English word. Click a result to resize it to 800px max and upload it to the exact path the learner app reads.
- You can also upload a file, drag and drop, paste (Ctrl/⌘+V), or paste an image URL.
- The source and licence are saved in `extra_data.image_credit`.
- **Open next missing after saving** steps through a topic (e.g. all 12 hotel items) in one go.
- There's also a 🔍 button on each Vocabulary row.
- Uploading needs the admin session (storage RLS from `kg-chart-rls.sql`).
