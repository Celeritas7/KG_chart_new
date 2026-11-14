# KG Chart Offline — implementation record

**Status (Phase 1): preview shell only.** `npm run build:offline` builds the
existing learner UI and quiz code from **the same `index.html` revision** used
by GitHub Pages. It compiles JSX during the build instead of fetching Babel at
startup; React, Supabase JS, Tailwind CSS, Unicode fonts, audio and shared UI
utilities are included as local files. Ten language converters are vendored
from `Celeritas7/language-utils` at commit
`181665902bfa04ac9adf861777535df68149d78f`. Refresh and audit these
copies when the source utilities change.

**Not implemented in Phase 1:** authorized offline login, complete lesson
packages, audio/image downloads into versioned packs, offline quiz persistence,
outbox synchronization, migrations and cross-device conflict resolution. The
preview explicitly prevents opening the learner while disconnected, even if
browser auth tokens are present. **Do not install it expecting offline study.**

## Source and data audit

- Repository baseline: `Celeritas7/KG_chart_new` main,
  `fc6880bdab1d96191bb0294c9fe343de0b6b3c5f` (12 Nov 2026).
- Production database: Supabase project `ulgrfumbwjovbjzjiems`, Storage
  bucket `vocabulary-assets`. **No production SQL or storage was changed.**
- Current `sw.js` only precaches `offline.html` and the logo. Navigation
  tries the network first; `js/image-downloads.js` caches **pictures only**,
  and `js/image-store.js` recognizes only one public Storage path.
  No vocabulary/translation/config or user-progress data is cached.
- The online `index.html` fetches React, ReactDOM, Babel, Tailwind, Supabase
  JS and Google Fonts at runtime, and language converters from another
  GitHub Pages host. Recorded audio comes from `audio/<lang>/clips.json`
  and individual MP3 URLs. Existing audio preferences are mirrored to
  localStorage but online account writes are not queued.
- Actual authorization RPC `kg_chart_is_allowed()` checks confirmed email
  against `kg_chart_users` or admin privileges, **not** an
  `kg_chart_allowed_emails` table as an outdated code comment suggests.
  RLS also guards published learning content and user rows. Client-side
  `private_lessons` settings hide certain topics and sentence groups.
- Content: `kg_chart_languages`, `kg_chart_topics`,
  `kg_chart_topic_translations`, `kg_chart_vocabulary`,
  `kg_chart_vocabulary_translations`, `kg_chart_sentences`,
  `kg_chart_colour_phrases`, `kg_chart_settings` and Storage assets.
- Personal data: `kg_chart_user_ratings` (unique on
  user/vocabulary/language), `kg_chart_quiz_sessions` and
  `kg_chart_quiz_answers` (UUID primary keys; answer rows refer to sessions),
  `kg_chart_topic_completions`, `kg_chart_user_levels`,
  `kg_chart_user_prefs`, `kg_chart_topic_unlocks`,
  `kg_chart_progress_resets`, plus pronunciation attempts and reviews.
  The path computation uses `kg_chart_my_answers(p_lang)`.
- Existing quiz persistence often creates a session with a server-generated
  ID and then separately inserts its answers. It has no outbox and no
  retry-safe event ID on the client. Losing a connection can therefore lose
  or partly save a result. An offline client must change this pattern.

## Quiz and asset inventory for Phase 2

| Activity | Data required offline | Extra assets / limitations |
| --- | --- | --- |
| Native → Image, Image → Native, Devanagari → Image | Vocabulary + translations + topics | Download and decode every selected picture; emoji variants are rendered locally |
| English → Native | Vocabulary + translations | Language converter for generated hints |
| Listen → Image, Listen → Native | Vocabulary + translations | `clips.json` and all referenced MP3s; missing clips must be labeled |
| Build the Word, Type the Word | Vocabulary + translations + level/rule config | Converter / grapheme segmentation; no network required after pack |
| Sentence building, listening/speaking, typing copy/recall | `kg_chart_sentences`, vocabulary, level/rule config | MP3 clips as available; spoken answers currently self-rated |
| Colour phrases | `kg_chart_colour_phrases`, pictures, vocabulary | Recorded audio where published |
| Pronunciation assessment | Authorized account, microphone | **Internet required:** `kg-pronounce` Supabase Edge Function calls Azure; do not pretend it works locally |
| Content flags, admin edits, sharing, account recovery | Server access | **Internet required** |

Language selection alone must not mark a pack ready. An installer must
enumerate *actual* quiz assets, validate their contents and retain unavailable
audio as explicitly missing rather than silently claiming completeness.

## Isolated builds and releases

- `npm ci && npm run check:online && npm run build:offline && npm run test:offline`.
- Output `offline-dist/` is generated and ignored by Git; the GitHub Action
  uploads a reviewable artifact. The source commit is in `version.json`.
- All shell URLs are local. `static-manifest.json` lists exact SHA-256 hashes
  and sizes for generated files. The offline service worker installs the
  complete shell cache before activation, uses **cache-first navigation**,
  does not force `skipWaiting()`, and retains previous complete shell caches.
  This is independent of online `sw.js`.
