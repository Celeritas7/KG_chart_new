# KG Chart Offline — review branch, installation, limitations

> **Status: implementation candidate, NOT a verified deployed/offline-ready release.**
> The online GitHub Pages app stays on its original root files. Do not install an
> offline edition from the online app's origin; use a separately verified origin.

## Audit of the existing application (2026-11-14)

- Source: `Celeritas7/KG_chart_new`, baseline commit `fc6880bdab1d` (2026-11-12).
- Live Supabase project: `ulgrfumbwjovbjzjiems`, bucket `vocabulary-assets`.
- The existing `sw.js` handles a small fallback shell and public picture cache only.
- The existing learner `index.html` fetches React, ReactDOM, Babel, Tailwind,
  Supabase JS, Google Fonts, and `language-utils` from remote services.
- The existing online app writes ratings to `kg_chart_user_ratings`, quiz history
  to `kg_chart_quiz_sessions` and `kg_chart_quiz_answers`, completions to
  `kg_chart_topic_completions`, level preferences to `kg_chart_user_levels`, and
  audio/typing preferences to `kg_chart_user_prefs`. Its server RPCs are
  `kg_chart_is_allowed`, `kg_chart_is_admin`, `kg_chart_my_answers`, and
  `kg_chart_check_level_up`. The **current live schema has no `quiz_level` column**
  in `kg_chart_quiz_sessions`; the offline sync strips that field.
- RLS restricts quiz inserts and user progress to the authenticated/allowed
  account. No RLS, public data, auth restrictions, or existing records were
  changed for this candidate.

## Source layout and isolation

| Location | Purpose |
|---|---|
| `index.html` | Canonical learner UI/quiz logic for **both** editions |
| `tools/build-online.mjs` | Unmodified online release snapshot (`dist-online/`) |
| `tools/build-offline.mjs` | Localizes dependencies and compiles the same learner JSX (`dist-offline/`) |
| `offline/runtime.js` | IndexedDB pack storage, account-scoped facade, durable outbox, sync and management controls |
| `offline/sw.js` | Cache-first offline shell and downloaded media for the owning account |
| `offline/language-utils` | Pinned Git submodule with the converters consumed by the existing learner |
| `.github/workflows/kg-dual-edition.yml` | Builds/checks both from one SHA and publishes matching CI artifacts |

The new offline PWA has an independent `id`, `name`, `scope`, cache prefix and
Supabase auth storage key. **Distinct service-worker and browser storage isolation
also requires deploying to a different origin.** Separate repository paths on
`celeritas7.github.io` alone are *not* separate origins.

The online main application still uses its original CDN URLs and `sw.js` without
changes; the offline edition's generator transforms a copy of that same source
at build time. There is no second, manually maintained copy of its quiz UI.

## Build and release

```bash
git submodule update --init --recursive
npm ci
npm run check:both
```

Review the generated `dist-offline/` directory, then host **only that directory**
on its own HTTPS origin (for example, a dedicated Cloudflare Pages project). Do
**not** point it at the online GitHub Pages domain or route it beneath the
online PWA scope. After review/merge, tag the exact source revision (for example,
`kg-v1.0.0`) to obtain matching online/offline CI artifacts from one commit.
The workflow deliberately does not modify production. There is **no confirmed
offline address or installation** yet.

Before inviting a user to install:

1. Create/identify a separately hosted HTTPS origin for the offline build.
2. Add its exact callback URL to Supabase Auth's redirect allowlist for the
   existing project. Verify Google OAuth and password sign-in **in the installed
   PWA**, including PKCE callback parameters.
3. Complete the live-device acceptance matrix below. Keep the existing online
   deployment unchanged during review.
4. Only then publish an installation URL. On Android Chrome, open the separate
   address and choose **Install app** / **Add to Home Screen**. On desktop Chrome,
   use the browser's **Install KG Chart Offline** command when offered.

