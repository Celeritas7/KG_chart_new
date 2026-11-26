# U4B2B-3D / F2D3D2 — pronunciation assessment write candidate

Base: `fa98b5159836c165c66d85ffca474c19a57898b6` (#115 merged and verified).

The real Edge handler verifies Auth and checks
`kg_chart_u3b2_can_pronounce` before Azure, then counts attempts and
writes the scores using the service client after the provider returns.
The old preflight alone cannot protect that later write. A daily count
without a reservation can race, and a lost response can cause repeated
provider work. This increment isolates the proposed transaction and
Edge orchestration. It does not edit the deployed function or its
legacy behavior.

## Candidate contract

- The authenticated begin endpoint validates owner, existing restricted
  profile and explicit permission revision, then uses the existing current
  word/sentence/feature/private reference predicate. It binds a stable
  request UUID and the exact reference plus SHA-256 of the recording.
  Only a newly created ticket returns `start`. A retry returns pending
  or a terminal outcome; a changed request or owner is rejected.
- Shared authorization gate, identity/allowlist, profile and per-owner
  reservation locks protect authorization and quota. The ticket lasts
  three minutes; no database transaction or lock is kept open while
  calling the provider. Successful records plus unexpired reservations
  count against the UTC daily limit. Known failures and no-speech release
  the reservation; expiry permits a new explicit attempt, not replaying
  provider work for the same ID. A failed begin may be retried using the
  same ID if no ticket was created.
- Only the trusted service role can finalize. It uses the verified
  owner ID from Edge, current allowlist/confirmed identity, exact
  ticket revision, and the same coordinated locks. It cannot manufacture
  an authorized ticket. A change in grants, content, private rules or
  daily-limit setting invalidates an old revision before any score
  insertion. The ticket and attempt commit atomically; identical
  completed-result retries return the same record, not a new attempt.
  Invalid/foreign/expired/changed requests and untrusted score writes
  fail closed. Current scope is established at begin and maintained
  by the revision protocol; F3 must close lifecycle/remove/regrant
  races before this assumption can be trusted in a real deployment.
- The test Edge adapter uses the existing WAV validation, reference
  transformation and Azure score parser. It accepts only a verified
  caller, stable request UUID, revision and actual audio; never a
  browser-supplied score or owner. It hashes the audio in memory,
  invokes the provider only for an acknowledged start, and returns
  saved success only for a validated committed receipt. No Azure key,
  service key, audio or production data appears in the fixture.
- The disposable table models the columns currently written by
  `kg-pronounce/core.ts`. It denies API role direct mutation including
  service-role direct insert in the fixture. Score reads are owner/admin
  and scope guarded. Historical, out-of-scope records are not deleted;
  actual history-read compatibility belongs to F6/F3. The candidate
  currently uses a safe integer daily-limit range of 1–9999, with 100
  fallback; reconcile that with the actual admin configuration.
- Private tickets retain reference metadata and a recording digest,
  never audio. Retention/deletion and migration from existing attempts
  must be reviewed. This does not prove provider-side exactly-once
  billing (the real Azure helper can retry internally). A lost begin
  acknowledgement can leave a pending reservation without a provider
  call; a lost finalization can leave either a saved or pending outcome.
  Do not automatically rebase or create a fresh ID.

## Verification and release boundary

The new suite runs after F2D3D1, retaining prior SQL and Edge tests. It
covers permitted word/sentence references, malformed/unmapped/private
references, untrusted score submissions, receipt replay, independent
learners, atomic quota reservation, expiry, rollback, concurrent
revocation, limit edits, identity recheck and preservation of saved
records. Separate mocked Edge tests exercise malformed/unconfirmed
acknowledgements and provider invocation/receipt boundaries.

This is restricted fixture work only. F2E must implement actual client
request identity and permission-revision handling, durable recovery,
real Edge routing with service-only finalization, and legacy coexistence.
F3 and isolated Supabase/Edge verification must confirm real privileges,
identity lifecycle, row schemas, quota policy and retention. No hosted
migration, deployment, permission activation or real provider calls.
Next F2D3D3: personal preferences and remaining write-path inventory.
