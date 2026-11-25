# KG Chart — U3D2A restricted offline content and media-source contract

**Baseline:** merged U3D1 PR #87; `main` `deeb962ac2737cf1fca8ef1e22cfb2fd3f647c42`.
**Phase:** First reviewable increment of U3D2, NOT a fully downloadable restricted offline pack.
**Release flags:** `U3C1_SCOPED_UI_ENABLED=false`, `U3D1_OFFLINE_ACCESS_ENABLED=false`, `U3D2_SCOPED_PACK_PREVIEW_ENABLED=false`. **Leave all OFF.**
**Production verdict:** NO-GO. No Supabase/Cloudflare/OAuth/Storage/worker/installed PWA changes are authorized.

## Problem confirmed from source

The existing legacy `fetchContent(lang)` downloads broadly published topics, vocabulary, and word media before relying on UI filtering. It stores whole data snapshots and public text-hash audio catalogs in account-scoped IndexedDB/CacheStorage. The legacy service worker can serve saved public vocabulary assets or fall back to the network. Simply hiding a topic or revoking a grant on reconnection does **not** make earlier cached bytes confidential.

U3D1 adds a validated, owner-bound snapshot but deliberately blocks restricted offline packs. U3D2 must never interpret those older broad packs as newly authorized.

## U3D2A changes

- A pure `offline/scoped-pack.js` compiles a **candidate** restricted text pack only when the enrolled owner's fresh, verified and server-enforced U3D1 snapshot authorizes the requested language. Rejects wrong owner, missing topic grants, stale data, missing/invalid records, and duplicate source IDs.
- It accepts only **translated topics explicitly granted** for that language, excludes private-lesson denied topic IDs, then includes their vocabulary and *only* the requested language's translations. No alternative language translation (e.g. cross-language meaning rows) is copied unless a separately reviewed entitlement model allows it later.
- Sentence content requires the **verified, server-enforced U3C2 sentence-group/topic mapping** and an explicit `quiz.sentences` or `quiz.speak` grant. Unknown, draft, duplicate, stale or unauthorized group mappings stop the preview; excluded private groups never enter it.
- Colour phrase rows require `quiz.colours`, exact language and **both referenced vocabulary IDs** inside the allowed set. Remote CSS/embedded picture URLs are rejected. Untrusted freeform topic/vocabulary/sentence metadata and admin settings are discarded; a small fixed allowlist of content fields is retained. The only saved settings candidate is a sanitized, empty `kg_private_visibility:<language>` descriptor after excluded records are removed. Raw email allowlists and other learners' data are never packaged.
- Public image paths are nulled (locally generated `emoji:` is preserved). The candidate creates a **media intent list of exact word/topic/sentence/colour source IDs and voice**. It does **not** write the old public `clips.json`, hash filenames, public image URLs, signed token URLs or media bytes. Missing/private media remain **unverified**: `manifest.mediaVerified=false`.
- `offline/runtime.js` has a new **default-OFF, read-only** `previewRestrictedPack(lang)` that first re-verifies the actual Supabase Auth user and account policy through U3D1, then pages **only the granted topic IDs, word IDs and verified group names** from current server RLS; checks sanitized private visibility and current U3C2 group RPC; compiles a candidate in memory, re-verifies the policy revision after queries, and returns **only aggregate counts and release blockers**. Never writes or promotes the candidate to IndexedDB/CacheStorage, never signs or fetches private media, never updates an existing pack pointer or queues an edit.
- Even if both U3D1/U3D2A flags were later set ON while U3D2B is not ready, a restricted pack download still terminates **without promoting anything**. Legacy source/packs, service worker, IDB v1 `kv`+`outbox`, recovery JSON, install scope/ID and the three existing downloaded packs remain unchanged by this PR.
- Offline/unified shells bundle the same scoped compiler after the verified policy parser and before the runtime. No additional network call is made while flags are OFF.

## Verification and threat boundaries

The isolated Node suite uses **fictional** owner UUIDs, two languages, allowed/denied/private topics, sentences, mapped groups, word/colour references, old public image paths and private email metadata. It asserts content pruning, grant and revision handling, media intent IDs, no shared public hashes/paths, safe settings, fail-closed malformed data, and no preview writes. Existing U3D1 and older security suites must remain green.

A **client-side filtered bundle is not a server authorization boundary or an encryption layer**. The server must enforce source visibility through RLS, RPC and private Storage/Edge rules, and a device owner can inspect previously cached public content. Arbitrary freeform text in an authorized lesson may still mention ungranted material; editorial/admin review of lesson content remains necessary.

## Remaining U3D2 / U3D3 work (required before restricted friend sharing)

1. **U3D2B — protected media and installed pack pipeline:** review exact source/media classification, verified private bytes (including pictures and m/f audio), format/size/hash/response validation, safe account-scoped storage names with no reusable signed-token URL, anonymous/public-URL and service-worker bypass controls, secure decoded image/byte-range playback, content-addressed new packs and compatible non-destructive rollback. Must test real missing-file, expiry and interrupted-download recovery. No public shared clip may be silently reclassified private.
2. **U3D3 — revocation, offline policy and outbox:** account/policy-revision-aware local reads, pack pointer swaps, reconnect and policy refresh, denied queued writes held for administrator review rather than lost; session retry idempotency, identity switching, multi-tab races and rollback.
3. **U4 — physical Android/iPad acceptance** including airplane-mode cold opens, signed in/out user isolation, permitted/denied topics, audio/images, expired grants, pending outbox, returned Wi-Fi and explicit rollback.
4. **C4D/C5/C6 release gates** and separately approved Technical Supabase migrations, private bucket/signer deployment, backups, real OAuth callback and Cloudflare settings, durable rollback copies and the two previously seen high-severity npm advisories. A green CI never authorizes a production switch.

## Acceptance checklist

- [ ] U3D2A synthetic restricted-content and preflight source suite PASS on exact PR head.
- [ ] U3D1 snapshot, U3C1/U3C2 and media/lesson privacy regression PASS.
- [ ] All offline/unified shell checks and network-isolated real Chromium separate→unified→compatible rollback PASS, preserving prior packs and outbox.
- [ ] No real users/content, unreviewed flags, SQL/Storage/Edge, worker or PWA data changes.
- [ ] PR remains **draft/unmerged** until explicit owner review and approval.

**DO NOT** enable restrictions, invite a friend as a restricted learner, clear website storage, delete previously downloaded language packs, unregister a worker, sign out or deploy on the strength of U3D2A alone.