### First-time setup

1. Go online, sign into the offline origin using an account the server allows
   through `kg_chart_is_allowed`. Existing online-app storage stays untouched.
2. In **KG Chart Offline → Language pack**, choose a language and select
   **Download pack**. Wait for all required images and recorded audio to pass
   validation. Progress shows files checked, bytes, failures and known size
   remaining. If interrupted, run the same download again; completed staging
   items are reused.
3. Wait for **App shell verified** as well as the downloaded pack. **Ready
   offline** requires confirmation that the service worker installed its
   complete, hashed app shell. Reopen while connected once after installation,
   and then test with airplane mode. Other languages must be downloaded separately.
4. After offline quizzes, the banner shows **Saved on this device** and the
   number of unsent changes. Use **Sync now** on reconnect. **Last successful
   sync** advances only after server writes are acknowledged and remote progress
   has been pulled. Export the recovery JSON before clearing a device or browser.

No existing website storage needs to be cleared. Offline content and account
progress are stored under this new origin; the two editions meet at Supabase,
not through sharing localStorage or service-worker caches.

## Quiz and asset audit

| Existing activity | Required local assets | Current implementation intent |
|---|---|---|
| Native → Image, Image → Native, Devanagari → Image | Words, translations, lesson order, pictures or generated emoji | Downloaded pack + cached images |
| English → Native | Words, translations, lesson rules | Local text data |
| Listen → Image, Listen → Native | Text/images plus available `audio/<language>/clips.json` and referenced MP3s | Downloaded audio; when no recordings exist, existing app's displayed fallback applies |
| Build the Word, Type the Word | Native text, per-language converter, local quiz settings | Shared quiz code; local converters |
| Typing copy / recall | Vocabulary, local keyboard and preferences | Shared typing code, queued sessions/answers |
| Sentence → Meaning, Meaning → Sentence, Build Sentence | `kg_chart_sentences`, translations where available | Downloaded sentence records |
| Colour phrase quizzes (3) | `kg_chart_colour_phrases`, referenced noun/colour vocab, device emoji and optional audio | Downloaded data, locally generated tinted emoji |
| Speak: listen, line-by-line, whole paragraph | Sentence records and available recorded audio | Existing self-assessment works locally; server scoring not involved |
| 🎙️ Pronunciation assessment | Microphone + Edge Function `kg-pronounce` + Azure | **Internet required** — not a locally executable assessment |
| Reporting/flagging content, editing shared vocabulary | Supabase write access | **Internet required** — these are not queued as offline edits |

Emoji rendering may vary by operating system even though app fonts are bundled.
Microphone recording is browser/device-permission dependent. Language packs
download all content needed for a selected language; this is not a guarantee
that every published recording exists for every word.

## Content updates and rollback

An authorized pack check pages through the live Supabase vocabulary,
translations, topics, sentences, colour phrases and lesson settings. These
published records are content-hashed. For the referenced Storage media, the
downloader checks ETag / Last-Modified where available and validates actual
SHA-256 of the bytes before making a version active. A same-URL replacement is
detected by a new remote revision or by fetching/re-hashing media during a
manual/automatic update. The locally generated manifest identifies both the
content revision and each verified media hash. A temporary cache is populated
first, and its pointer becomes active only after validation. A previous pack is
retained for rollback; progress/outbox reside separately and survive upgrades.

**Publishing process:** edits made by an authorized editor to the existing
Supabase tables/Storage are the source of truth; the next connected **Check /
update pack** fetches and hashes the current published state. There is no
separate manual JSON publishing step. A server-generated signed/revisioned
manifest, with incremental ETag-only updates, is a future optimization; the
current client re-downloads media while explicitly checking for changes to
avoid missing same-URL replacements when headers are unreliable. End-to-end
publishing still requires testing with real replaced Storage objects.

