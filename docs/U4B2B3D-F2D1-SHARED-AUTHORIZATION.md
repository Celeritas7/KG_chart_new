# U4B2B-3D / F2D1 — coordinated private rules and sentence mappings

Base: merged #107 (`45bf6105826ef0600e104ce0b5df262e3b5bdef3`), both exact-head CI workflows passed.
F2D1 is a bounded candidate in the existing network-disabled PostgreSQL test
fixture. No production SQL, client, deployment or permissions are changed.

## Protocol

- A private singleton authorization epoch is created before F2A regression
  tests. F2A grant publication and restricted session saving (also used by
  F2B), plus F2C progress read/write, take a shared row lock **before** their
  existing profile/record locks. All earlier behavior tests are retained.
- A later fixture step installs BEFORE STATEMENT exclusive-lock triggers on
  private settings and sentence mappings, and AFTER ROW revision triggers.
  Real SQL DML paths (insert, update, delete, upsert, key rename) coordinate
  without trusting a caller-supplied revision or relying on a preflight.
  Both OLD and NEW settings keys are checked. TRUNCATE is explicitly refused.
  Existing RLS remains in force; the synthetic settings fixture gets a
  test-only admin DML adapter to model the existing admin capability.
- Any changed private_lessons row or mapping row increments the epoch and
  all existing restricted profile revisions inside the same transaction.
  This is deliberately conservative (even an unaffected restricted learner
  needs a fresh snapshot). No-op edits and unrelated settings do not bump
  revisions. Ordinary settings DML still takes the exclusive statement lock.
  A multirow edit may increment revisions several times; rollback restores
  rules, mappings, epoch and revisions together. Existing legacy profile
  revisions are not bumped. No historical quiz/progress records are deleted.
- A restricted writer and global editor cannot commit contradictory decisions:
  editor first means a waiting old revision fails, writer first means its
  committed work survives later revocation. A stale repeatable-read snapshot
  is rejected by PostgreSQL's row-version lock. The common lock order is
  global gate -> profile -> learner records. Grant publication shares this
  order, so a stale per-user admin draft is rejected after a global edit.
- Test existing settings source and sentence registry using actual fixture
  admin SQL DML, and maintenance insert/delete/rename/upsert with rollback.
  No new frontend setting or permission activation.

## Validation required
Exact-head CI must pass all earlier F2A/B/C regressions and new tests:
private-rule revoke-first, mapping write-first and repeatable-read
revoke-first, revision invalidation/regrant, same-user history and other
learner preservation, admin grant edit race, direct unauthorized DML,
TRUNCATE rejection, no-op/unrelated edits and rollback.

## Limits and remaining work
The global trigger protocol covers these two sources and only the candidate
restricted write/read RPCs. It does not yet coordinate allowlist/auth lifecycle,
language/topic/translation/content/catalog changes, media registry and all
other effective authorization inputs, including foreign-key-driven changes
originating at those other tables. It does not guarantee legacy direct write
serialization, Edge/Storage enforcement, or prevent trusted schema owners from
disabling triggers. Real API roles, grants, triggers, RLS and Supabase
transaction behavior must be separately verified. Broad invalidation can
increase queued conflicts; evaluate selective publication only with evidence.
Global edits do not append U2 draft-audit snapshots (those record grant
replacement); production global change audit/CAS semantics and migration
design are pending. Mixed multi-statement edit/write transactions may
deadlock/abort; normal one-operation transactions must be tested and no
automatic stale rebase is permitted. No real database or UI code is touched.

Next F2D increment: other effective-authorization sources and remaining
write paths, followed by actual app/outbox integration. F3 lifecycle,
F4/F7, 3E/F6, 3F, U4B2C and U4B2D remain. Restricted friend access is NO-GO.
