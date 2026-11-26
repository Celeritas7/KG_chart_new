# U4B2B-3D / F2B — atomic quiz and answers candidate

Base: merged #105, `24d14873fc75accaa3240ff9048587ae4ad3de8e`. F2A isolated PostgreSQL CI passed.
This increment extends that fixture, not a deployable migration or client change.

## Design

- The restricted word/sentence quiz RPC commits the session and complete answer
  set together, uses F2A's existing-profile transaction/revision check, and
  serializes same-session requests by locking the owned parent. A single SQL
  failure rolls back every new row, including a newly inserted session.
- The former restricted session-only endpoint is no longer callable by API
  roles in the F2B fixture. Direct restricted answer inserts have an additional
  restrictive policy. Legacy direct paths retain the existing guard/policies.
- Strict answer shape, stable IDs/timestamps, total/correct counts and exact
  replay matching are checked. Conflicting payload/owner/extra answer rows
  cannot be acknowledged. A compatible historical partial may be completed;
  no deletion or replacement of history. Authorization is checked before any
  replay acknowledgment. The sentence path explicitly checks verified current
  group mappings and optional session topic association in addition to the
  current answer/private helpers.
- Scope is completed word and sentence quizzes only (1–500 answers).
  This is an explicit candidate request shape, not yet the real F1 payload
  contract. Colour/session-only, typing/speaking and other paths are separate.
- The added fixture step executes after existing F2A tests to preserve their
  baseline; no previous tests or workflows are removed.

## Validation boundary

CI must exercise rollback on an invalid second answer, conflicting and foreign
answer/session IDs, exact replay and concurrent replay, no direct restricted
write bypass, denied unmapped/private sentence, matching partial recovery,
revocation/regrant, independent learners, legacy compatibility and explicit
rollback. The candidate validates summary consistency, not client honesty or
quiz grading. CI results must be inspected on the exact submitted head.

F2 remains incomplete. Next: revision-checked ratings/completions and other
write paths, coordinate effective authorization mutations (private rules/media,
mapping, allowlist, catalog/content), integrate the real app/outbox and preserve
pending records and stable IDs on denial; verify real Supabase privileges and
API behavior. F3 separately owns enrollment and mode/disabled lifecycle.
F4/F7, 3E/F6, 3F, U4B2C and U4B2D remain. No deployment, live permission
changes, user invitations, device data clearing, or release authorization.
