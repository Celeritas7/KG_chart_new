# U4B2B-3D / F2D3B1 — timed typing and speaking quiz candidate

Base: merged #111, main `f661ef66f9036d98490cf45d1571727b64d4fb4e`.
Previous exact-head isolated PostgreSQL and both-edition workflows passed.

## Scope and design decisions

Inspection of index.html shows three separate timed producers. Typing copy/recall
currently records the number of items finished in session correct_answers, not
the number of mistake-free answers in copy mode; the selected vocabulary ID
denotes a finished word. Restricted typing currently offers words only.
Speaking lines/paragraph stores self-judged per-sentence results and the
number judged correct. Both send time_spent_seconds, and currently use separate
session/answer inserts. Colour practice sends a session summary with no
phrase IDs; do not treat that as verified per-phrase authorization.

This bounded increment introduces a fixture-only timed session+answer RPC.
It accepts explicit owner-bound stable session/answer IDs, original timestamps
and duration; the future client must seal and persist those fields before
sending. It preserves copy completion versus accuracy, validates recall
completion and speaking score, checks each word or verified sentence group,
and requires the exact current revision under the shared authorization and
profile locks. Session and all answers commit or roll back together. Exact
retries (including reordered answer arrays) are allowed only within current
scope. No answer or timestamp is rewritten. A historical unknown duration or
unverifiable authored field must be reconciled explicitly, not guessed.
This is a candidate contract derived from producer source; tests use fictional
payloads, not a live app or the actual timed client code. No server-side claim
that a learner truly typed or spoke correctly is made.

## Acceptance coverage

All earlier F2A–F2D3A regressions still run before the new step.
The new suite covers typing copy (finished but mistaken), recall, both speaking
types, exact duration and answer replay, independent users, foreign owners,
malformed counts/IDs, ungranted words and unverified/private sentence groups,
direct restricted write denial, explicit stale revision, rollback, historical
missing duration, concurrent retry and revoke-first/regrant. It checks
committed rows as well as responses.

## Boundaries and next

F2D3B is split: B1 is typing/speaking; B2 is colour quiz evidence/summary
contract. B2 must decide how to capture authorized phrase IDs durably rather
than inventing evidence for old summary-only runs. Typing bests, levels,
unlocks, flags and other writes remain later phases. The inherited 500-answer
candidate ceiling is not a release-ready limit and larger real runs must be
handled before client integration. No changes to actual client or outbox,
production SQL, production Supabase, Cloudflare, real permissions, data or
deployment. F2E client integration and real API/device acceptance remain
necessary. Friend access remains NO-GO until U4B2D-3 and approved activation.
