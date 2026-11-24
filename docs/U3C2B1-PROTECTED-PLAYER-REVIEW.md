# KG Chart U3C2B1 — Protected playback and chart-picture adapter

**Starting point:** `main` at `8e9028fd5286d2d1fa365af11407ad124cb4913b` (U3C2A merged).
**Status:** first, independently reviewable part of U3C2B. This is **not** U3C2B completion or production authorization.
**Release flag:** `U3C1_SCOPED_UI_ENABLED = false`. Leave it OFF.
**Preservation:** No production SQL, Storage copy/delete, Edge deployment, Cloudflare configuration, OAuth change, online/offline PWA migration or device cache deletion. C4C PR #74 remains untouched.

## Why this increment exists

U3C2A added resource-ID-aware media authorization but explicitly did not connect it to the learning UI. The legacy player still resolves a text-hash into a PUBLIC `vocabulary-assets/audio` URL. Hiding a restricted word in the browser is not a security boundary. For protected content, the audio player and pictures must use independently verified word/topic/sentence/colour source IDs and a short-lived, source-bound private signed URL; denial cannot trigger a public hash fallback.

The proposed U3B3B2 signer, media registry and U3C2A sentence mapping are staged **source files only**. They are not installed in production; no real private asset mapping exists. A successful synthetic test is not evidence that existing public media are confidential.

## Changes in U3C2B1

1. `js/kg-protected-player.mjs` is a pure, opt-in acquisition layer. It checks source request validity before calling U3C2A's source-aware resolver; only audio/MPEG for audio and recognized image types for word pictures pass. It independently checks exact project origin, private bucket, UUID asset path, file extension, token and expiry 1–30 s. It returns a URL or null, **never a public URL or cached alternate**.
2. `js/kg-audio.js` has a source-controlled media gate. Default-OFF preserves the existing public audio player. When a future *separately approved* release enables U3C1, an unknown/unverified policy blocks public media; verified restricted mode requires `opts.resource` and signs the real source on every playback, whereas verified legacy mode retains its previous public behavior. A source-free call cannot load or reuse a public clip for a restricted user. The playback request generation is invalidated on `stop`, policy/account replacement and a new tap; old signer responses cannot resume stale sound. Signed audio src is cleared on stop. Public audio manifests are not fetched under the restricted/unknown gate in either online or offline audio-catalog adapters.
3. `index.html` routes the main chart's vocabulary-card and word-detail sound buttons through `{type:'word_audio', id:item.id, topicId, language}`, and the topic question prompt through its topic ID. A `ProtectedWordImage` component signs `{type:'word_image', id:item.id, topicId, language}` for the chart card/detail and discards stale responses on identity/revision/source changes. Generated emoji images remain local. The generic `getImageUrl` becomes **fail-closed** whenever public media is forbidden, so unconverted views may show a placeholder instead of leaking a public URL.
4. `tools/build-offline.mjs` copies the three existing/new ESM media modules into both offline and unified shells, without changing the PWA installation ID, offline runtime, worker, database schema, Auth storage key, cached packs or outbox. Dynamic imports run **only** if the future gated restricted path is entered.
5. Isolated Node tests use fictional UUIDs, words, policies, fake signed URLs and a fake HTML audio object. The dedicated non-deploying workflow checks that the activation flag remains OFF and no SQL/Edge/Storage/offline-runtime paths have changed. Standard dual-edition/Chromium CI must also pass.

## Deliberate limitations: U3C2B2 remains necessary

- **Other sound call sites are not yet source-bound.** Some quiz autoplays, direct `KGAudio.play` calls, sentence/speak loops, colour phrases, flashcards and additional `SpeakButton` instances still supply text only. Under a future restricted policy these fail closed instead of falling back to public hashes. U3C2B2 must inventory and convert **every** call site, including speaker voice, autoplay, text-hash collisions, and sentence-to-topic mappings.
- **Most non-chart images are not yet integrated.** Quiz answers/options/preloads, flashcards, typing and colour images use the generic URL function and will be unavailable in restricted mode until source-bound image components/prefetch are implemented. Build image byte-range/playback, 30-second expiry-refresh and missing-file handling into follow-up tests.
- **No real private media exist at approved paths yet.** Production still has a public bucket and shared text-derived audio hashes. A later administrator must review the classification, create/copy/verify private-exclusive assets, protect any public URL leak, stage the signed-media Edge function and migrate with documented rollback. Do not blindly move shared clips or break ordinary pronunciation.
- **Previously public/cached bytes cannot be remotely made secret.** Existing Android/iPad packs must be preserved. U3D must design per-account offline entitlements and revocation/refresh semantics before activating restrictions.
- U3A/U3C2 presently declare `server_enforced:false`; `U3C1_SCOPED_UI_ENABLED` remains OFF. Real restricted friend accounts are **not ready for sharing**.
- C4C source-pinned release PR #74, C4D backups/rollback, two unresolved high-severity npm advisories, and U4/C5/C6 physical iPad/Android tests remain separate release gates.

## Review and acceptance checklist

- [ ] Dedicated Node contract tests pass: no denied/missing-source signing, correct MIME/expiry/same-project URL, no public fallback, no signed-link caching, no public manifest for restricted/unknown policy.
- [ ] U3C1/U3C2A policy/source-authorization regression passes.
- [ ] Existing offline tests, unified artifact contract and network-isolated Chromium migration/rollback pass at the exact PR head.
- [ ] Gated source flag stays OFF; no changes to production SQL, Cloudflare, Storage, Edge or browser/offline data.
- [ ] U3C2B2 finishes remaining source-bound quiz/sentence/colour/image/media coverage and refresh/range tests before any activation.
- [ ] U3D/U4 device, Auth, offline and rollback acceptance plus explicit user deployment approval are separately obtained.

**Release verdict: NO-GO for real user restrictions and protected media delivery.** This PR is intended for code review only, not deployment or merging without the owner's approval.
