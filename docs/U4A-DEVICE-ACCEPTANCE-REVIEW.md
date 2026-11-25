# KG Chart U4A — Android/iPad physical acceptance and privacy-safe evidence

**Base:** merged U3D3C PR #94, main commit `2dd0af286fe8546e3d0b08e9ac7c3115cb4b0cda`.
**Nature:** first independently reviewable U4 device-acceptance increment. Adds a **manual** device checklist and reusable offline file audit, with a sanitized report export. This is not an actual iPad/Android hardware test performed by GitHub Actions.

## Release status (strict)

**NO-GO** for restricted users, production rollout or declaring Android/iPad U4 acceptance passed based on synthetic tests. The U3C1 learner-scoped UI gate and all U3D1/U3D2A/B1/B2/U3D3A/B/C gates stay hard-coded **OFF**. The production Supabase permission endpoint and sentence-group snapshot SQL in this repo still mark restricted grants `server_enforced:false`; source-only tests do **not** confirm deployed RLS/Edge/private media. Existing public media cannot be remotely revoked while offline.

This PR changes neither Supabase SQL/Edge/Storage, Cloudflare, OAuth, service worker, service worker registration, app installation ID, IndexedDB schema (still `kg-chart-offline-v1` v1), existing pack caches, imported recovery files nor any learner data. It must never clear local caches or force users to sign out.

## Implemented

1. **`offline/device-acceptance.js`**: pure client-side contract for eight explicitly *manually observed* checks. Each starts `not_tested`; automated build or cache verification **cannot** set a human check to PASS. The output marks baseline `incomplete`, `needs_attention`, `user_reported_baseline_pass`, or `user_reported_pass_with_picture_gaps` **only** based on manual results plus an offline file/worker hash audit. The separate `restrictedAccessVerdict` is permanently `not_tested_not_authorized` and `releaseVerdict` permanently `NO_GO` for this phase.
2. **`offline/runtime.js`**: add a collapsed **U4 device acceptance** panel under Settings → Study offline, behind an ordinary user-initiated disclosure. Choose `Android` or `iPad Home Screen app`. The `Verify saved files offline` button calls existing `verifyOffline()` only when `navigator.onLine === false`, reads the same shell hashes and saved media integrity, and refuses to claim an offline check when connected or if the connection changes mid-audit. It does not change the original `Check offline readiness`, download, sync, import/export recovery, sign-in or quiz behavior.
3. Per-step `Not tested / Pass (I checked) / Fail` controls stay **only in page memory**, and can be filled after a cold reopen; they are not persisted to cookies, localStorage, IndexedDB, CacheStorage or the network. Current user switching, explicit sign-out and worker change clear any prior offline-file evidence, preventing accidental reuse for another account or app version.
4. **`Export U4 evidence (counts only)`** creates a local JSON download with checked-at timestamp, Android/iPad selection, edition, summarized app/worker version, verified saved pack and audio counts, count of already published picture placeholders, pending-change count, manual statuses, baseline verdict and constant restricted NO-GO. It strips all account emails/UUIDs, owner and source IDs, filenames, failed asset paths, raw quiz answers, tokens, Storage URLs, origin, device fingerprint and complete recovery backup. **No automatic transmission** to GitHub, ChatGPT, Supabase or any service.
5. Both separate-offline and unified PWA candidates preload this pure module ahead of the runtime; their shell manifest hashes include it. No third-party code or new dependencies. CI tests verify the report cannot promote an untested device, strip secrets from malformed inputs, keep release NO-GO even after a manually marked baseline pass, and preserve Settings/update controls.
6. The full existing separate/unified and network-isolated Chromium migration/rollback workflow must pass in CI at the exact PR SHA; *only the user’s actual device* can supply the physical observations. Do not call these GitHub tests `U4 hardware PASS`.

## Physical acceptance — use AFTER the reviewed version is actually available on your installed device

**Do not uninstall, clear the browser cache/site data, unregister its service worker, or sign out to make the test pass.** Existing three Android packs and queued work are valuable. Export your **private recovery JSON** using Study offline → Export recovery while signed in; keep it privately and do not attach it to this U4 evidence report. The recovery JSON contains personal learning data and IDs.

