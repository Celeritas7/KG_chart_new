# Stage C1 — Unified KG Chart migration readiness audit

**Date:** 2026-11-22 (JST)  
**Repository:** Celeritas7/KG_chart_new  
**Audited \`main\`:** \`fb4907190a527b03f086d9ca6f52a00f99fc8231\` (PR #67 merged)  
**Status:** **READ-ONLY AUDIT / NO-GO for production migration today.** This document is a review artifact; it does not authorize a Cloudflare configuration change, merge, deploy, Supabase modification, app uninstall, storage deletion or service-worker unregistration.

## 1. Goal and currently observed baseline

Goal: one KG Chart learner experience which operates both online and offline, keeps the familiar interface and study rules, and preserves the current installed app's language packs, authentication boundaries, saved progress and outbox. "One app" does **not** require moving to the original GitHub Pages origin immediately.

User-reported physical Android baseline (2026-11-22, before Stage C):
- Installed **KG Chart Offline** on \`https://kg-chart-offline.pages.dev/\`.
- Page and active service worker both showed \`fb4907190a52\`; the separate build uses a plain 12-character revision. A unified build generated at the same commit has a \`-unified\` suffix. This is a device observation, not an independent Cloudflare dashboard configuration read.
- **Three saved language packs**, approximately **85.9 MB**, with **zero unsent changes**. Burmese was marked **Ready offline**.
- Food quiz history and completion successfully synchronized; Vegetables unlocked through normal learning-path logic, and persisted across an Android Airplane-mode close/reopen.
- Stage B1 auth fix passed three offline cold openings; Stage B2 (duplicate quiz retry protection, PR #67) was merged and its resulting app/worker revisions matched.
- **85 missing published pictures** are represented as placeholders in the checked Burmese pack. Zero reported pack failures does not mean those real pictures exist.
- The other two language packs' identities, sizes, completeness, and Android/iPad acceptance have not been reverified in this Stage C audit.

No account email, ID, tokens, quiz records, downloaded backup or device-private data belong in this public report.

## 2. Source-backed build and deployment inventory

| Edition | Source/build | Output | Intended/known hosting | Migration implication |
| --- | --- | --- | --- | --- |
| Original online | \`tools/build-online.mjs\` snapshots canonical \`index.html\`, existing \`sw.js\`, root manifest and JS | \`dist-online/\` | Current GitHub Pages online app; README also identifies original root files as its live source | Different origin and existing service-worker/browser storage. Cannot directly read Cloudflare-installed offline packs |
| Separate offline | \`tools/build-offline.mjs\`, same canonical learner JSX, localized dependencies | \`dist-offline/\` | Reported live at \`https://kg-chart-offline.pages.dev/\` | Existing origin and storage format; user has tested offline study |
| Unified candidate | \`npm run build:unified\` invokes \`tools/build-offline.mjs --unified\` | \`dist-unified/\` | **Not verified deployed**. Candidate for same-origin replacement of separate offline build | Must be installed under the **same HTTPS origin and scope** before claiming it preserves existing packs |

The build transforms one canonical UI rather than maintaining a second manually edited learner page. The unified build sets \`window.KG_UNIFIED=true\`, changes the display name to KG Chart, and produces both \`offline-build.json\` with \`edition:"unified"\` and an app revision suffixed \`-unified\`.

The GitHub workflow \`.github/workflows/kg-dual-edition.yml\` runs \`npm ci\`, \`npm run check:unified\`, checks that source online files remain unchanged, and uploads online/offline/unified artifacts. **This workflow does not deploy to Cloudflare** and does not prove Cloudflare's actual build command/output directory. A passing GitHub Pages deployment is also not confirmation of a Cloudflare Pages release.

**Cloudflare dashboard status: UNVERIFIED.** This repository contains no \`wrangler.toml\` or checked-in Cloudflare Pages production settings. The user or a separately authorized Cloudflare administrator must confirm current values read-only before planning any switch:
1. Exact Pages project and bound production hostname; Git repository, account, and production branch.
2. Current **production** build command, root directory and build output directory (not merely what the repository recommends).
3. Preview-build behavior, commit SHA for the active deployment, and whether new PRs automatically publish previews. Preview must never be mistaken for production.
4. Redirects/headers/cache behavior for \`/\`, \`/index.html\`, \`sw.js\`, and \`offline-build.json\`, including historical redirect issues.
5. Runtime/build environment requirements (Node version) and required configuration **names only**, never secrets or secret values.
6. Exact OAuth redirect allowlist and Google sign-in return origin in the existing Technical Supabase project. Do not change Auth configuration without separate approval.

## 3. Storage, origin, and PWA identity compatibility

Source evidence:
- \`offline/manifest.webmanifest\` has PWA \`id: "/kg-chart-offline"\`, relative \`start_url: "./"\` and \`scope: "./"\`. The unified build reads this manifest and changes only its display name, short name and version; it **does not switch the PWA id/scope**.
- \`offline/runtime.js\` uses \`indexedDB.open("kg-chart-offline-v1", 1)\` and stores \`kv\` plus a durable \`outbox\`. Saved enrollment, active-owner, active pack pointers, cached pack metadata, local personal rows and unsent changes are owner-scoped.
- \`offline/sw.js\` opens the same IndexedDB database and looks up account-scoped media cache names under \`active-caches:<owner>\`.
- The offline and unified builds share the \`offline/runtime.js\`, \`offline/sw.js\`, picture adapter and auth storage key \`kg-chart-offline-auth\`.
- New picture byte storage uses \`kg-offline-pictures-v1-<owner>\` with content hashes; older pack entries are still supported. The account-specific cache names and hashes must remain compatible.

**Inferred safe candidate:** keep the existing Android Home Screen installation and deploy the unified \`dist-unified/\` contents at \`https://kg-chart-offline.pages.dev/\` **only after approvals and compatibility testing**. A same-origin, same-scope update should reuse the saved app identity and origin-bound IndexedDB/CacheStorage, but this has **not yet been proven by an actual migration test**.

**Unsafe assumption:** deploying \`dist-unified/\` to the original GitHub Pages site, or a new Pages/custom domain, will automatically bring over the Android offline content. Browsers isolate IndexedDB, CacheStorage, auth keys, and service workers by origin. A different origin needs an explicit, separately reviewed media-and-progress migration plan that has **not** been implemented.

The existing online site must stay available until acceptance succeeds. Any eventual redirect/retirement is **a separate future decision**; it must not silently replace the working installed app.

## 4. Data preservation, synchronization, and authentication

**Already implemented, not a replacement for device acceptance:**
- \`queueMutation()\` atomically writes local view and outbox event in one IndexedDB transaction, with owner checks; the sync code retains failures instead of dropping events.
- Quiz session/answer IDs are stable; PR #67 added timestamp-equivalence acknowledgment for valid duplicate retries while rejecting genuinely different data.
- \`loadPacks()\` resolves the active language pack pointers for the current verified offline owner. Updated packs use staged media, verified hashes, active-pointers and previous-pack metadata; a failed refresh should not replace the active pack.
- \`offline/runtime.js\` restores an existing approved offline enrollment and remains account-scoped. PR #66 guards transient null-session events while offline; explicit sign-out and mismatched owners still lock the former learner. Online synchronization verifies the real user and allowance via the server before committing.
- Download readiness can audit saved shell/pack hashes. File audit is **read-only**; it does not demonstrate offline cold launch, absence of placeholders, or server content correctness.
- \`Export recovery\` saves personal table rows and pending outbox to a **private account-bound JSON**. It does **not** include downloaded image/audio bytes, pack caches or the entire service-worker shell. Do not put a personal recovery export in a public GitHub issue/PR.
- Reconnect sync and background pack refresh are separate from app-shell updates; a zero-pending counter verifies the device queue at one point in time only.

**Remaining risks:**
1. Existing published picture gaps: 85 placeholders in Burmese; track a separate media-quality fix, do not confuse placeholders with download failures.
2. New unified code may change behavior for an undownloaded language while online; prove the existing UI/quiz path and local/remote switching with synthetic data before release.
3. Auth redirects, expired sessions, account switches, and offline cold starts still need physical installed-PWA acceptance (especially iPad).
4. Browser storage eviction, low-space failures, interrupted updates and concurrent tabs cannot be disproved by a successful one-time check.
5. Production release must preserve the protected account's exact pack/outbox state; never automatically wipe, unlink or re-enroll merely because the build edition changes.

## 5. Shell update and compatible rollback

\`offline/sw.js\` uses versioned \`kg-offline-shell-<revision>\` caches. During install it validates shell files against their hashes, and deletes **only an incomplete new candidate shell** on installation failure. On activation it intentionally retains older shells until a version-aware cleanup exists. App activation/reload is mediated by \`offline/install.js\`, blocked during an active quiz/download/sync.

**Critical rollback constraint:** pack records may contain shared-picture references that a pre-Phase-2 service worker cannot resolve. Never roll back to an older worker/build which lacks the shared-picture resolver. Do not assume a semantically older commit is safe just because its shell cache is present.

A **compatible rollback** must be rehearsed on a disposable same-origin profile using saved shared picture references and queued changes. Candidate rollback build should retain \`offline/pictures.js\`, owner handshake, compatible \`kg-chart-offline-v1\` stores and media cache resolution. Any data-layout changes introduced in C2–C4 require a fresh compatibility review.

**Recovery order after a migration failure:** freeze additional changes; preserve current installed app and website data; collect screenshot, version, readiness report, private recovery export (stored off-device), and pack/outbox counts; only then consider a reviewed, approved same-origin rollback. Do not clear storage, uninstall, manually unregister the worker, or delete old packs.

## 6. Physical acceptance and evidence matrix

| Test (actual installed PWA) | Android | iPad |
| --- | --- | --- |
| Baseline app/worker same revision; 3 packs and zero outbox | User-reported pass, separate edition | Unknown |
| Food complete / Vegetables unlocked, Airplane-mode cold reopen | User-reported pass, separate edition | Unknown |
| PR #66 three offline cold reopens without Welcome Back | User-reported pass, separate edition | Unknown |
| Updated Burmese pack checked, 743/743 files and 85 placeholders | User-reported pass, separate edition | Unknown |
| **Unified** edition, app+worker \`-unified\` both shown, installation preserved | **Not performed** | **Not performed** |
| Same-origin upgrade retains installed pack list, bytes, active content and 0 pending | Not performed | Not performed |
| Offline refresh, force close/reopen, pictures, recorded audio and quiz | Unified: not performed | Unified: not performed |
| Saved local quiz/rating survive cold close and acknowledged reconnect sync | Unified: not performed | Unified: not performed |
| Interrupt and resume a pack refresh without losing active pack | Unified: not performed | Unified: not performed |
| Update while quiz active does not reload or discard progress | Unified: not performed | Unified: not performed |
| Google OAuth redirect, existing email login, logout and different-account isolation | Unified: not performed | Unified: not performed |
| Restore a compatible previous release with preserved picture references and outbox | Disposable profile only; not performed | Disposable profile only; not performed |

Do not make destructive simulations (delete caches, force-reset, storage clear) on the user's existing Android or iPad installation. Capture device OS/browser version, edition/revision, pack names/counts, outbox count, sync errors, and private export location. Keep private exports off public PRs.

## 7. Stage C implementation plan and approval gates

### C1 — Audit / review (this PR)
**Deliverable:** source-backed inventory, unknown Cloudflare settings, risks, target origin, rollback boundaries, acceptance matrix and ordered gates. No code, hosting, database or device mutation. **Gate:** review these findings; confirm Cloudflare dashboard values read-only; do not treat this PR as deployment approval.

### C2 — Isolated unified compatibility verification
**Deliverable:** dedicated branch/PR with non-production checks and regression tests for manifest id/scope, identical account keys/IndexedDB format, picture reference/legacy cache readability, pending outbox, online fallback for undownloaded languages, auth, shell update and failed-upgrade recovery. Produce reproducible \`dist-unified/\` artifact at an isolated preview or test harness. **Gate:** all CI checks plus real browser tests on disposable storage and test data. No real-device storage changes or production writes.

### C3 — Migration/rollback runbook and dry run
**Deliverable:** baseline capture steps, private recovery-export handling, staging rollout decision tree, test account/preview constraints, artifact integrity and compatible rollback procedure. Obtain read-only Cloudflare configuration proof. **Gate:** rehearsal passes with simulated old packs/shared pictures/queued records; explicit, versioned rollback candidate exists. Still no production switch.

### C4 — Production approval and controlled switch
**Deliverable:** narrowly scoped, reviewed change to the **existing offline origin** to serve \`dist-unified/\` (proposed build command \`npm run build:unified\`, output directory \`dist-unified\`) if C2/C3 pass. Keep the original online GitHub Pages site running. **Gate:** explicit user approval of the precise Cloudflare action, SHA, origin and rollback, separately from PR merge. Verify live \`offline-build.json\` edition is \`unified\`, service worker and page revisions match, and no forced data reset occurred.

### C5 — Android installed-app acceptance
**Deliverable:** compare pre/post 3-pack baseline, storage and outbox, normal online workflow, Wi-Fi/mobile sync, Airplane-mode cold open, quiz and audio, update safety. Check previously missing images have not regressed. **Gate:** full user-provided device PASS, saved recovery retained; abort and preserve state on regression.

### C6 — iPad acceptance and final consolidation
**Deliverable:** iPad Safari/Home Screen login, offline data download/reopen, keyboard/audio/quiz, reconnect and update acceptance; reconcile any platform differences. Decide only after acceptance whether to present the Cloudflare origin as canonical, preserve the old online URL, or propose a *separate approved* migration/redirect. **Gate:** both devices pass, no unexplained outbox or account-isolation issues; deprecating any old origin requires its own approval.

## 8. Explicit NO-GO conditions

Do not begin C4 if **any** of these remain true:
- Cloudflare production project, branch, build command/output and active deployment edition are not independently confirmed.
- Origin or PWA installation identity would change without an approved, full media transfer plan.
- Baseline pack count/size, owner, queue and ability to export recovery are not recorded.
- Current worker/rollback candidate cannot read already saved shared-picture references.
- A broken shell could strand the installed app without a protected same-origin fallback.
- Online and offline app authentication behavior or test-account boundaries are unverified.
- Android/iPad acceptance is being inferred from CI or desktop simulation.
- The proposed change would reset IndexedDB/CacheStorage or alter production Supabase, OAuth settings or RLS without separate explicit authorization.

## 9. Source map (audited on \`main\`)

- \`tools/build-online.mjs\` — original online artifact.
- \`tools/build-offline.mjs\` — offline and unified generator, shared canonical learner JSX, release metadata/manifest.
- \`offline/manifest.webmanifest\` — installed PWA identity/scope.
- \`offline/runtime.js\` — account enrollment, IndexedDB, outbox, pack pointers, recovery, readiness and sync.
- \`offline/sw.js\` / \`offline/install.js\` — hashed shell, worker activation, updates and origin/media scope.
- \`offline/pictures.js\` — shared content-addressed pictures and backward-compatible legacy entries.
- \`offline/PHASE1.md\`, \`offline/PHASE2.md\`, \`offline/PHASE3.md\` — earlier candidate and migration rationale.
- \`offline/tests/unified.test.mjs\`, \`offline/tests/shared-pictures.test.mjs\`, \`offline/tests/auth-startup.test.mjs\`, \`offline/tests/sync-ack-timestamps.test.mjs\` — existing automated evidence.
- \`.github/workflows/kg-dual-edition.yml\` — CI artifacts; not a Cloudflare deployment workflow.

**C1 conclusion:** There is a credible additive, same-origin upgrade path, but production migration is **NO-GO** until Cloudflare settings, preview compatibility, rollback rehearsal, and live-device acceptance gates are addressed. A successful PR merge of documentation alone is not release approval.
