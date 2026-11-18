# Friends' names practice

The read-only source check on 2026-11-18 found one word explicitly tagged
`source = 'friends'` in `burmese_app_words`. Other textbook names are not imported.
Personal names and the learner's email are not included in repository files.

## Release steps

1. Review and merge the UI PR. This adds a **Topic** selector to Quiz → Typing
   and a **Practise names** shortcut on the new chart topic.
2. Obtain explicit approval before running `import-friends-names.sql` on the
   production database. It is not executed by a build, preview, merge or deploy.
3. In the same SQL session, set `kg_chart.friends_learner_email` with
   `set_config` as shown at the top of the script, then execute the script.
   Confirm the returned spellings against the source rows.
4. In the connected app, reload and open Burmese → Friends' names → Practise
   names. Choose **Copy the word**, then **Type from memory**.
5. For the installed app, use Settings → Study offline → Burmese →
   **Check / update pack** to save the new topic, spelling and unlock. Then test
   both typing modes offline. No new image or audio files are required.

The import uses existing tables and policies. It adds a menu-filter rule for the
selected learner using the existing `private_lessons` configuration; admins can
still see it, and this UI rule does not add database-level privacy. Approved KG
Chart users retain their existing read access. Existing settings are retained.

The source spelling is copied exactly. The import can be rerun after approved
source additions/corrections: imported vocabulary UUIDs are reused, preserving
ratings and answers. It does not delete entries removed from the source and does
not run automatically. KG Chart's normal pack refresh distributes imported
changes; it is not a live cross-app vocabulary sync.

The one-name topic is available in typing and cards. It is excluded from the
Words quiz's questions and distractors, so missing name photos/audio cannot break
those quizzes. It does not gate progression to the next regular topic.
There is no new audio recording or handwriting recognition in this change.

## Verification

- `npm run check:unified`: all app builds and automated offline checks.
- `node --test offline/tests/typing-topic.test.mjs`: typing topic filtering,
  copy/recall, missing selections and language changes.
- `node tools/test-friends-import.mjs /absolute/path/to/pglite/dist/index.js`:
  run the data import in isolated PostgreSQL with synthetic names. Validated
  with `@electric-sql/pglite@0.5.16`; it is a test tool, not an app dependency.
- Android/iPad: confirm the chosen name, one-name practice, keyboard input,
  offline reopening and reconnect sync after the separately approved import.
