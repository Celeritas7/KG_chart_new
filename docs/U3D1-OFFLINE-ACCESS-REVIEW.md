# KG Chart U3D1 — verified offline permission snapshot bridge

**Baseline:** `main` `7ed8bd1262e8229e59f8091a3bc23a8a273e0302` after merged U3C2B2 PR #86.
**Scope:** first independently reviewable portion of U3D. This is code/test staging only, not authorized production restriction or a usable restricted offline language pack.
**Hard OFF gates:** `U3C1_SCOPED_UI_ENABLED=false` and `U3D1_OFFLINE_ACCESS_ENABLED=false`. No real restricted learner can be activated by merging U3D1.

## Verified starting risks

- The current enrolled offline PWA keeps account-scoped packs under IndexedDB v1 `kv` and `outbox` plus revisioned CacheStorage. **Older packs may contain broader lessons/media than a newly restricted learner is permitted to see.** A UI topic filter alone cannot redact saved bytes or remotely revoke them while the device has no connection.
- Legacy offline startup and sync have been user-accepted on Android (three packs, approximately 85.9 MB, zero unsent changes, Burmese pronunciation/pictures, Food complete and Vegetables unlocked). None of that data should be cleared, migrated or overwritten just to add new access rules.
- U3A access snapshots remain source-staged SQL in the Technical project; the actual production RLS/Edge/protected-asset rollout has not been approved. Existing public Storage URLs and downloaded objects remain accessible to devices that already received them. **Device IndexedDB cannot be trusted as a server authorization or cryptographic proof.**
- U3C2B2 completes source-bound client audio/image paths but does not make the private media registry/bucket/Edge signer active or private media usable offline. U3D1 does not authorize those changes.

## U3D1 deliverables

1. **Pure, testable** `offline/access-policy.js` checks server-derived snapshot contract, identity binding, monotonic revisions and canonicalized grant sets. Only `live.auth.getUser()` + existing `kg_chart_is_allowed` followed by no-argument `kg_chart_u3_my_access_snapshot` qualify as remote verification; caller email or web metadata is never accepted as authorization.
2. An owner-keyed policy snapshot is *prepared* under `offline-access-policy:<auth user UUID>` in the existing IndexedDB v1 `kv` store; nothing is added to or deleted from existing packs, caches or personal progress. Saved snapshots contain only normalized language/topic/feature IDs, mode, revision and a verification timestamp. No auth tokens, private lesson email lists, signed media URLs or service credentials are saved.
3. A cached policy has a **24-hour freshness ceiling** and rejects wrong-owner reuse, future clock jumps, malformed snapshots, revision rollback and same-revision changes. The client re-checks the live identity and policy on reconnect, before any new pack download, before promoting its active pointer, and **before** attempting queued writes. Server error fails closed and leaves the old pack/outbox intact.
4. **Restricted offline behavior remains deliberately blocked** even if the server snapshot grants `offline.pack`. Existing legacy packs cannot be treated as scoped restricted packs without U3D2 filtered data/media and U3D3 safe reconciliation. When the separate future gate is enabled, unknown/restricted mode blocks old local content/personal queries, pack downloads and sync; a progress/outbox export remains available, and no records are deleted. The app can display an explanation instead of loading unauthorized lessons.
5. The existing owner-scoped service worker retains its identity, scopes and caches. Staged runtime changes withhold the owner/media handshake while policy is restricted or unverified and send an owner-lock message, but **this is not secure media revocation**: the existing worker/network fallback and public URLs still need audit in U3D2. Previously published bytes cannot be made secret.
6. Both offline and unified candidate shells bundle the same policy parser **before** the runtime, with no extra startup network call while the flag is OFF. No change to the canonical online learner HTML, Auth storage key, install ID, service worker, IndexedDB schema, local backoff/retry protocols or backend.

## Future phases and production NO-GO

- **U3D2 — per-account scoped packs and media**: filter languages/topics/words/sentence groups, private membership, and feature gates; rework read/query joins and image/audio manifests; safely stage new content-addressed pack copies without ever treating old broader packs as newly authorized. Define offline protected/private media bytes and avoid storing live signed tokens. Block the existing service worker/public cache bypass in staged restricted mode.
- **U3D3 — sync, revision, account-switch and revocation reconciliation**: preserve historical progress and same-account outbox, distinguish work created before/after a policy revision, handle partially authorized pending events safely without dropping them; enforce recheck on reconnect and deny new restricted writes pending real approval. Prove multi-tab/update rollback, account swapping, cold startup, and non-destructive recovery.
- **U4 — physical Android/iPad testing** with actual installed PWA shells, Google OAuth, airplane mode, media, quiz, policy changes and rollback; synthetic browser tests do not replace hardware acceptance.
- **C4D + C5/C6** coordinated production and unified release, with verified backups, cloud settings, private-asset classification, protected media deployment, two unresolved npm high-severity advisories, durable release artifacts and explicit owner go/no-go.
- U3A/U3C2 `server_enforced:true` must not be claimed until all referenced SQL/RLS/RPC/Storage/Edge/worker checks are genuinely active and tested. Local snapshots are ordinary client data, not tamper-proof or retrospectively revocable.

## Acceptance checklist

- [ ] Dedicated isolated Node U3D1 tests PASS (fake UUIDs, policy snapshots, 24h expiry, monotonic revision, same-revision conflict, wrong-owner rejection, restricted fail-closed).
- [ ] Full offline/unified/Chromium same-origin rollback CI PASS at exact PR head; old shell, owner packs and outbox preserved.
- [ ] No production SQL, Cloudflare, Supabase, Storage, OAuth, worker or media changes, PWA data clearing, reinstall or real restricted user publication.
- [ ] Both activation flags remain hard-coded OFF and this PR stays draft until the owner reviews it.

**Release verdict:** U3D1 preparatory contract only; do not enable restricted friends or claim offline permission enforcement complete.
