# U4B2B-3D / F2D3B2 — restricted colour quiz evidence

Base: merged PR #112, main `90bc66dd9f060197a01be02e77ac07eb1e59444b`.
Its exact-head [isolated database](https://github.com/Celeritas7/KG_chart_new/actions/runs/45859339084)
and [both-editions](https://github.com/Celeritas7/KG_chart_new/actions/runs/45859339063) workflows passed.

## Existing producer and candidate contract

The three ColourQuizView modes (phrase_to_picture, listen_to_picture,
picture_to_phrase) select a shuffled list of distinct target phrases.
Each question presents up to four distinct options, including the target.
The current producer retains only a score and elapsed time and inserts a
colour_phrase session with topic_id null. It does not persist phrase evidence.
Colour sessions do not contribute to vocabulary strength or unlocking.

For new restricted sessions, the isolated candidate RPC requires the
owner-bound stable session UUID, immutable session fields, explicit mode and
ordered evidence per question (target phrase UUID, selected phrase UUID,
ordered option UUIDs, answered_at). Validate current language, feature and
each option against both component topics, actual same-language vocabulary
translations and private lesson rules. An option may not be omitted from
the authorization checks simply because it was a wrong choice. Verify
the reported score by deriving it from target/selection equality, reject
duplicate targets or options and preserve the ordinary session summary.

The session and private evidence receipt commit together under the shared
authorization gate and current profile revision lock. Exact retries,
including equivalent timestamp offsets, recheck current authorization.
No receipt is exposed directly to an API role. The evidence table retains
IDs without a foreign key to mutable content, and stores no native text.
Order is significant for evidence comparison; the client must preserve it.
Historical summary-only runs remain readable and are never assigned
fabricated phrase evidence, including on a matching session UUID retry.
The receipt is not proof of actual screen presentation, audio playback,
or honest learner interaction; it validates the client's submitted data.

## Validation scope

The appended isolated regression suite exercises three modes, actual
permission and translation checks, malformed/foreign payloads, incorrect
scores, duplicate/omitted options, raw bypass, rollback, immutable retry,
two learners, old summary-only history, concurrent retry and a concurrent
source deletion followed by restoration and topic/feature revocation.
Earlier suites are retained. Test data and payloads are fictional and
derived from reviewed client source; no actual colour UI/outbox integration
has been performed.

## Boundaries and next

The future F2E client must capture the frozen question/option list and
actual chosen answer, seal durable owner-scoped records, bind a current
revision, retain uncertain/denied work, and acknowledge only the validated
receipt. Do not fabricate evidence for old summary-only pending saves.
The existing 500-answer candidate cap and byte limits require review
against actual "all" runs before integration. A shared lock/authorization
implementation and storage retention policy require consolidated production
schema review; account lifecycle, deletion and real API acceptance remain
separate phases. No change to client code, actual data or release flags.

Next: F2D3C — levels/unlocks; remaining writes (including typing bests and
flags), authorization performance, F2E, F3 and the existing release gates
remain pending. No hosted Supabase, deployment, real permissions or
offline pack changes. Friend access remains NO-GO until U4B2D-3 acceptance
and explicitly approved activation.
