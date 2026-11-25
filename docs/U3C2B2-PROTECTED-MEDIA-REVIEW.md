# KG Chart U3C2B2 — Protected media call-site and picture readiness

**Base:** merged U3C2B1 PR #85, main `ba3f1c68ff68c20e927716b213ef5898fb06ea45`.
**Scope:** complete online learner media call-site integration, stage assets for offline/unified candidates, and provide isolated regression tests. This PR does not enable restrictions or make production Storage private.
**Safety:** `U3C1_SCOPED_UI_ENABLED=false`. U1–U3C2 SQL/private media registry, bucket and Edge deployment still require separate approved rollout. Existing learning data, language packs, storage keys, service workers, Cloudflare, OAuth and C4C draft #74 remain untouched.

## Changes

1. Source-identified voice playback on chart autoplay, word builder, type-the-word, MCQ (audio buttons, answer previews, autoplay and hotkey), Say It, sentences (options, line feedback), Speak paragraph/lines, colour phrases, flashcard pronunciation and pronunciation feedback. IDs are actual word UUID/topic, sentence UUID+verified group or colour phrase UUID. The shared text-hash clip path remains **only for verified legacy users while restrictions are off or explicitly legacy**. Unknown/restricted mode does not fetch or fall back to the public hash catalog.
2. Short-lived signed private audio uses `KGAudio`'s source-aware signer, checks policy and cancels stale requests on account/language switch. Playback error after a possible expired token can reauthorize the exact same resource **at most once** to support later byte-range requests. NotAllowedError prompts the learner to tap again rather than pretending playback succeeded. Audio expiry and iOS gesture acceptance are *not* verified on a physical device.
3. `js/kg-protected-image.mjs` is a non-persistent, source-aware private image downloader. It requests the existing signed signer per image, immediately fetches bytes using `cache:no-store`, `redirect:error`, `referrerPolicy:no-referrer`, validates MIME/size and returns a revocable **memory-only Blob URL**. No token or private media is cached in IndexedDB/CacheStorage/localStorage or inserted into a rendered `img` src. It rejects missing, forged, denied, oversized and unsupported content.
4. Chart/detail/Say It/word-builder/type-word/flashcard/typing pictures use `ProtectedWordImage` with owner/revision/source-aware asynchronous teardown and Blob URL release. Ordinary online and offline legacy images remain unchanged while gate is OFF.
5. Word-picture quiz options and prompts use an account/revision/question-keyed **verified-picture preloader**. The timer remains paused until every required private image is fetched and confirmed. Denied or missing images produce a non-scoring retry/skip state. On change/unmount, abort outstanding requests and revoke Blob URLs; do not reuse expiring private signatures to warm the next question. The old public preloader is retained for legacy mode. The legacy picture downloader is suppressed under restricted mode; **U3D must implement account-scoped private offline pack rules**.
6. `tools/build-offline.mjs` bundles the picture module into both app shells without changing installation IDs, cache/IndexedDB schema, existing outbox or media cache bytes. Unit tests use fictional assets and a network-free mock fetch, asserting revocation, no storage, no public fallback, allowed MIME and size, denied requests, cancellation, and complete source-bound call-site coverage.

## Remaining release prerequisites — do not activate restricted users

- The **existing public** `vocabulary-assets` objects (including media shared by public/private words) cannot be retroactively confidential. Validate backups, classify shared hashes and current public URL use; copy verified private-exclusive bytes to an approved private bucket only under a separate user-approved and rollback-safe operation.
- U3A and U3C2 contracts still declare `server_enforced:false`; SQL RLS, RPC/Edge signer and topic mapping must be deployed, reviewed and proven before a release sets them true.
- U3D needs per-user offline entitlements, account switch, policy revision and stale public-pack/revocation safeguards without clearing installed packs or queued work. Offline pronunciation assessment remains online-only.
- U4 and unified C5/C6 require real Android and iPad installed-PWA testing, OAuth and airplane mode, audio user-gesture behavior, image decode, short URL expiry/byte-range renewal, policy revoke and rollback; synthetic Chromium tests do **not** replace this.
- C4C/C4D requires source-pinned dual artifacts, durable recovery/rollback, actual production settings and explicit production approval. Two previously observed high-severity npm dependency advisories require triage.

## Required review evidence

- [ ] U3C2B2 synthetic image/audio/source-inventory tests pass at final head.
- [ ] Existing U3C2A and U3C2B1 authorization tests pass.
- [ ] Offline/unified compilation, offline regression, unified artifact contract and network-isolated Chromium migration/rollback pass.
- [ ] No SQL/Edge/Storage/Cloudflare writes, source gate remains OFF, no PWA data or outbox deletion.
- [ ] PR reviewed and merged only with owner approval; **merging alone does not authorize release**.

**Release verdict:** SOURCE PREPARATION ONLY, production restricted-friend invitation remains **NO-GO** until U3D/U4 plus coordinated backend/media and deployment gates.
