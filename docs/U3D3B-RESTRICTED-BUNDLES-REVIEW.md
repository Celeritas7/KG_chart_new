# KG Chart U3D3B — Revision-bound restricted lesson + private-media bundles

**Baseline:** merged U3D3A PR #92, `main` `7fa2f238542f6863877bee3d3a3e3ca893e1bfbb`.
**Status:** Independent review-only implementation. **Production NO-GO.** The U3C1, U3D1, U3D2A, U3D2B1, U3D2B2, U3D3A, and new **`U3D3B_RESTRICTED_PACKS_ENABLED=false`** gates remain OFF.

## Motivation

Legacy packs contain broad published topics/vocabulary and publicly accessible media. A restricted learner must NEVER read old `packs`, old `active:<owner>:<language>` entries, `kg-offline-pack-...` media caches or another account's rows by relabeling them as restricted. U3D2A filtered lesson text; U3D2B1 staged signed protected bytes; U3D2B2 verified exact media source IDs and private `blob:` playback; U3D3A preserved queued progress under permission changes.

U3D3B creates a distinct **atomic text + private-media bundle pointer**, with a read-side contract, while the actual restricted learner and sync release remain disabled until U3D3C/U4.

## Architecture

1. **`offline/restricted-packs.js`** validates fresh U3D1 owner-bound server-enforced restricted policy; exact active language; allowlisted topics; matching topic and word translations for **one selected language**; vocabulary assigned to those topics; reviewed U3C2A sentence group↔topic assignments; feature-gated colour phrases with both word references; and sanitized private visibility metadata. Unknown tables, duplicate/foreign references, remote image URLs, unsafe freeform metadata and wrong-owner or stale policy all fail closed.
2. All media source requests are required to be **exactly the authorized B2 protected source-key list**. Word media must refer to an included word with its actual included topic; sentence audio must refer to an included sentence and verified group/topic; colour media to an included colour phrase; topic audio to an included topic. No old public hash/audio catalog, signed link, token or bucket URL is embedded in the new content or bundle pointer. Content is stored with a SHA-256 digest. On reads, hash, permissions, table/foreign-key and source-key relationships are revalidated.
3. `offline/runtime.js` adds a separately hard-OFF `installRestrictedBundle(language)` entrypoint. It fetches only server-scoped candidate rows, stages every required private media source using existing per-source live signer checks, validates the B2 media pointer and full restricted content, then **rechecks actual Supabase Auth and policy immediately before commit**. Inside one IndexedDB v1 **`kv` transaction**, it checks the shared persisted policy snapshot to detect a same-account grant update from another tab, writes the new text payload, retains the previous restricted pointer, and switches the `restricted-active:<owner>:<language>` pointer. A failed, revoked or interrupted attempt never switches a pointer or deletes a previous bundle, legacy pack or outbox. The private staging cache is discarded only when a new attempt failed before commit.
4. On **restricted, offline, read-only lesson queries**, `Query.execute` accepts **only** a current verified restricted bundle for that language: it will not call `selectRows` over broad legacy packs or fall back to a remote unscoped query. Returned topic/vocabulary nested translations and colour relations are joined only from validated restricted rows. Unauthorized languages, missing payloads, stale/changed snapshots, personal records, writes, or an online restricted query without U3C/U3D3C activation fail closed.
5. `readPrivateMedia(resource)` uses the **media pointer paired with the verified restricted text bundle** when the B gate is enabled, rather than a separately staged/media-only pointer. B2 again verifies signed-source identity, manifest, SHA-256 bytes, MIME, account and policy before returning a revocable in-memory blob lease. No HTTP route to the private cache is exposed; the gated worker continues to deny public fallback for restricted sessions.
6. **`restorePreviousRestrictedBundle(language)`** checks account/permission revision and exact sanitized grant snapshot, stored content SHA-256 and all source links, then B1 staging manifest bytes before atomically switching back the pointer. Old data are retained for forensic recovery. A previously revoked topic cannot be revived by rollback. This is a local staged contract, not proof that a previous server policy is still approved.
7. Both separate-offline and unified candidates bundle the pure policy module **before** the runtime. No changes to PWA worker, public media, SQL, Edge, Storage, Cloudflare, OAuth, install identity, IndexedDB version (`kg-chart-offline-v1`, v1 `kv` + `outbox`) or existing Android/iPad data. U3D3B's new keys are additive and distinct from legacy account downloads and previous B2 media-only pointers.

## Security and release limitations

This is a **browser-local defensive boundary**, not cryptographic DRM, authorization from independently inspected local data, or instant offline revocation. The device owner can copy downloaded bytes; previously published assets remain publicly accessible at old URLs. Offline policy is subject to the U3D1 bounded lifetime, and server grant/private-lesson changes are only fully enforced when the device reconnects and verifies current RLS/RPC. The private-media signer and U3A–U3C2 SQL are staged source code and **not confirmed installed in production**.

**Restricted learning is deliberately NOT released:** U3D3B only enables read-only restricted content when its flag and earlier gates are explicitly turned on *after release review*. It still blocks restricted quiz/session/answer/rating mutations and has no permission-aware upload. The UI, main access system and signed media installation are OFF, and no user should be invited under claimed restrictions based on this PR.

## Next steps

- **U3D3C:** verified server-backed permission-aware outbox replay. Resolve each word source to its currently allowed topic, every answer to its saved/verified session and mode, held legacy events, conflicts, account/session change and multi-tab races. ACK only after server confirmation; preserve denied/ambiguous records, historical ratings/quiz answers and recovery exports. Refuse stale revision updates and preserve release rollback.
- **U4:** real iPad/Android airplane-mode cold opens, restored OAuth login, revoked topic/feature, expired snapshot, private audio playback and picture decode, old worker rollback, wrong-account isolation, unsent progress after reconnect.
- **C4D/C5/C6:** separately approved Technical Supabase RLS/RPC, private media classification and bucket/Edge deployment, Cloudflare staged switch, rollback/backup and two previously noted high-severity npm advisories.

## Acceptance criteria

- [ ] Synthetic U3D3B owner/lang/topic/word/sentence/colour/media-source pairing and corruption/revocation tests PASS.
- [ ] Actual `Query.execute` offline restricted lookup is verified to NEVER use broad `packs` or remote source fallback.
- [ ] Previous U3D1, U3D2A/B1/B2, U3D3A, U3C and private lesson regressions PASS.
- [ ] Dual-build 82+ offline, 4 unified, real network-isolated Chromium separate→unified→compatible rollback PASS with old packs/outbox intact.
- [ ] All seven gates OFF. No PWA storage deletion, SQL/RLS/Edge/Storage, worker, login, or production release edits.
- [ ] PR stays DRAFT/UNMERGED until explicit user review.

**RELEASE VERDICT: NO-GO for restricted friend sharing.**