Automatic checks happen **while the app is open**, not on an assumed browser
background timer. By default they wait for Wi-Fi that the browser can actually
identify; on browsers that cannot distinguish Wi-Fi from cellular they will
wait, and the user can download manually. `navigator.connection.effectiveType`
values like `4g` describe connection quality, not Wi-Fi technology. Data Saver
also suppresses automatic downloads. Updating never forces a quiz reload.

## Sync conflict and authentication rules

- Every queued write stores its owner UUID and local sequence in IndexedDB in
  the *same transaction* as the updated local view. A failed local write returns
  an error instead of pretending it was saved.
- Quiz sessions and answers use stable client-generated UUIDs. Retried inserts
  query the existing row after a duplicate-key result and only then acknowledge
  identical history, including cases where a response was lost after commit.
- Ratings: compare the remote version with the version last seen locally.
  Concurrent edits/deletions stop with a visible conflict rather than blindly
  replacing the server row. **Resolving a detected conflict requires a follow-up
  UI**, so export unsynchronized data first. More robust compare-and-swap would
  require a backward-compatible server RPC / revision column.
- Topic completion uses the later completion timestamp. Quiz history is
  append-only. Learned-word counts use the existing quiz history/rating logic.
  Offline level unlocks are provisional until the queued session history is
  acknowledged and the server's `kg_chart_check_level_up` RPC succeeds. A
  durable level-check marker survives a failed RPC for retry on reconnection.
- Existing `kg_chart_user_prefs`: audio voice/mute settings are last confirmed
  write; typing personal bests merge by highest CPM. Other quiz-display settings
  currently stored only in localStorage remain device-local, matching the online
  edition; cross-device settings sync would require an explicit schema extension.
- The authorized owner alone can read the local pack through the app. A different
  sign-in or logout locks the old owner, **without deleting** pending work.
  Recovery JSON imports only into the same verified account. Browser storage
  is **not encrypted against someone with unrestricted access to the same device
  and browser profile**; use a device lock / separate browser profile.
- An old approval is trusted only for *offline* access after a verified online
  setup. The server can revoke writes immediately but an airplane-mode device
  cannot learn about that revocation until it reconnects. Sync always verifies
  `getUser` and `kg_chart_is_allowed` on the live server. Expired sessions require
  reauthentication before sync, with the outbox preserved.
- Local database schema is versioned. Incompatible packs are refused rather
  than silently opened. Future migrations must be additive and tested against
  older clients reconnecting after a long absence.

## Tests and release gate

Automated checks completed in this branch:

- The generated offline HTML has no runtime CDN/Tailwind/Babel dependency.
- App shell has hashes and distinct manifest identity; the existing online
  source remains unchanged.
- Offline quiz session and answer writes persist before server acknowledgment.
- A dropped acknowledgment is retried without duplicating a quiz; remote pull
  follows; rating conflicts protect the remote edit, and logout keeps outbox.
- A failed staging download leaves the previous language pack selected; its
  successful asset is reused on retry, and a pack alone cannot claim full
  offline readiness before the app-shell handshake.
- Simulated service-worker cold navigation succeeds with the network stalled;
  shell hash mismatch and storage-full installation failures preserve the
  earlier working shell.

**Not yet proven on a device / real production storage:**

- Airplane-mode cold start *after* a successful live pack download and
  install, including a saturated competing download and stalled requests.
- Real Supabase pack downloads (all languages) and actual MP3/image decoding.
- Quota exhaustion, partial cache update failure, invalid/missing real media,
  and resumed download across browser restarts.
- Installed-app Google OAuth redirects, expired refresh tokens, two browser
  tabs/devices, and genuine server-side simultaneous writes.
- Browser/background differences across Android/iOS/desktop; service worker
  and storage eviction rules vary.
- Distinct offline origin and install entry point; **none has been deployed or
  verified**. Do not claim public offline readiness before these checks pass.

The online app's live source has not been deployed or modified by this branch.