1. While connected, confirm you are using the **same installed KG Chart edition and origin** as your saved packs. Open **Settings → Study offline**, verify the language pack is saved, and check that the page and worker versions match. On Android, the last accepted baseline had three packs totaling approximately **85.9 MB**, Burmese ready, Food complete and Vegetables unlocked, with 0 pending changes. This is **an earlier baseline**, not evidence that this new release has passed. Existing **85 known published image placeholders** should be recorded as a gap, not erased.
2. Switch **Airplane mode ON** and confirm Wi-Fi and mobile data are really disconnected. Close the installed Home Screen app completely, then reopen from its Home Screen icon—not a freshly opened online browser tab. Mark **Airplane-mode cold reopen** only if the screen actually loads without signing in again.
3. Still offline, open a downloaded language, confirm Food/Vegetables progress and individual saved vocabulary pictures. Tap several genuine pronunciation clips and hear audio. Mark those three observations **only after testing them on that device**; placeholders or silent clips should be recorded as FAIL or noted separately.
4. Finish a **small offline quiz**. Note that its unsent changes appear in Study offline. Fully close/reopen while still disconnected, confirm quiz progress and pending count survived, then open U4 device acceptance. Choose Android or iPad, tap **Verify saved files offline**, and confirm the result. Mark the first six manual checks only once genuinely performed. A successful audit verifies bytes, not that you heard sound or saw real images.
5. Reconnect. Tap **Sync now**, verify the pending count is acknowledged and the corresponding result appears in the online account. An unresolved rating or permission conflict must **stay queued**. Verify your original private recovery export remains accessible. Mark the final two checks, then tap **Export U4 evidence (counts only)**. This report is suitable to share for acceptance review; the recovery JSON **is not**.
6. Repeat on the other physical platform and keep **two separate reports**, one for Android and one for iPad. If a test is blocked or you didn't run it, leave it **Not tested**. The panel's manual statuses are not saved across app restarts; fill them after reopening and export before closing the session.

**Safety notes:** Never create a restricted friend account, perform an account-switch test with a live user, clear a downloaded pack, force an old-worker rollback or enable protected media/restricted sync flags as part of U4A. Those actions need explicit owner consent, backup and test-account fixtures; they belong to U4B/U4C and the secure backend release.

## Acceptance checkpoints

| Checkpoint | Android | iPad |
| --- | --- | --- |
| Pre-existing downloaded packs and current worker version | Not tested in U4A | Not tested |
| Airplane cold reopen from installed Home Screen app | Not tested in U4A | Not tested |
| Lessons, progress and images | Not tested in U4A | Not tested |
| Pronunciation heard through real device speaker | Not tested in U4A | Not tested |
| Offline quiz and pending outbox after cold reopen | Not tested in U4A | Not tested |
| Reconnect, server acknowledgment and recovery export | Not tested in U4A | Not tested |
| Restricted learner and permission revoke/refresh | **BLOCKED** | **BLOCKED** |
| Same-origin update/rollback, account-switch without data loss | Not run on real hardware | Not run on real hardware |

**U4A source-only verdict: PREPARED, PENDING PHYSICAL ACCEPTANCE.**

## Following independently reviewable phases

- **U4B:** after a verified isolated backend rollout, use a dedicated **test** account to accept restricted-language/topic/quiz/feature visibility, source-bound offline pictures/audio, policy expiration, permission revocation and reauthorization on each physical OS; keep the broad legacy packs and primary owner account untouched.
- **U4C:** reviewed same-origin migration, previous-worker rollback, shared image/audio and outbox integrity on physical devices, multi-tab/auth session race and recovery/export reliability with explicit stop criteria.
- **Production security/release:** Technical Supabase backup and real U1–U3C2 SQL/RLS/private media deployment with `server_enforced:true` only after proven enforcement, transactional revision-race mitigation, Cloudflare staged rollout C4D/C5/C6, dependency advisories, owner approval, final go/no-go.

**Never use a synthetic passing test or a user-reported baseline PASS alone as approval to invite a restricted friend.**
