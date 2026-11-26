# U4B2B-3D / F5 — database CI coverage and ownership evidence

Base: `d274ceae1e3b9368f3d1bea3390b3b3013ce6844` (merged PR #103).
F1 remains completed within its documented client/fixture boundary. This
increment changes only CI, synthetic tests, and documentation; F2/F3
production-compatible transactional enforcement is a later increment.

## Scheduling decision

Remove the partial `pull_request.paths` allowlist entirely rather than
trying to maintain a list of transitive dependencies. The isolated database
workflow now runs on ordinary opened, synchronized and reopened PR events
regardless of changed files or base branch, plus manual dispatch. This
intentionally increases CI work on unrelated PRs. It neither deploys nor
changes production. The existing PostgreSQL 17 disposable container remains
network-disabled; Edge mocks remain fictional; repository token remains
read-only. No secrets or live accounts are needed.

In particular, a one-file change to either of these previously missed inputs
no longer fails a path filter:

- `tools/tests/u4b2b-revocation-race.py`
- `tools/tests/u4b2b-quiz-lock-prototype.sql`

The same unfiltered trigger covers all prerequisite `sql/**` and fixture
files (including `u1-access-fixture.sql`, `u3a-access-fixture.sql`,
`u3b1-content-fixture.sql`, `u3b2-write-fixture.sql`,
`u3b3a-private-fixture.sql`, `u3b3b2-private-media-fixture.sql`,
`u3c2-sentence-fixture.sql` and its assertions), the two Edge test entry
points, their imported `supabase/functions/**/core.ts` and
`js/kg-private-media-client.mjs`, and future transitive source inputs.

The new `tools/tests/u4b2-ci-trigger-contract.py` runs in this job. It
asserts the exact unconditional PR/manual event stanza and the absence of
a job-level conditional/dependency gate, and rejects six negative source
mutations. This is static trigger-contract evidence; only a GitHub Actions
run on a PR is observed scheduler evidence. Record actual run links in
the PR, and do not describe a source check as a separate one-file PR run.

## Discriminating ownership and UPDATE tests

- 3A: both fictional learners have the same restricted Burmese/Food/word
  quiz grants, and each creates an actual owned parent with the same
  language/topic/mode. Check grant helpers, the public word's translation,
  valid private-answer authorization and each positive answer. Challenge
  both foreign parents, requiring SQLSTATE 42501 and the specific fixture
  owner-guard diagnostic, with no persisted foreign row. Repeat the exact
  same answer ID/word/result using the valid parent and assert the saved
  association. Retain the old different-scope negative and the existing
  revoke-first race. Assert histories for both learners after revocation.
- 3B: standalone rating UPDATE must return exactly one expected row and
  persist rating 3, other learner rating 2 and older history unchanged
  before the later UPSERT writes 4.
- 3C: standalone completion UPDATE must return exactly one expected
  timestamp and persist it, with the other learner and old history
  unchanged, before the later UPSERT writes D3.

These tests strengthen previously ambiguous evidence; they do not
demonstrate that an ownership bypass existed. Existing 3A–3C prototype
guards and production SQL are unchanged. The pre-existing stale-snapshot
characterization is still an intentional release blocker before the fixture
guard is installed. Passing the fixture suite does not close F2/F3.

## Next and preservation

After review and merge, continue U4B2B-3D with F2 transactional permission
and revision enforcement, then F3 lifecycle and F4/F7, retaining F6 for
3E and the existing 3F → U4B2C → U4B2D roadmap. No migration, deployment,
real learner permission changes, restriction activation, pack clearing,
or outbox modifications. Restricted friend access remains NO-GO pending
U4B2D-3 acceptance and separately approved activation.
