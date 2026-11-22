# Stage C3 — Synthetic migration and rollback rehearsal (no production release)

**Scope:** Test-only PR against the currently deployed separate-offline edition. C3 changes no app runtime, Cloudflare settings, Supabase project, browser data, or installed PWA. **NOT approval for a production migration.**

## Verified operating baseline (owner screenshots; November 22, 2026)
- Cloudflare Pages project `kg-chart-offline`, repository `Celeritas7/KG_chart_new`, production branch `main`, repository-root build.
- Production build command: `git submodule update --init --recursive && npm ci && npm run check:both`; output: `dist-offline`.
- Production build metadata from clean Chrome Incognito at a versioned deployment URL: `2b7775aef5ac`, `edition: separate-offline`, `schemaVersion: 1`. This proves that versioned deployment's JSON is served; an earlier browser request to a preview JSON path showed the login page instead and needs its own browser/service-worker diagnosis before rollout.
- Earlier Android state: **3 language packs (~85.9 MB)**, 0 unsent changes, Burmese ready offline, Food complete, Vegetables unlocked, 85 published image placeholders, old version `fb4907190a52`. This Android reading predates the latest Cloudflare production commit. **Capture a fresh device baseline before any authorized C4**, without clearing storage.
- Authentication OAuth redirect allowlist and iPad acceptance remain unverified.

## What synthetic tests cover
`offline/tests/c3-synthetic-migration.test.mjs` uses only in-memory fake IndexedDB and CacheStorage at a disposable origin. It seeds two *synthetic* language packs, active-pack and active-cache pointers, a complete legacy image, a shared-picture hash reference, saved audio, ratings, unlock/level and completion records, another owner's rows, and one pending outbox event. It boots the **real shared runtime source** as separate → unified → compatible separate, checking the same storage survives and retains the same user boundary. It also simulates an incomplete candidate shell and verifies the prior shell, pack and outbox remain present. Tests do not fetch production resources or delete caches.

The tests intentionally use two tiny synthetic packs, **not** the owner's 3 real downloaded packs or their original media volume. They do **not** prove full browser service-worker registration, OAuth return, storage pressure, browser eviction, mixed tabs, successful online synchronization, media correctness, installed Home Screen identity, or physical Android/iPad acceptance.

## Local, isolated rehearsal
1. In a fresh clone, check out the **C3 branch**. Do **not** point the clone's build output to a production hosting service.
2. Run `npm ci` and `npm run check:unified` (existing CI also runs this). The C3 test runs as part of the offline Node suite.
3. Record the test results and SHA in this PR. A failed check is **NO-GO**; investigate without changing production.
4. Review the C1/C2 build-contract checks for matching PWA `id`, relative scope/start URL, `kg-chart-offline-v1` database, `kv`/`outbox` stores, account-scoped media and versioned shell hashes.
5. Do not open a temporary preview as if it were a same-origin migration: `<sha>.kg-chart-offline.pages.dev` is a *different* origin and will not reuse `kg-chart-offline.pages.dev` packs.

## C4 release-preparation checklist (requires *separate explicit* owner authorization)
- Record new Android installation PWA app+worker version, account-scoped pack names, count/bytes, pending changes, active Food and Vegetables state, and private recovery export off-device. Keep personally identifying details out of public PR comments. Export JSON does **not** contain pack-media bytes.
- Obtain read-only Cloudflare preview/production build logs, current branch and output directory, OAuth redirect allowlist **names only** and active deployment SHA. Verify `/offline-build.json` returns the expected JSON in a clean browser and investigate the earlier preview navigation anomaly.
- Rehearse in a disposable **real browser profile on a single test origin**, not the installed Android/iPad origin: install separate edition; download or seed fictional packs/media; create outbox record; switch to unified **on that identical test origin**; cold reopen, verify exact bytes and account boundaries; then deploy a rollback artifact retaining `offline/pictures.js` and version-1 stores. Keep a previous compatible shell accessible. Verify failure and interruption recovery. Never use a real account's recovery export.
- Verify exact immutable unified artifact SHA and signed-off compatible rollback artifact; confirm the prior worker can read content-addressed image references, and the rollback manifest preserves PWA identity and origin. Do **not** use a pre-shared-picture worker.
- Require green CI plus explicit production change authorization **naming target origin, build command, output, SHA, recovery strategy** before C4. Merging documentation/tests is not permission to change Cloudflare settings.
- On release failure, **stop** changes, leave browser storage and packs intact; collect version, screenshot, readiness and outbox reports, and private export. Apply only a reviewed, compatible same-origin rollback with separate approval. Do not uninstall the PWA, clear website data, delete caches or unregister the service worker.

## Acceptance gates
- **C3:** synthetic source-level migration/rollback tests and existing CI pass, review open limitations. Does not itself clear the real-browser dry-run gate.
- **C4:** explicit owner authorization and completed real-browser same-origin rehearsal; no secrets/production Supabase modifications.
- **C5/C6:** physical Android then iPad acceptance after separately approved release, including offline cold start, quiz/audio, safe reconnect sync, auth isolation and pack preservation.
- **NO-GO:** missing or incompatible rollback artifact, ambiguous OAuth return, lost outbox, mismatched app/worker, missing language pack, unexpected edition/redirect or any proposed storage reset.
