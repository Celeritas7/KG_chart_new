# KG Chart U3D3C — Restricted permission-aware synchronization (review-only)

**Baseline:** merged U3D3B PR #93, `main` `98a2fd0b26a57dfc258f565f51b8bf42aaf740a2`.
**No production rollout:** U3C1 and all U3D1–U3D3B gates remain OFF, plus **`U3D3C_RESTRICTED_SYNC_ENABLED=false`**. No SQL/Edge/Storage/Cloudflare/OAuth deployment or user data changes.

## Why this phase matters

Previously saved offline outbox changes retain their original event ID, sequence and local rows, even if they are several days old. The U3D3A classifier can hold them but cannot determine which source was actually allowed. An admin may change a learner's language, topic, private lesson, quiz feature or verified sentence group while the iPad/Android device is disconnected. Naively replaying rows against a newly connected session could upload formerly unauthorized work, leak a private source, create duplicate quiz answers, or discard a conflict.

**Important source-discovered release gate:** `sql/kg-chart-u3a-access-snapshot.sql` and `sql/kg-chart-u3c2-sentence-topic-mapping.sql` currently emit `server_enforced:false` for prospective restricted snapshots. They are *not an authorization signal*. The U3D3C client requires an actual server-enforced snapshot, deployed restrictive RLS and identity-bound RPCs, and therefore **fails closed on the current staging backend**. The U3C1/U3D1/U3D2A/B1/B2/U3D3A/B toggles also remain disabled. No restricted learner should be invited yet.

## Implemented

1. **`offline/restricted-sync.js`** is a source-only, testable, no-background-work reconciliation contract. A candidate is considered for upload only when it belongs to the currently enrolled Auth owner, carries the *same known permission revision at event creation*, has a whitelisted table and operation, and matches the exact current server-enforced language/topic/feature grant. Historical untagged events, wrong-owner rows, unknown columns or table names, ambiguous sources, unsupported update kinds and revoked language/topic/mode remain **held**, without changing their original bytes or timestamps.
2. Ratings require the server identity-bound `kg_chart_u3b2_can_rating` and `kg_chart_u3b3b1_can_private_rating` RPCs **and** a permitted, real source vocabulary topic obtained through the existing RLS-controlled query. Completions require `kg_chart_u3b2_can_completion` and `kg_chart_u3b3b1_can_private_session`. Quiz sessions require an actual account-bound ID, nonempty granted topic, exact mapped quiz type/feature, `kg_chart_u3b2_can_quiz_session`, private-session RPC and, for sentence/speak modes, `kg_chart_u3c2_can_sentence_session`. NULL-topic "all topics" sessions and unsupported kinds remain held rather than being interpreted as broad permission.
3. Answers require an **already persisted, owner-matched parent session**, its actual topic/quiz mode, the private and U3B2 server checks, and a real vocabulary or sentence source (not both or neither). Vocabulary answers query the actual granted word/topic. Sentence answers require an RLS-controlled sentence/group, `kg_chart_u3c2_can_sentence_group` and a `kg_chart_u3c2_my_sentence_groups` response marked `server_enforced:true` that maps the group to the exact parent topic. A missing/false mapping, private/unknown answer, or parent not yet acknowledged is **held**.
4. **`offline/runtime.js`** adds `U3D3C_RESTRICTED_SYNC_ENABLED=false` and a completely isolated `syncRestrictedQueue()`. Under the new gate, after fresh `auth.getUser` + current access snapshot verification, it examines a bounded batch (200 per call), never enters the old legacy sync/level-up/pull loop, and checks current live identity/grant **before every write**. The existing `syncEvent` preserves duplicate quiz retry reconciliation, rating conflict checks and server read-back ACK behavior; current restrictive Supabase table RLS must independently authorize each write. A second live identity/revision snapshot is required **after each server write**.
5. Only after the verified write + second policy verification does an **atomic `['kv','outbox']` transaction** re-read the current persisted policy and exact original event bytes, owner ID and revision. It deletes just that matching event. A second tab changing a policy/outbox row, a sign-out, 403, missing RPC, stale grant, missing row, interrupted HTTP ACK, conflict, or IDB failure leaves the original event in the outbox. A failed rating holds subsequent events for that *same* word in order; unrelated entries may proceed. Duplicate retry remains supported by U3B2's exact immutable-row acknowledgment contract.
6. Reports expose **counts and reason codes only**. They contain no raw answer text, source UUID, email or signed-media URLs. Newly unresolved events and unprocessed batches remain queued; recovery export still preserves the raw original same-account outbox for offline restoration. No automatic deletion or history rewrite is performed.
7. Both offline and unified candidate builds load the pure classifier ahead of the runtime. The existing service worker, downloaded packs, Cloudflare same-origin caches, account storage, old `kg-chart-offline-v1` IDB schema and normal legacy syncing remain unchanged **with all gates OFF**.

## Security limits and release blockers

The present client code is **not enough to guarantee atomic server-revision locking**. Each live source probe and the actual INSERT/UPSERT are separate HTTP/PostgREST transactions; the backend RLS checks current grants at write time but does not prove that the permission revision remained unchanged *within the write transaction*. A grant could change after a successful write and before the next snapshot; the client correctly keeps the event unacknowledged, but the server might already have accepted it. Review and test a **server-side revision-atomic ingestion API or equivalent transaction-scoped policy enforcement** before claiming strict revocation race safety. Do not rely on a client-only preflight as production authorization.

The staged U3A and U3C2 `server_enforced:false` values, undeployed U1–U3C2 RLS/private bucket, and private media classification must be resolved in a **separately approved, backup-verified release**. Disabled code does not restrict live users by itself. Already public media cannot be made secret retroactively. RLS `SECURITY DEFINER` wrappers and JWT freshness require release review. A failed offline write or revocation must preserve the recovery JSON, not silently discard evidence.

## Intentionally held in this increment

- User-level preference updates and difficulty/unlocked level writes are **not** authorized for restricted replay until their exact source/owner/level-up RPC contract is reviewed.
- Ambiguous NULL-topic/all-topics or historical untagged quiz sessions; answers without a server-owned parent; missing/invalid source and mixed feature modes.
- New restricted offline personal writes remain disabled pending full U3D3/U4 learner UI and recovery acceptance. This increment deals with safely reconciling *existing* queued records with known creation revision, not creating unsupported client-side grants.
- Restricted cloud progress pulls and automatic level-up after a batch stay disabled. Existing legacy progress behavior is unchanged.

## Verification requirements

- [ ] The U3D3C synthetic exact-source, topic, sentence-group, revision, account-switch, duplicate, conflict, 0-ACK and partial-batch tests PASS.
- [ ] Older U3D1/U3D2A/B1/B2/U3D3A/B, U3C and private-record regressions PASS.
- [ ] Both PWA editions' build, 82+ offline tests, 4 unified contracts and real **network-isolated** Chromium same-origin migration/account switching/rollback PASS.
- [ ] Every U3C1/U3D1/U3D2A/B1/B2/U3D3A/B/C production gate remains hard OFF. No unreviewed SQL/Edge/Storage, OAuth, service worker or downloaded pack deletion.
- [ ] Draft PR reviewed; no merge or rollout without explicit user action.

**NO-GO for inviting a restricted friend or turning on the new flags.**

## After U3D3C

**U4** hardware Android/iPad, plus remaining **backend transaction/rollout security and C4D/C5/C6** approval gates. U4 must include iPad offline progress preservation, on-resume policy refresh, real private media/audio, account switching, 0-write rejection, lost ACK idempotent retry and rollback. No production toggles or private media migration until the user approves staged rollout and source backup evidence.
