# U4B2B-3D / F2D3E1 — bulk authorization publication and audit

Base: `c3dd6a3c3c8421f1815593c980a708195681db7e` (#117 merged and verified). F2D3E is
split into E1 (global content/settings publication and audit) and E2
(administrative learning-path control review). This is a disposable
PostgreSQL candidate only.

## Problem and design

F2D1/F2D2 installed a BEFORE STATEMENT global-gate lock plus AFTER ROW
publication on 11 sources. F2D3C/D2 added unlock rules and daily limit
to sensitive settings. One 1,000-row vocabulary import therefore
advanced every existing restricted profile 1,000 times.

Replace only the row publication triggers with PostgreSQL AFTER STATEMENT
transition-table triggers for INSERT, UPDATE and DELETE. Keep the
existing BEFORE lock, source RLS, no-TRUNCATE controls, profile locks,
revision checks and grant-publication RPC/audit. Each nonempty changed
event group updates the epoch and each restricted profile **once**.
Use whole-row JSONB multiset differences for UPDATE, including PK
changes and exact no-op groups; sensitive settings filter both old and
new keys. No semantic timestamp suppression is assumed. An empty,
identical or unrelated-setting transition does not publish.

A mixed INSERT ... ON CONFLICT DO UPDATE can publish two groups.
FK cascades and multiple statements can publish additional groups.
Do not coalesce by transaction or suppress nested triggers: later
statements and cascades can change authorization again. External writers
still acquire global gate then profile before data, and cannot observe
a committed source change without its revision increment. F3 remains
responsible for identity/allowlist-origin cascades and lifecycle lock order.

## Audit

A private RLS-enabled table stores one metadata-only audit row per
published epoch: source, operation, old/new unmatched row counts,
number of affected restricted profiles, transaction ID, timestamp,
invoking role and a verified authenticated actor ID when available.
No source texts, grant contents, email lists or private rule values are
copied. A trusted maintenance/service action is not falsely labeled a
learner or admin. A publication failure rolls back source and revisions.
No API role can read, write, or truncate the audit table. It starts at
this phase, not a fabricated retrospective history. Actual audit
retention, administrator access and production privileges require review.

## Verification

The same synthetic 1,000-row insert/update/delete workload is first
executed against the old row-trigger behavior and rolled back, checking
actual epoch and profile increments. After installing E1, execute the
same workload and count revisions and audit rows. Expected reduction:
3,000 to 3 increments per restricted profile across the three changed
statements, with no-op/empty statements excluded. This measures revision
churn, not end-to-end production latency, throughput or lock wait time.
Transition relations/whole-row comparisons still have a cost, and
one-row-per-request imports still publish once per request. Batching
and actual large-scale timing belong to integration/operational tests.

Recheck all 11 trigger sources, unauthorized writes, no-ops, sensitive
setting rename, mixed upsert, FK cascade (including grants), rollback
and both concurrent editor/writer lock orders with real synthetic
progress operations. Keep every earlier CI step.

## Remaining scope

E2 reviews the actual admin manual topic unlock, progress reset, level
override and admin-only bypass paths in kg-chart-admin.html and
index.html. They are not ordinary content edits or learner preferences.
The admin bypass is gated by is_admin in the existing app; it remains
outside E1's restricted revision scope. Do not claim those paths are
integrated or secured by this global publication change.
Actual Supabase schema, auth/roles, storage/media APIs, data volumes,
audit retention, F3 lifecycle and F2E client/outbox integration remain
unverified. No hosted migration, deployment, real permission activation
or data clearing. Friend access remains NO-GO.