- The offline manifest has a different name, ID and scope. **A distinct host
  is still required.** Two projects under
  `https://celeritas7.github.io/<repo>/` are on the *same origin*, so they
  do not meet isolation requirements merely by using different paths.
  Deploy to a separate hostname (e.g. a dedicated Cloudflare Pages origin);
  configure a separate OAuth redirect URL there; then verify installation.
- For tagged releases, build both editions from the *same immutable Git tag*,
  run checks against both, upload the offline artifact, deploy it to the
  isolated origin, and record the live URL + installed-app test result.
  No deployment or release tag has been created by this phase.

## Required Phase 2: packs and authorized offline access

1. Online setup must authenticate through Supabase Auth, call `getUser()`
   and `kg_chart_is_allowed()`, fetch the user's permitted lessons/settings
   and show pack sizes before download. Check private-lesson visibility before
   writing content. Never cache another user's private lessons in a public
   shared storage bucket.
2. Ask for a device PIN or equivalent locally verified factor and encrypt
   account-specific snapshots and outbox rows with a derived key in IndexedDB.
   Scope storage to the immutable user UUID. Lock/erase the in-memory key on
   logout or account switch; keep the unsent ciphertext for explicit recovery.
   A copied browser profile and a weak PIN are still potential local risks.
3. Package vocabulary, topic translations, sentences, configuration, all
   recorded MP3s and decoded images. Maintain a pack-manifest revision and
   SHA-256 per asset (not just URL). A replacement image at the same URL must
   trigger a change on the next publish/check. A trustworthy publishing hook
   must update the manifest whenever Supabase content/Storage changes.
4. Download missing assets with bounded concurrency and byte progress,
   remaining bytes, failed URLs, pause/resume and quota handling. Keep partial
   downloads in staging, reuse previously verified unchanged assets and
   activate only after every required file + schema is verified. Keep the
   prior complete pack on failure. Persist changes through app updates.
5. Start from the last complete local pack without awaiting auth/network
   calls. After unlocking, overlay current entitlement *snapshot*; require
   periodic online re-verification. Revocation **cannot be detected while
   truly offline**. After the validation lease expires, lock access until
   verified online; do not bypass RLS or sync for a revoked account.
6. Resume checks when opened/online/visible. `navigator.connection.type`
   only sometimes identifies Wi-Fi. `effectiveType === '4g'` is a speed
   class, not a cellular indication. Explain that service-worker background
   downloads are not guaranteed when an app is closed.

## Required Phase 3: durable outbox and bidirectional sync

- Persist each quiz session and its answers **together in one IndexedDB
  transaction before displaying Saved on this device**. Generate stable UUIDs
  for both. On reconnect insert with those IDs; retrying `23505` duplicates
  must query and verify the existing owned row before considering the event
  acknowledged. Do not use an unguarded upsert: existing RLS grants INSERT
  but not UPDATE for quiz sessions/answers. Upload sessions before answers.
- Store every local change with `event_id`, `user_id`, logical timestamp,
  entity/key, operation and base version. Never replay an event if its user ID
  differs from the currently **server-verified** signed-in account. Require
  reauthentication after a token expires; do not discard unsent records.
  Use a cross-tab lock to prevent two simultaneous uploaders.
- Sync rules to implement/test:
  - **Quiz history:** append-only, stable UUID deduplication; never delete
    remote historical results because a second device lacks them.
  - **Ratings/learned words:** per word, not whole-table replacement.
    Compare acknowledged versions/timestamps; surface concurrent edits
    rather than silently replacing newer remote work. Deletions are tombstones.
  - **Settings:** per-field merges; voice choice uses a documented last-edit
    rule; typing best merges max speed with newest attempt details.
  - **Topic completion:** monotone completion unless a later explicit
    `kg_chart_progress_resets` event invalidates earlier completions.
  - **Quiz level:** derive progression from merged answer history and
    existing server rules, not an old device's stale level number.
  - **Deletions:** versioned tombstones so a disconnected device cannot
    unintentionally resurrect deleted state.
- Pull remote deltas on reconnect (and first setup), merge and acknowledge
  them transactionally before showing Synced. Use server-side transactional
  RPC or an operation ledger for true exactly-once multi-table results;
  design that migration as **backward-compatible** with existing online app.
  Provide account-scoped encrypted outbox export/recovery and explicit
  pending/error/last-successful-sync indicators.

## Required Phase 4: release and device verification

- Simulate airplane-mode cold launch *after a complete downloaded pack* on
  Android Chrome and desktop, and examine installed PWA startup separately.
- Exercise offline quiz types, stalled 4G, concurrent downloads, interrupted
  updates, corrupted/changed URLs, quota exhaustion, rollback, two tabs,
  device conflicts, account switching, revoked permissions and expired OAuth.
- Verify current online GitHub Pages behavior and both builds from one tag.
- Confirm a **different live origin**, Supabase OAuth allowlist, installable
  manifest, installed app's icon/name and actual cold start. No live offline
  URL or fully offline-ready claim is valid before these pass.
