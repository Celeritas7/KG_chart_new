# U4B2B-3D / F2D3D1 — restricted flag submissions

Base: `be58fd250a4bfc9ab49ef1e38dd692f985997bb2` (#114 merged; both CI workflows passed).
The reviewed roadmap's F2D3D is split into small independent increments:

1. F2D3D1: single and batch report ownership, scope, transactional retries.
2. F2D3D2: pronunciation assessments, including the privileged Edge write
   after authorization preflight and the external assessment interval.
3. F2D3D3: personal preferences/typing bests and inventory of other personal
   writes. Admin content corrections are authorization sources, not learner
   preferences. Reconcile the actual paths before declaring F2D3D complete.

The current `FlagModal` and `BatchFlagModal` insert reports with DB-assigned
IDs; schema compatibility fallbacks can remove content IDs and repeated
submissions can duplicate rows. The current bulk UI sends groups of ten.
The isolated new endpoint `kg_chart_f2_submit_flags(revision, owner_id, flags)`
accepts one to ten original authored report objects, each with a stable
client UUID. Every batch commits completely or not at all. It checks the
owner against verified auth identity, existing restricted profile and
revision under the shared authorization gate. Every target requires the
current feature/language/topic/private scope; colour targets also require
both component translations. It does not drop content IDs or reinterpret
an ambiguous save as success.

The receipt is per flag ID, not per word/reason. Exact repeated IDs return
the same acknowledgement (order-independent); distinct intentional
reports about the same item remain separate. A private hash receipt records
the canonical v1 authored fields, excluding server timestamps/moderation.
No second plaintext notes copy is stored. The same UUID cannot be reused
for different text or owner, or resurrect a removed report. A prior
unreceipted historical row cannot be claimed. Receipt retention and
identity lifecycle need explicit F3/3F review. Fixture fields reflect
current frontend/admin usage, not a production schema inspection.

The old reporter-stamping trigger and read isolation remain in effect.
A new restricted direct write policy blocks bypass without changing legacy
reporting. Admin moderation uses status/resolved_at in the existing UI;
an exact retry will not reopen a resolved or dismissed report. An isolated
fixture-only moderation policy models this admin update; it is not a
proposed hosted grant. Any altered authored row is held for reconciliation.
The 10-row and field/byte limits are candidate validation bounds. Larger
user selections must retain per-batch stable IDs and pending work in F2E,
not report success until all intended batches are acknowledged. F2E must
persist owner/revision/IDs, retain denied/ambiguous work, verify receipts,
and handle earlier offline queued reports without guessing IDs or authors.

The additional disposable PostgreSQL suite runs after F2D3C and retains
prior suites. It tests exact and concurrent retry, distinct intentional
reports, foreign ownership, moderation, unauthorized direct inserts,
malformed or private/foreign/unmapped targets, incomplete translations,
atomic rollback, missing historical identity, deleted-row replay,
revocation/regrant and legacy compatibility.

This increment does not implement pronunciation writes, preferences,
new flag styling, Devanagari prefill, live UI integration or production
migration. No deployment, merge, permission activation, real learner
changes or data clearing. Restricted friend access remains NO-GO.
