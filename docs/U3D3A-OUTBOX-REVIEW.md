# KG Chart U3D3A — Non-destructive permission-aware outbox review

**Base:** main `a0524a872d5b7095915670e4d06b7073be9db581` after merged U3D2B2 #90 and U3D2B2 test follow-up #91.
**Scope:** First independently reviewable U3D3 increment — revision-aware queued-change inventory, read-only policy reconciliation and a fail-closed restricted sync preflight. **Not full restricted synchronization or a usable restricted offline pack.**

**Activation is OFF:** `U3C1_SCOPED_UI_ENABLED=false` in online `index.html`, and `U3D1_OFFLINE_ACCESS_ENABLED=false`, `U3D2_SCOPED_PACK_PREVIEW_ENABLED=false`, `U3D2B1_PRIVATE_MEDIA_STAGE_ENABLED=false`, `U3D2B2_PRIVATE_OFFLINE_PLAYBACK_ENABLED=false`, `U3D3A_OUTBOX_HOLD_ENABLED=false` in the isolated offline runtime. **No production changes, no data clearing, no pack deletion, no new users and no feature activation.**

## Verified baseline and why a staged reconciliation phase is necessary

The current offline runtime commits local study rows and each corresponding outbox record in **one IndexedDB v1 transaction**, then synchronizes them in sequence. Acknowledged changes are deleted individually only after server confirmation; conflicting ratings remain queued, old session/answer inserts use idempotent acknowledgment, and persistent level-check markers recover interrupted RPC attempts. Saved recovery JSON contains the account's queued work and personal local rows. The existing separate/unified PWA has previously passed network-isolated Chromium migration and rollback tests.

**Older outbox records have no permission revision.** If an administrator restricts a language/topic while a learner is offline, replaying such records against *today's* grant without proving their original context would be incorrect. Some rows contain only a vocabulary UUID or a session ID, so their topic authorization cannot be inferred from text, labels, or guessed membership. A changed/signed-out account must never submit someone else's queued events. Backend SQL/RLS/Edge still makes final decisions.

## What is implemented in U3D3A

1. **`offline/access-outbox.js`:** a pure, deterministic, no-network/no-storage-write classifier. It accepts only an owner-bound fresh **server-enforced restricted** U3D1 snapshot, the owner's current queued events and a check time. The results contain only aggregate counts by table and hold reason—**never** private words, learner email, raw quiz answers, source UUIDs, event IDs, bearer tokens or signed-media URLs.
2. The classifier categorizes wrong-account/malformed/duplicate records, legacy events with **no trusted creation revision**, events from a previous revision, languages/topics no longer granted, vocabulary whose actual topic is not verified, answers with no independently verified session mapping, and apparently eligible events still requiring **server authorization and policy-safe reconciliation**. **Every restricted event is held; `publishable:false` is absolute.** This prevents client-only evidence from being mistaken for permission to upload.
3. **`offline/runtime.js`:** when the new flag is eventually approved alongside U3D1, captures an *informational* `permissionRevision` only on newly created locally committed events for the verified current owner. The existing event IDs, exact row contents, sequence, timestamps, idempotency, old queued rows and IndexedDB version remain intact. No historical records are rewritten or backfilled with guessed permissions.
4. A read-only `auditRestrictedQueue()` checks the live owner's outbox; the UI/status can show how many changes require review without exposing their private values. A connected restricted `doSync()` **verifies the current Auth user and policy first**, then audits and returns before `syncEvent`, any outbox delete, level-up RPC or remote-progress pull. The queued records, local learning history, saved packs, old media and recovery export stay untouched; a clear message explains that uploads are held. If the audit is unavailable, sync fails closed without discarding events.
5. An empty/legacy queue keeps its existing sync behavior and does not spuriously show a restricted warning. After a successful local enqueue, an optional audit failure is reported separately so the app does not falsely say the already-committed event failed to save. Sign-out clears only the in-memory audit presentation, **not** the outbox or downloaded files.
6. `tools/build-offline.mjs` packages the same pure classifier ahead of the runtime for the separate-offline and unified candidate shells. The source change leaves the worker, OAuth, SQL, Cloudflare, cache identities, IDB v1 stores, login/pack recovery, public media, old quiz scoring, signed media and installed Android/iPad data unchanged.

## Release and security limits

A local cached policy is not cryptographic authorization. Previously downloaded public images/audio cannot become secret by UI filtering or cache rules. The classifier is not a replacement for SQL RLS and cannot decide whether a historical quiz was allowed at creation time. It deliberately **does not upload any restricted learner work** and does not hide or rewrite old local content.

U3D3A will **not** enable an installed restricted lesson pack or assert offline access is secure. U3D2A text packs are still preview-only; U3D2B2 provides guarded media-only pointers, not completed offline language packs. `kg_chart_u3_my_access_snapshot` still needs the separately reviewed, deployed backend enforcement contract. Do not claim that `server_enforced:true` is active in Technical Supabase simply because a synthetic test passes.

## Remaining independent review increments

- **U3D3B:** audit and implement atomic installation/refresh of *verified, source-scoped text and private media* packs. Bind each offline read to current owner/language/topic/feature/group policy; allow a compatible previous revision only under an explicit current grant; account switch and worker restart must not reveal cached broad legacy data. Never delete prior saved packs/outboxes as a migration shortcut.
- **U3D3C:** permission-revision-aware actual outbox replay with server-verified session→answer and word→topic relationships, allowed quiz mode, conflict/idempotency handling, checkpointed reconciliation and per-event ACK only after the current RLS/RPC confirms the write. Hold denied/legacy/ambiguous records in the account's recovery export until reviewed. Test policy change during upload and multi-tab races; do not silently drop historical work.
- **U4:** installed Android/iPad Airplane-mode cold-start, reconnect, policy revoke/expiry, audio/image, quiz timer, owner switching, lost network, saved packs/outbox and same-origin rollback acceptance. Real hardware tests are required.
- **C4D/C5/C6, backend and media release:** verified Technical Supabase backups, SQL/RLS/RPC/Edge/private bucket deployment, public media classification, release rollback artifacts and security/advisory review; explicit owner approval before production updates or sharing with restricted friends.

## Required evidence

- [ ] U3D3A synthetic classifier and no-upload preflight test **PASS** with fictional accounts and no production/network calls.
- [ ] U3D1/U3D2A/B1/B2 and U3C2 source/media/private lesson tests PASS.
- [ ] All old offline and unified candidate tests PASS; real network-disabled Chromium separate→unified→compatible rollback preserves the three language packs, offline pictures/audio, pending outbox and other-account isolation.
- [ ] All six flags OFF. No Supabase SQL/RLS, Storage, Edge, Cloudflare, OAuth, worker, user account or existing downloaded media change. No PWA data reset.
- [ ] PR draft/unmerged until explicitly approved.

**RELEASE VERDICT: SOURCE-ONLY, restricted friend invitation remains NO-GO.**
