# U4B2B-3D / F2D2 — content/catalog authorization sources

Base: merged #109 (`e7a1370411906ea1fc2b66f5c40a027f9926f99c`), both exact-head CI workflows passed,
including the F2D1 suite previously blocked by the corrected SQL syntax.

## Candidate scope

Extend F2D1's shared/exclusive transaction gate to the following nine
fictional source tables: feature catalog, languages, topics, topic
translations, vocabulary, vocabulary translations, sentences, colour
phrases and private-media registry. These are inputs to current effective
language/topic/feature, source, group and media authorization. Existing
F2A grant and quiz, F2B atomic quiz and F2C progress RPCs already acquire
the shared gate before profile and data locks.

Each source now acquires the exclusive gate before DML, and publishes a
new epoch plus increments all existing restricted profile revisions on
each actual changed row in the same transaction. No-op row updates do not
publish; INSERT/UPDATE/DELETE/UPSERT and FK-originating changes use the
same mechanism. TRUNCATE is refused. RLS remains in place; the test-only
admin adapter models content editing absent from the minimal fixture and
does not extend SELECT permissions. Catalog and media registry use their
existing admin policies. All earlier regression suites run unchanged.

This deliberately invalidates even unaffected restricted snapshots when
content or media metadata changes; it does not remove existing progress
or authorize deletion of historical data. Bulk content edits may cause
revision churn; optimize only after preserving correct invalidation.
Existing legacy users and actual production SQL are unchanged.

## Tests scheduled in isolated CI

- Per-table actual admin updates and no-op updates, direct learner denial,
  trigger presence, truncate rejection and transaction rollback.
- Trusted fixture insert/upsert/delete and exact revision assertions.
- Topic translation deletion that cascades into a topic grant, rollback
  of both source and grant changes and revisions.
- Feature disable wins against a waiting rating write (READ COMMITTED);
  new revision still denies revoked content until restored.
- Completion wins against later topic hiding, preserving history and
  verifying exact replay only after renewed authorization.
- Media registry edit vs repeatable-read restricted write; old revision
  denied, current media helper denies disabled asset, unrelated fresh
  rating remains allowed. No delivery claim from metadata authorization.
- Unaffected learner and prior quiz history preservation.

## Boundaries and next

The nine source hooks are fixture candidates, not a production migration.
They do not serialize a real Edge/Storage delivery or revoke downloaded
media. Auth identity, allowlist and missing/disabled/re-enrolled profile
lifecycle need the F3 design; a naive cascade can create a legacy-access
window. Production privilege/trigger audit, source edits outside these
tables, other privileged write RPCs, typing/speaking/colour/flags/levels,
legacy behavior, admin CAS/audit and client/outbox integration are still
pending. The grant and data mutation endpoints are not yet used by the
real client. Mixed transactions, FK lock ordering and bulk updates require
further real Supabase verification. No production Supabase, Cloudflare,
device data, real learner permissions or deployment changes are authorized.

Next: remaining restricted write paths and application integration within
F2, then F3, F4/F7, 3E/F6, 3F, U4B2C and U4B2D. Restricted friend access
remains NO-GO until acceptance and explicit approved activation.
