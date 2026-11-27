# U4B2B-3D / F2D3E2 — administrative learning-path controls

Base: `7b0637532b8083d23a7a30383247f3b50dc21bc4` (#118 merged, both CI workflows passed).
This is the final bounded Group A candidate, not a production migration.

## Source reconciliation

The actual `kg-chart-admin.html` functions `saveUnlock`, `doReset`,
`setLearnerLevel` and `toggleBypass` write the manual unlock table,
append reset cutoffs, upsert the difficulty row and update the global
admin-only bypass setting respectively. `index.html` learning path
uses own email, concrete language and wildcard unlocks/resets, max
reset timestamp, historical answers/completions, and the admin boolean.
A reset does not delete history or manual unlocks. Old admin unlock
additions/removals are separate requests; raw level upserts and bypass
updates have no candidate baseline/receipt.

## Candidate

- `kg_chart_f2_admin_path_control(event_id, operation, changes)` is
  verified-admin only (actual confirmed Auth identity plus approved admin
  role), with bounded atomic batches of up to 50 changes of one type,
  one explicit target UID/revision per row. A private immutable receipt
  binds event/actor/hash and before/after results. An exact retry ACKs
  the original operation without reapplying it; refetch current state.
  A changed event, stale revision or invalid target rolls back the batch.
  Only existing restricted operator profiles are writable by this
  candidate. Legacy admin UI/schema compatibility remains integration work.
- A manual unlock is a learning-path override, never a permission grant.
  Adding requires a current active translated, visible, granted topic
  including private membership; removing an old revoked override is
  allowed. Wildcard preserves the existing all-languages meaning but
  reads intersect concrete current authorization (including future grants).
  The scoped learner RPC returns only current permitted topic IDs and
  the applicable reset cutoff for its own verified identity/language.
  Old private/revoked overrides remain historical, not visible or deleted
  unless explicitly removed. Raw restricted wildcard reads are blocked.
- A topic-path reset appends a server-timestamp cutoff to the named
  learner/language or wildcard; no global new reset, arbitrary timestamp,
  history deletion or rating/difficulty reset. Historical global NULL-email
  reset records remain applicable. A changed targeted control increments
  only that profile revision, not the global content epoch. No-op actions
  are audited but do not invalidate the revision.
- Difficulty overrides use the current level version and clamp selected
  level to the new unlocked ceiling 1–4. **Design decision:** lowering
  creates an administrative cutoff, so earlier quiz evidence cannot
  immediately undo the override. Only new atomic MCQ receipts confirmed
  and sessions started/completed after the cutoff qualify. Earlier receipt
  confirmation times stay unknown; no guessed backfill. Raising a level
  does not erase the cutoff. Topic resets and difficulty overrides remain
  separate. Actual grading/clock trust and history display remain review
  items; this is not anti-cheat.
- Admin-only bypass uses its own version, verified admin gate and
  receipt. It never grants a restricted learner content or bypass;
  targeted learner revisions do not change. Direct API bypass-key DML
  and other-owner level changes are blocked in the candidate. Keep old
  own-row legacy level behavior and legacy own/global path history reads.
  No direct new path-control table writes for API roles.
- Short rare admin operations take the exclusive global gate before
  identities/profiles/data, preserving the existing lock order and
  preventing concurrent stale learner saves. Private audit/versions
  have RLS/no API grants; audit holds IDs/control state only, not quiz
  or private lesson content. No invented historical audit or deletion.

## Verification and remaining integration gates

Disposable PostgreSQL tests exercise verified admin versus forged admin
boolean, target scope/private and wildcard filtering, batch rollback,
targeted revisions, no-op/replay, append-only reset history and writer
race, override stale version and post-cutoff evidence, bypass version and
isolation, legacy reads, private audit privileges and prior regressions.
The real schema for manual unlocks/resets and administrative privileges
is not inspected here. Preserve historical rows and legacy administrative
behavior during actual migration review. Email reuse, allowlist removal,
profile mode transitions, receipt retention and owner-level lock order
need F3. Raw trusted SQL/service maintenance and real Supabase BYPASSRLS
roles must be audited in consolidation/integration, not inferred from
the fictional role fixtures.

F2E must integrate admin controls with exact batches/receipts and
baseline reads, learner path-control reads, owner/permission-scoped
local mirrors and fail-closed UI when access is unavailable. Topic
completion eligibility, reset chronology and historical/offline replay
must be reconciled, including client-authored timestamps, in F2E/F6.
A stale reset-era request must never be silently reissued with a fresh
revision. Existing admin all-learners/legacy UI is unchanged here; the
candidate does not introduce a global reset or migrate any real controls.

No hosted DB, actual app/Edge deployment, real reset, grant change,
account creation, storage clearing or permission activation. Restricted
friend access remains NO-GO. Next: Group B F2E1 online quiz integration
with the explicit F3 lifecycle design gate before final reconciliation.
