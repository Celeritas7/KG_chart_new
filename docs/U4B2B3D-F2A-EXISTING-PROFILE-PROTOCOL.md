# U4B2B-3D / F2A — existing-profile transaction protocol candidate

Base: merged #104, `0876b85c8d38330d993b867a94447cdfb10cd985`. This is the first bounded F2 increment,
not the completion of F2. All candidate SQL is under tools/tests and refuses
databases other than the disposable CI fixture. Do not apply to Supabase.

## Implementation

* Replace the existing U2 draft RPC **only in the candidate fixture**, keeping
  its signature, full selection validation, audit and legacy-only response.
  Share its validation with a separate existing-restricted-profile grant
  replacement RPC. Neither can activate or change mode; the latter refuses
  missing profiles. Verify the administrator using auth.uid(), a confirmed
  Auth identity, the allowlist admin role and the existing admin predicate.
* Both administrative RPCs lock the existing profile for update, compare the
  expected revision, replace grants and append the audit in one transaction.
  Revoke direct API-role DML/TRUNCATE on profiles/language/topic/feature
  selections and audit; retain SELECT with the existing RLS. Trusted fixture
  owner setup remains possible. The current admin UI uses the same U2 RPC
  (js/kg-admin-access-ui.js); no UI or production SQL changed.
* Candidate restricted quiz-session RPC requires a client expected revision,
  locks the same profile FOR SHARE before the write, derives the owner and
  applies all current session scope predicates. Direct restricted session
  INSERT remains blocked by a restrictive policy. Replay acknowledges only
  the exact same immutable owned row, and never bypasses a stale revision
  or scope denial. Legacy path retains the previous fixture policies.
* CI exercises actual SQL endpoints and privileges, exact saved rows, stale
  and conflicting retries, rollback, and deterministic blocking relationships
  under READ COMMITTED (both orders) and REPEATABLE READ. Other-learner writes
  are checked while the first learner's grant transaction is held.

## Explicit boundaries and next

This fixture does **not** close F2: actual API roles and inherited/column
privileges, SECURITY DEFINER ownership and PostgREST calls must be reviewed in
isolated Supabase before production. No direct production permissions change.
The session RPC is not wired to the app, and it does not make session + answers
atomic. Next F2 increments: apply the revision protocol to answers, ratings,
completion and remaining write RPCs/outbox, including an atomic quiz ingestion
design; coordinate or disallow private rules/media/sentence-map, allowlist,
catalog/content and other effective authorization mutations; verify existing
legacy/admin paths and all bypasses, then integrate the client expected
revision and recovery/acknowledgment behavior. F3 separately handles durable
disabled state, enrollment and mode changes (including absent profiles).
Retain F4/F7, 3E/F6, 3F, U4B2C and U4B2D.

No deployment, live database operation, restricted access activation, data
clearing, pack removal or production acceptance. Existing offline work and
F1 code are untouched. Friend access stays on hold until U4B2D-3 acceptance
and separately approved activation. CI results must be observed on the exact
PR head before describing even this fixture increment as tested.
