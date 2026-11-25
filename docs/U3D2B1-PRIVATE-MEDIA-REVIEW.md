# KG Chart U3D2B1 — source-authorized private media staging

**Base:** main `0ae5ee8763b051abd95bfc0fc69b7c8c716ccb10` after U3D2A #88 merged.
**Status:** first reviewed increment of U3D2B: byte delivery, integrity verification, private staging contract. **NOT installed restricted offline media**.
**Release verdict:** NO-GO. The U3C1, U3D1, U3D2A and U3D2B1 source flags are all hard-coded `false`. Production Storage, Edge signer, SQL RLS, PWA workers and installed language packs remain untouched.

## Why this increment matters

The current offline downloader packages public `vocabulary-assets` URLs and hash-named `clips.json` audio. Existing downloaded bytes cannot be remotely revoked or made private. A restricted pack must instead use **actual, granted source IDs** and reauthorize every source against live Auth/SQL/Edge before staging audio/pictures. The worker still has legacy public-media routing and network fallback, so enabling restricted packs now would be premature.

## What U3D2B1 adds

1. `js/kg-private-offline-media.mjs` is a pure, testable source-to-bytes staging adapter. It consumes U3D2A's restricted media plan, a fresh owner-bound U3D1 policy record, the verified sentence-group scope and the approved private-media RPC/Edge signer. Each word/topic/sentence/colour source + voice is **independently reauthorized** using U3C2A/U3C2B1 source validation. Missing/private-denied media stops the stage; it NEVER falls back to published text hashes or public object URLs.
2. Short-lived signed private URLs are **used only as transient fetch inputs**. The network request requires `cors`, `no-store`, `redirect:error`, `credentials:omit` and `no-referrer`. Enforce strict project/bucket/signer constraints from the existing U3C2B1 adapter and validate actual response MIME against the signed extension. Audio requires real MP3 headers; pictures require PNG/JPEG/GIF/WebP file signatures **and successful browser decoding**. Stream reads enforce individual size ceilings (image 8 MiB, audio 16 MiB) even without a Content-Length header, plus 256 MiB total and 3,000 assets per candidate. Synthetic tests use fake byte streams and decode stubs; real device decoding is NOT yet accepted.
3. Bytes go only into a newly generated account/language/revision/nonce cache named `kg-private-stage-v1-...`. Each CacheStorage *request key* is a same-origin, SHA-256-hashed **source identity**, never a signed token, external URL, shared public hash, or raw word text. Each cached response is rebuilt with vetted bytes and internal SHA-256/length/MIME metadata; remote response headers are discarded. A manifest records only authorized source references, content hashes and account/revision fields. It is **not** an active pack pointer, and all returned descriptors say `readyToInstall:false`.
4. A separate `inspectPrivateMediaStage` reads the manifest and every file and refuses wrong owner/language/revision, missing or extra keys, incorrect size/hash/URL/MIME, malformed manifests and expired snapshots. `discardPrivateMediaStage` can delete only an exactly scoped staged cache; failure/cancellation deletes only the newly created staging cache. Legacy `kg-offline-pack-` caches, shared image bytes, existing IndexedDB `kv` and `outbox` are **never deleted or overwritten**.
5. In `offline/runtime.js` U3D2A's internal source-scoped query/compile work is reusable by B1 without exposing private rows to the existing public preview API. The new `stageRestrictedPrivateMedia(lang)` can call the stage + inspection **only behind the separately disabled B1 flag** and after identity/policy verification. It rechecks policy after signing/downloading and discards a staged result if authorization changed. No installed pack is promoted or used for playback.
6. `tools/build-offline.mjs` copies the ESM staging module into the separate-offline and unified candidates. It changes no install scope, SW, IndexedDB schema, CacheStorage prefix used by legacy, OAuth callbacks, public manifest, personal progress or outbox. B1 adds source-only CI tests and a reviewed-file allowlist.

## Critical security limits / work intentionally left for U3D2B2

- **Staging is not encryption and is not a cryptographic entitlement.** A device owner can inspect CacheStorage, and previously published media remain publicly available at their existing URL. U3D1 policy TTL (24 hours) is a UX safety cap, not instant remote revocation while a device is offline.
- No new account can use staged bytes offline. The **existing worker has public asset interception and a network fallback**. U3D2B2 must implement a fail-closed account/revision-bound private-media playback path (including audio byte ranges, offline image decode, worker restart/owner recovery), prevent fallback to legacy public media, and implement verified active-pack references. It must preserve old public packs for legacy accounts and never make an unreviewed source-tag change to an installed worker.
- Production SQL/RLS, U3B3B2 registry and private bucket + Edge signer are **source proposals, not deployed**. Do not create or move real media, classify shared audio hashes as private without review, or enable `server_enforced:true` based on fake results.
- All media on a restricted pack candidate are currently mandatory. A missing male/female voice or picture rejects staging; a future explicit optional/required media policy needs documented acceptance before release. Never silently use a public clip to fill a gap.
- U3D3 must handle policy revision changes, account-switch races, revoked or denied queued writes, reliable reconnection, outbox retention and rollback. U4 needs real Android/iPad airplane-mode tests and signed-URL/iOS gesture testing before sharing with a restricted friend.

## Review and acceptance evidence

- [ ] U3D2B1 fake-signer, fake-owner, bounded stream, SHA-256, image decoding, no-public-fallback, asset corruption, abort and cleanup tests PASS at exact head.
- [ ] U3D1, U3D2A, U3C1/U3C2 and U3B privacy/media regressions PASS.
- [ ] 82+ old offline tests, 4+ unified artifact checks, network-isolated real Chromium separate→unified→compatible rollback PASS with saved packs, pictures and pending outbox intact.
- [ ] All four release flags OFF; no SQL, Edge, Storage, OAuth, Cloudflare, service-worker or original PWA data mutation.
- [ ] PR is DRAFT / UNMERGED pending explicit owner approval. U3D2B2, U3D3, U4 and C4D/C5/C6 are independently reviewed and approved before restricted sharing.

**NO-GO** for restricted friends or a production switch based on U3D2B1 alone.
