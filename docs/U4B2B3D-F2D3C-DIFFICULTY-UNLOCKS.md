# U4B2B-3D / F2D3C — difficulty and level unlocks

Base: `35fd1a5d8c1d59ab31ffe1cc79526192745d5c4f` (#113 merged). #112/#113 isolated database and
both-editions CI passed. The existing C4C and older offline PRs remain separate.

The six word MCQ modes alone use difficulty levels 1–4; the actual
`index.html` level-up formula walks most recent whole quizzes until
the configured answer threshold is covered. The old server RPC trusted
session summaries and raw learner level upserts accepted unlock values.

## Isolated contract

- Explicit current permission revision and verified restricted operator,
  existing profile, language and word-quiz scope; acquire the shared gate,
  profile and owned level row before a session. Direct restricted level
  writes and the old summary-only level-up RPC are blocked. Legacy paths
  retain prior behavior; lifecycle transitions are not released.
- `kg_chart_f2_level_state`, `kg_chart_f2_select_difficulty` and
  `kg_chart_f2_check_level_up` return owner-specific level, unlocked level
  and state version. Selection may only choose an already unlocked level.
  Expected state version serializes competing updates. A stale or uncertain
  update must reread state, not silently rebase or repeat an advancement.
- The recovery RPC requires an explicit unlocked difficulty for the six
  MCQ types; other quiz modes cannot supply difficulty. Selection may differ
  across devices, so a previously unlocked lower level remains valid.
  Successful atomic saves record a private exact answer-ID receipt in the
  same transaction. The former recovery entry point is internal only.
- Advancement verifies receipt identity, complete answer set, actual score,
  current authorization, correct type and difficulty. Unmarked historical
  summaries (even complete-looking ones) are conservatively excluded until
  an exact recovery or separately reviewed reconciliation confirms them.
  Previously unlocked levels and all old history are preserved, never reset.
  Existing inconsistent historical level rows are held, not corrected blindly.
- The settings gate now publishes changes to `unlock_rules`; no-op edits do
  not publish. The fixture's restricted rule parser follows kg-shared.js's
  language/global/default precedence and numeric clamping; the legacy fixture
  helper still uses defaults. Actual production schema and rule function
  must be inspected in isolated Supabase integration.
- Answer consistency is not anti-cheat or independently verified grading.
  This correction is difficulty-level advancement, not a new topic-completion
  scoring system; topic completion ownership/versioning remains F2C and
  topic history/presentation remains 3E/F6.

## Tests and release boundary

The new step runs after F2D3B2, retaining all older regressions. Synthetic
tests use the actual F1-generated draft shape and cover raw/old RPC
bypass, unauthorized difficulty, missing evidence, partial recovery,
score thresholds, stale state versions, concurrent unlocks, rule edits,
revocation with a different granted topic, regrant, independent history
and legacy rollback. Explicit difficulty is required for MCQ; historical
unknown difficulty must be held rather than guessed. A valid F1 draft
which completes an old matching session can earn a receipt without
rewriting its history. Tests run on network-disabled disposable PostgreSQL.

F2E must integrate level state/version and recovery receipt handling with
the real UI and offline queue; a stale version is a reconciliation signal.
F3 lifecycle must define state-version treatment across mode transitions.
No UI/outbox changes, production migration, merge, deployment, permission
activation or data clearing authorized. Restricted friend access remains
NO-GO. Next F2D3D: flags and remaining personal writes.
