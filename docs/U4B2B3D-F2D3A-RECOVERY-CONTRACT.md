# U4B2B-3D / F2D3A — F1 quiz recovery contract reconciliation

Reviewed base: `4e7b43a1d62a5b338d073ca50d03d29e5c993090` (#110 merged). Prior F2A–F2D2 isolated CI
run [45851113166](https://github.com/Celeritas7/KG_chart_new/actions/runs/45851113166)
passed, as did both editions. Older #46 and #74 remain separate.

## Contract and scope

The F1 `js/kg-quiz-save.js` stores owner-scoped v1 drafts with stable
session/answer UUIDs, `answered_at`, per-answer `session_id`, and
optional `quiz_level` and `difficulty`. F2B instead required answer
`created_at` and had no level parameter. The isolated candidate now
accepts the original sealed recovery envelope via
`kg_chart_f2_save_recovery_quiz(expected_revision, draft)`.

- F1 envelope and answer parent/quiz-kind identities must agree; owner
  must match auth.uid(). The existing F2A/F2B lock order, live grants,
  revision, scope checks, score/answer-set consistency and transaction
  remain authoritative. Old positional write RPCs are internal only
  after the F2D3A fixture step.
- The session helper stores and compares optional typed-word level;
  current type_word requires copy/dev/memory; unknown historical level
  is held rather than guessed. Other quiz types cannot supply it.
- For a new answer, created_at is derived from the already durable
  answered_at, never the retry clock. An existing same-owner partial
  may keep its server-assigned created_at, but every client-authored
  field must match. No historical timestamp or score is overwritten.
  Omission hints are not permission to discard an original field:
  an unverifiable historical partial remains a conflict.
- The actual F1 module generates test recovery records using fictional
  IDs and storage, including sealing and reopening. PostgreSQL tests
  consume those records directly; test exact replay and typed-level
  persistence, partial recovery, conflicting/foreign/denied/stale
  requests, concurrent retries, rollback, revocation and regrant.
- The earlier F2A–F2D2 suites still run in their original order before
  the final adapter privilege transition. No changes to learner UI,
  real outbox, schema migrations, production RPC, or release flags.

## Remaining boundaries

F2D3A is a database candidate, not the live F1 saving integration. F2E1
must durably seal the original draft, verify current owner and revision,
call the reconciled RPC, validate receipts and retain work on any
uncertain/denied response. Explicit reconciliation is required for
historical partials whose authored fields cannot be confirmed.
F2D3B handles typing/speaking/colour quizzes; F2D3C handles levels/unlocks;
F2D3D and E handle remaining writes and authorization performance.
The fixture continues to model at most 500 answers; larger actual runs
must be addressed before integration, not split into non-atomic saves.
F3 lifecycle design, offline migration, consolidated production schema
and real API/device acceptance remain separate. Restricted friend
access is NO-GO. No merge, deployment, production changes, real permission
changes or pack/data clearing authorized.
