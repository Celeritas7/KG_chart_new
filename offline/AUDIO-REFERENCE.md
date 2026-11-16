# Burmese Study reference: offline audio follow-up

Inspected Burmese_study_app_advanced main b98a4425cae60f83dd0d55439ee2474dd90d7859,
particularly js/app-audio.js, js/speak-audio.js and sw.js. Burmese uses retryable
catalog loading, local recorded clips, and a stable audio cache. Its shell uses
network-first fallback, which is not copied: KG needs local-first startup on a
slow or stalled connection. Burmese itself is unchanged.

KG already downloads both available voices and clips.json into account-owned
language packs. This patch reuses these existing packs, keeps the shared online
player and generated filenames, and adapts the retryable catalog approach:

- Read the active account's downloaded catalog directly before network access.
- Retry failed catalogs on reconnect/controller change or subsequent load calls.
- Refresh catalog when a newly downloaded pack becomes active.
- Preserve a valid catalog if refresh fails; clear in-memory catalogs on logout.
- Serve cached MP3 single-byte-range requests with 206/416 responses. This is an
  additional KG compatibility fix, not code copied from Burmese.

No database version/cache-name changes, deletion, migration, cloud mutation, merge
or deployment. Existing online source files remain unchanged; the build substitutes
only offline catalog loading. Shared-image deduplication remains Phase 2 work.

Validation: npm run check:unified passes 28 tests and all builds. Added tests cover
catalog recovery, saved catalog playback lookup without network, logout, completion
refresh and MP3 ranges. Physical device playback is not verified by these mocked
checks. On an isolated preview, download Burmese/Chinese packs, enable Airplane
mode, fully reopen, and test female/male and slow playback after a refresh.
