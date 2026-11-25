# KG Chart U3D2B2 — Account-bound private offline playback and worker isolation

**Baseline:** `main` `20cb024ce9ee24037cfa6d26b1de6d7286dfa0e9`, after merged U3D2B1 PR #89.

**Scope:** Source-gated private media activation, offline audio/image playback, service-worker public fallback guard, compatible media-pointer rollback and deterministic fake-data tests. **NOT a complete restricted language pack or production release.**

**All four predecessor gates plus `U3D2B2_PRIVATE_OFFLINE_PLAYBACK_ENABLED=false` remain hard OFF.** No deployment, SQL, Storage/Edge, OAuth, Cloudflare, account changes or installed PWA data mutation is authorized.

## Changes
1. `js/kg-private-offline-playback.mjs` verifies a B1 staged private-media manifest and all its bytes *before* preparing an account/language/revision-bound media pointer. The manifest's complete source-key list must exactly match the U3D2A authorized media plan; no extra or missing words, sentences, voices or pictures are permitted. The pointer includes sanitized source identifiers, grant identity and stage descriptor—no signed URLs, public hash catalogs or user email.
2. In future gated mode, the offline runtime stores a media-only pointer in the **existing v1 IndexedDB kv store**, using `active-private-media:<owner>:<language>` and retaining a compatible `previous-private-media` pointer. It checks Auth + server policy again before activation, does not switch a legacy lesson pack, and never deletes an old pack/cache/outbox on error. Rollback accepts only a verified same-owner, same-grant stage; a changed/revoked permission cannot use the previous content.
3. Each offline read rechecks the account, policy revision, language, sentence group mapping, exact source ID + voice, manifest SHA-256 and bytes SHA-256/MIME/magic/header with strict streamed size caps. It never issues a signed request while offline, never requests a public text-derived clip, and returns only an in-memory `blob:` lease with `release()`. A missing/corrupt asset fails closed; no public fallback.
4. `js/kg-audio.js` uses `KGOffline.readPrivateMedia` only when it detects offline mode and a **verified restricted** player state. It prevents public/signer retry for offline failures, refuses a non-`blob:` response, stops older audio on account/policy changes, and revokes the blob on stop/end/error. The original public path remains unchanged with the gates OFF. On iPad, asynchronous URL creation may require a second user tap; U4 must validate actual playback gestures.
5. `js/kg-protected-image.mjs` reads an offline verified word-image blob without network access, and releases it when the existing word-card/quiz component unmounts or an account changes. It cannot silently use a public image URL if private offline media are missing. For restricted picture quizzes, the existing preloader still waits until all required images decode before starting timers.
6. `offline/sw.js` **never serves** `/__kg_private_media_v1__/` over HTTP, the shell cache or a network fallback. The source-gated learner sends `KG_OFFLINE_RESTRICTED_MEDIA`; the worker records that client as restricted and returns 403 for legacy public `vocabulary-assets` URLs rather than consulting prior public caches or the CDN. After a worker restart, the existing owner handshake may respond `{restrictedMedia:true}` and reestablish denial before responding. Verified legacy owner messages continue to use existing public media routing. No permanent cache/IDB identity, install scope or shell update protocol changes.
7. `tools/build-offline.mjs` packages the private playback ESM module into separate-offline/unified candidates; no new dependencies, SDK keys, browser storage versions, install IDs or production runtime endpoints. A new suite exercises owner/revision/voice/source failures, byte tampering, offline-only picture/audio blobs, blob revocation, local 206/416 audio range semantics, worker 403 denial, legacy compatibility and exact activation flag gating.

## Explicit limitations and required next phases

- This remains **client-side cooperation**, not cryptographically protected offline media. Device owners can inspect/manipulate their own CacheStorage and previously published bytes; public Storage URLs cannot be remotely revoked after being distributed. The worker blocks only traffic it controls; a determined user may contact the public CDN directly. Actual confidentiality needs correct backend RLS, private bucket rules, and moving reviewed *private-exclusive* assets only after verified backups.
- **Only the private-media pointer is activated in future staged mode.** U3D2B2 does **not** make the U3D2A restricted text bundle an active/installed pack, does not turn on restricted learner navigation or sync, and does not claim the account can study offline with restrictions now. `readyToInstall:false` remains until U3D3's full entitlement/revocation/queued work reconciliation.
- U3D3 must install revocable source-scoped **text and media** packs atomically after an identity/policy refresh, validate all owner/policy/revision-bound reads, block unauthorized queues, preserve pre-revocation pending work for non-destructive manual reconciliation, cover multi-tab and account-switch races, and prove no old legacy pack is accidentally promoted. Never clear existing data to force migration.
- U4 requires **physical** iPad/Android Airplane-mode cold starts, worker restart, login/Google OAuth, policy expiry/revoke, private picture/audio decoding and blob seeking, iOS user-gesture playback, quiz timer, queued work, restore and compatible rollback. Synthetic Chromium cannot replace hardware acceptance.
- C4D/C5/C6 + backups, source-pinned release/rollback, exact production SQL/RLS/Edge/private media classification, security review and the two known high-severity npm advisories remain independently NO-GO. No production deployment or restricted friend invitation is authorized by merging this PR.

## Review conditions

- [ ] New U3D2B2 synthetic activation/media/worker suite passes on final PR head.
- [ ] U3D2B1 byte staging, U3D2A scoped packs, U3D1 policy, U3C1/U3C2 and U3B privacy tests all pass.
- [ ] Full dual-edition 82+ offline, 4 unified artifacts, network-isolated real Chromium separate→unified→compatible rollback all pass, preserving the already-downloaded packs, shared pictures and pending outbox.
- [ ] No SQL, Supabase/Cloudflare/OAuth, private bucket/Edge, account/user/profile data, uninstall, worker activation or pack deletion. Previous release gates and B2 flag hard OFF.
- [ ] Draft PR reviewed and merged only with explicit owner approval. Production rollout remains separately gated.

**RELEASE VERDICT: NO-GO for sharing restricted offline access with friends.**
