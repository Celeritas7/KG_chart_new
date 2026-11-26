# U4B2B-3D / F2C — versioned ratings and topic completions

Base: merged #106 (`e898e5a49e4f9aacdb2e8cb6eab1b67e1c9c9735`); its isolated database and both-editions CI passed.
Candidate SQL is installed only in the disposable test fixture after F2A/B
and earlier regression tests. No production migration or client wiring.

## Candidate protocol
- Authenticated, confirmed, allowlisted existing restricted operator only.
  Lock the same profile used by F2A and check the supplied permission revision
  and current content/feature/private predicates before every read, write or
  replay. The exclusive profile lock serializes mutable progress operations
  by owner; distinct learners are independent.
- An owner-scoped baseline read returns the record and version. Version 0
  means no candidate operation yet, not that historical data is absent.
  Writes require a stable event UUID and explicit expected record version.
  Each successful operation increments that key's version in the same
  transaction; deletion leaves a version tombstone. Exact event replay
  returns the historical event version and separate current version without
  mutating anything. Different payload using the same owner/event ID conflicts.
  A newly delivered event with a stale baseline is rejected, even if its
  permission revision is current. Permission denial precedes receipt lookup.
- Ratings upsert/delete and completion upsert only; the test fixture models
  the timestamp fields already used in offline/restricted-sync.js. No
  unrestricted completion deletion. Compare typed timestamps at UTC; never
  infer a rating's recency solely from client wall-clock time.
- Restricted raw insert/upsert, update and delete are blocked with additional
  restrictive RLS policies. Zero affected rows on a raw update/delete are
  not a successful write. Legacy paths are left under their earlier policies.
  Private version/receipt tables are not exposed to API roles.

## Validation
CI checks existing rows at version zero; exact replay (including equivalent
timestamp offsets); replay after later updates and deletion; stale baseline,
event collision, wrong scope, other owner independence, raw table bypass,
legacy rollback, transaction rollback, concurrent identical retry, READ
COMMITTED revocation both orders, REPEATABLE READ and historical preservation.
Only exact-head CI can establish that the candidate passes.

## Limits and next
This is an explicit proposed baseline/receipt contract, not a real app payload
yet. The current offline event IDs and timestamps are not sufficient to infer
a safe record version. Client integration must capture a verified baseline
before editing, preserve the original event ID/revision/version across retry,
coordinate same-key queued events, never auto-rebase unresolved conflicts or
revoked events, and distinguish historical ACK from present state. Review
rating range and actual schema in isolated Supabase, including existing
timestamp defaults and constraints, before any migration. Initial version-zero
baseline and tombstones assume candidate-only writes while restricted;
legacy-to-restricted transitions, trusted owner/service mutations, retention
and lifecycle of versions/receipts need F3/release design. No claim that
global content/allowlist/private/media/catalog authorization edits coordinate
with these locks yet; that is a remaining F2 increment. Typing, speaking,
colour/session-only, flags, levels and other effective write paths also
remain. F3 lifecycle, F4/F7, 3E/F6, 3F, U4B2C and U4B2D are not waived.

No production database changes, deployment, real learner access, offline data
changes or release authorization. Restricted friend access remains NO-GO.
