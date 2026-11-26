# U4B2B-3D — reliable quiz saving (F1)

## Checkpoint and scope

The correction handoff reviewed `main` at
`55625b2c9cdace9215b7d4cbcba1bcfeda4e68b3`, the merge of
[PR #102](https://github.com/Celeritas7/KG_chart_new/pull/102).
The implementation preflight found the same current `main`. U4B2B-3C remains
the latest completed ownership phase **within its isolated fixture scope**.
The review itself did not change application code or production.

The open pull requests at preflight were
[older offline preview #46](https://github.com/Celeritas7/KG_chart_new/pull/46)
and [draft C4C release preparation #74](https://github.com/Celeritas7/KG_chart_new/pull/74).
Neither contains this correction. They are separate work and are not modified,
merged, or treated as release approval by this increment.

This first bounded 3D increment addresses **F1: word and sentence quiz saving**.
F2–F7 remain tracked below; completing F1 does not complete 3D or authorize
restricted friend access. The source conditions for F1–F6 were still present
at the implementation base. The lockfile still contained the F7 package
versions recorded by the handoff; a fresh advisory assessment belongs to the
separate dependency correction.

Repository guidance reviewed: `README.md`, the U4A/U4B1/U4B2 documents, and the
U4B2B ownership/revision documents through 3C. There is no checked-in
`AGENTS.md` at this base. Some older README roadmap links have no tracked
target; the handoff's sequence below is retained explicitly here.

## F1 defect and required recovery contract

At the reviewed base, both `persistSession` callbacks in `index.html` mark a
session saved after a returned session error or a failed answer fallback.
The in-flight reference is not released, preventing another attempt for that
run. Word-session compatibility retries also run for arbitrary errors, without
a stable session ID. Sentence-answer fallback can remove the required
`sentence_id`. These conditions must not be treated as success.

The correction must satisfy these boundaries:

- Confirm the required session and answer writes before showing a successful
  result or running the saved-session/progress/level callbacks.
- Retain an accurate pending or denied state with an explicit retry route.
  Persist recovery data under the original owner so leaving and reopening do
  not silently discard work claimed to be retained. A failed local recovery
  write must be reported honestly.
- Keep stable session and answer IDs through retries, reloads, ambiguous
  responses, and repeated clicks. Verify persisted state, including ownership
  and payload, before acknowledging a duplicate.
- Release the in-flight state on failure. A retry checks the current account
  and remains subject to current authorization. Permission denial must retain
  work without changing its owner, bypassing restrictions, or broadening a
  request.
- Use compatibility fallback only for a verified missing optional column.
  Network errors, permission denial and uncertain acknowledgment are not
  evidence of an old schema. Required content identifiers must remain intact.
- Preserve the existing offline transaction/outbox contract. Durable local
  queuing is distinct from server acknowledgment; denied or uncertain queued
  work must not be discarded or reported as uploaded.

### Implementation evidence

`js/kg-quiz-save.js` owns the new immutable save protocol. The UI checkpoints
each answered question in `kg-chart-quiz-recovery-v1:<owner>:<session>` before
attempting network writes. Session/answer UUIDs, original owner, language,
answers, scores and timestamps survive retry and reopening. The recovery copy
stores recorded answers, not a lesson/media snapshot. It is separate from the
existing installed PWA database and outbox. Another account cannot list or
submit that copy through this path.

Both actual quiz components use `useQuizSaving`, `QuizSaveStatus`, and
`QuizRecoveryPanel`. Failed writes show pending or blocked status with explicit
retry and answer-download controls. Reopening Words or Sentences exposes the
corresponding retained runs. Same-page navigation receives a recovery-change
notification even when the original saving component has unmounted. A failed
local-storage write produces a visible warning; the in-memory copy survives
same-page navigation, but closing/reloading cannot be promised safe in that
case. A before-unload warning and a JSON answer download are provided. That
download is a manual backup; this PR does not introduce a file-import UI.

Normal INSERTs remain subject to the current client account and server RLS.
Every awaited write/read is surrounded by owner checks. There is no UPSERT or
privileged bypass. Identical in-flight attempts share one operation; a
different payload reusing its ID cannot borrow its success. Only `23505`
permits exact duplicate readback; mismatch, denial or missing acknowledgment
keeps the recovery copy. A partial existing answer batch is completed with
one atomic insert of the missing subset. Permission errors never trigger
compatibility fallback. Only a precise `PGRST204`/`42703` naming an allowed
optional column can remove that field from the request. Required sentence
and vocabulary associations remain intact.

The UI acknowledges results only after both required writes are confirmed.
Progress refresh, automatic wrong-word rating, and level checks follow that
point. Pending recovery IDs are excluded from this client's displayed level
progress, and pending runs hold its level checks. Level checks also guard
against account changes during their own awaits. Offline acknowledgments say
that results are saved on this device and direct the learner to Settings for
sync status; they do not claim a server upload.

The offline adapter acknowledges exact repeated quiz inserts without adding
outbox events, rejects conflicting rows atomically, and creates owner-scoped
answer-completion markers for new F1 word/sentence sessions. Local and sync
level checks wait for their required answers. Existing history without these
markers retains its previous treatment. Colours' session-only saves are
explicitly excluded. The optional marker metadata survives the existing
recovery export/import, including compatibility with older recovery files.
No pack, historical row, or existing queued event is rewritten or removed.

The first PR CI run passed its behavioral tests and both-editions job, but
eight historical U3D/U4A workflows rejected the new F1 paths under their
earlier phase-only file boundaries. This increment extends those exact lists
for the reviewed F1 files and runs `tools/check-f1-review-scope.mjs` before
each boundary check. That guard requires the learner source outside the
word/sentence save, level, recovery and two specific component-wiring changes
to match the merge base. Negative tests reject changes to authentication,
authorization, flags, navigation, unrelated modes and scripts. Existing
default-OFF assertions, behavior tests, read-only CI permissions and bans on
backend/worker/media changes remain intact. This compatibility correction
does not fix the separate F5 backend path-trigger/ownership-test findings.

**Server boundary remains open:** session and answer inserts are separate
requests. A session may exist on the server while its answers await recovery.
This PR gates the corrected client's callbacks and local level paths; it does
not make both tables one server transaction or prove that another device or
an older client cannot count that partial session. F2 must resolve the
transactional ingestion/revision contract, including server-wide advancement
eligibility, before restricted release. Browser permission simulations are
not proof that the outstanding F2/F3 races or production enforcement are fixed.

### F1 acceptance evidence

The following evidence is from isolated fictional records and disposable
browser profiles. The no-advancement claims apply to the corrected client and
offline runtime; the server boundary above is not closed by these checks.

- [x] Word and sentence session failure leaves a visible pending/denied state;
      no success callback, progress refresh or level advancement runs.
- [x] Word and sentence answer failure, including a compatibility retry
      failure, does not acknowledge the quiz; already written session state
      and all unsaved answers remain recoverable.
- [x] A recoverable failure followed by retry creates exactly one session and
      exactly one copy of each intended answer.
- [x] Session and answer commits whose replies are lost remain idempotent;
      persisted-state assertions cover both cases.
- [x] Repeated/concurrent save attempts do not duplicate rows or run successful
      completion side effects before the required acknowledgments.
- [x] Navigation away and reopening recover pending work under the original
      owner; another account cannot display or submit it as its own work.
- [x] Revocation during saving retains the pending record and blocks denied
      replay. A later authorized retry is tested separately from denial.
- [x] Missing optional-column compatibility is tested separately from network,
      permission, duplicate and malformed-acknowledgment errors.
- [x] Existing offline/unified builds and preservation tests pass; any
      Chromium results are recorded separately from physical-device acceptance.

### Tests actually executed for this increment

| Executed local command | Result and scope |
| --- | --- |
| `npm run check:unified` | Online, offline and unified builds passed; 91 offline tests and 4 artifact tests passed. |
| `npm run test:quiz-saving` | 59 stateful save/recovery tests plus 8 source-scope guard tests passed, including both quiz families and copy/dev/memory typed-word levels. |
| `node --experimental-strip-types --test tools/tests/u2-access-ui.test.mjs tools/tests/u3*.test.mjs tools/tests/u4a-device-acceptance.test.mjs tools/tests/u4b1-restricted-device-preflight.test.mjs` | 152 existing access/media/outbox/device-preflight tests passed. |
| `npm run test:quiz-saving-ui` | 13 real Chromium UI scenarios passed against canonical JSX, fictional persistence, blocked service workers and blocked nonlocal requests. |
| `npm run test:browser-migration` | Existing disposable Chromium separate/offline-to-unified update, corrupt-candidate rejection, compatible rollback, media/audio, owner separation and queued-work preservation passed. |
| `node tools/audit-c4a-artifacts.mjs` | `C4A_ARTIFACT_CONTRACT_PASS`; release authorization remains false. |
| `git diff --check` | Passed. |

There are **314 distinct Node tests**, plus the 13 quiz UI scenarios and the
separate existing migration/rollback rehearsal. Focused overlapping reruns
are not added to that total. The local browser is Playwright's pinned
Chromium 141 build 1194 in disposable profiles. CI runs the same browser
scripts in the existing Playwright 1.56.1 container with `--network none`.
The PR description records the actual submitted head and CI result; a local
pass does not establish CI, hosted API, PostgreSQL concurrency, or physical
Android/iPad acceptance. No SQL migration or live database operation is part
of this increment.

## Remaining correction sequence

The handoff findings are work inside the existing roadmap. Use separately
reviewable PRs where needed; do not replace the phase sequence with a new
numbering scheme.

| Order | Existing phase | Bounded work and acceptance required |
| --- | --- | --- |
| 1 | U4B2B-3D | This F1 quiz-save correction and focused behavior/recovery tests. |
| 2 | U4B2B-3D | F5 database-CI trigger coverage and focused ownership-test blind spots. This is the next work item after F1 is reviewed and merged. |
| 3 | U4B2B-3D | F2 coordinated authorization/revision protocol and F3 restricted enrollment/profile lifecycle, split if necessary. |
| 4 | U4B2B-3D | F4 sentence-scope navigation correction; F7 controlled dependency correction in a separate PR before release. |
| 5 | U4B2B-3E | F6 history and progress presentation contract, tested before revoke, after revoke and after regrant. |
| 6 | U4B2B-3F | Combined regression/readiness across saves, permission changes, all corrected paths, offline preservation and rollback. |
| 7 | U4B2C-1 through U4B2C-3 | Isolated Supabase integration, real learner authorization paths and protected-media verification. |
| 8 | U4B2D-1 through U4B2D-3 | Restricted online release preparation, separately approved activation and final acceptance. |

### F5 — database CI dependencies and focused assertions

The path filter in `.github/workflows/kg-u4b2-backend.yml` includes
`tools/tests/u4b2-*`, which omits `u4b2b-revocation-race.py` and
`u4b2b-quiz-lock-prototype.sql`. It also omits consumed prerequisite fixture
and Edge-test inputs.

The follow-up must cover the complete dependency set or choose a suitable
broader trigger. Demonstrate that changes limited to either named race file,
authorization prerequisites, fixture inputs, and Edge-test dependencies
schedule the isolated database job. Keep the existing PostgreSQL 17 workflow
and its synthetic identities/network isolation.

Also strengthen the two review blind spots: give both learners the same valid
language/topic/word permissions when testing foreign answer-parent ownership,
so ownership is the only invalid condition; and assert rating/completion
`UPDATE` results immediately before a later `UPSERT` can mask them. These are
test coverage corrections, not evidence of a demonstrated ownership bypass.

### F2 — transactional permission and revision enforcement

The fixture guards coordinate through the access-profile row, while the
foundation permits direct administrative mutations to grant tables. The U2
draft RPC coordinates its own grant/revision changes but rejects restricted
profiles. The current fixture guards do not compare a client expected
revision. F1 must not be described as resolving this server protocol.

Choose and enforce one transactional protocol across profile mode, language,
topic, feature, private-resource and allowlist mutations as applicable. Every
permitted administrative path must participate, or become unavailable. Verify
the real application mutation path as well as direct bypass attempts with
production-compatible roles/schema in an isolated environment.

Acceptance includes READ COMMITTED statement races, the existing REPEATABLE
READ case, both writer/revoker orderings, final persisted rows and revisions,
expected-revision behavior for stale clients/retries, retained denied work,
unaffected learners, rollback and successful fresh actions after regrant.

### F3 — safe restricted enrollment and profile lifecycle

The current no-profile compatibility path gives an allowlisted user legacy
scope, and administrative policies permit profile deletion. Restricted
profile deletion or allowlist-first enrollment must not expose a temporary
legacy-access window.

Define atomic restricted enrollment and an explicit durable disabled/revoked
state. Test initial enrollment, deletion attempts, disabling, allowlist
removal, regrant, mode transitions and permitted concurrent lifecycle
operations. No intermediate visible state may grant a restricted learner
legacy scope. Preserve established owner and existing legacy-user behavior.

### F4 — verified sentence scope in navigation

`visibleViews`/`chooseView` receive `sentenceAccess`, but the Header's
`onViewChange` check and Progress `onGoQuiz` check omit it. The follow-up must
pass the same verified scope throughout visibility and navigation. Exercise
actual Header clicks for Chart plus `quiz.sentences` and Chart plus
`quiz.speak`, invalid/unverified scope, and unrelated permissions. A visible
Quiz tab must be navigable when permitted without broadening another grant.

### F7 — controlled dependency maintenance

The handoff recorded high-severity advisory entries for `postcss` 8.5.6 and
`ws` 8.19.0. The base lockfile still contains those versions. Refresh the audit
and maintainer advisories at implementation time; the old audit is not a
permanent version recommendation or proof of deployed exploitability.

Use compatible patched versions and a reviewed lockfile/dependency tree.
Assess PostCSS build-time exposure separately from the Supabase realtime `ws`
chain. Resolve or explicitly assess the relevant advisories and retain passing
online/offline/unified builds. Do not perform a broad forced audit fix or
dependency-driven deployment.

### F6 — history/progress preservation in U4B2B-3E

`kg_chart_my_answers` applies current answer/private-content authorization to
old records; the application consumes it for attempts and word strength.
Retained database rows alone therefore do not establish visible progress
preservation. Existing completed-topic unlocks must be assessed separately
from partial progress.

Agree which historical achievements, aggregates and content details remain
visible after each type of revocation while protecting private content. Test
the actual history RPC and Progress UI before revoke, after revoke and after
regrant, including partial-topic progress and an unaffected learner.

## Release and preservation boundaries

No merge, deployment, production Supabase mutation, restriction flag
activation, real learner permission change, website-data clearing or pack
deletion is authorized by this PR. The owner will merge reviewed PRs. Existing
owner access, offline study, downloaded packs, historical progress and
pending outbox work must remain intact.

Restricted friend access stays **NO-GO until U4B2D-3 acceptance and explicit
approved activation**. Source merges, SQL application, flag activation and
granting a real learner access are separate actions. Fixture passing tests
do not establish real Supabase JWT/PostgREST/Storage/Edge or physical-device
acceptance. F2/F3 and the remaining C/D gates remain necessary even when F1
tests pass.

Keep the other recorded work: unified C4C/C4D release/rollback preparation,
C5/C6 physical-device acceptance, U4A/U4B3/U4C physical restricted/offline and
rollback acceptance. Retain the later product backlog of distinct flagged
words, latest-topic quiz default, Devanagari flag prefill, word/compound
classification, component/missing-vocabulary work and sandhi audio. Reconcile
each against current source when scheduling; none is part of F1.

## Source entry points

- [3C fixture scope](U4B2B3C-TOPIC-COMPLETION-OWNERSHIP.md)
- [3B fixture scope](U4B2B3B-VOCABULARY-RATING-OWNERSHIP.md)
- [3A answer association](U4B2B3A-QUIZ-ANSWER-ASSOCIATION.md)
- [Revision prototype](U4B2B2-QUIZ-REVISION-PROTOTYPE.md)
- [Concurrency characterization](U4B2B-CONCURRENT-REVOCATION.md)
- [Isolated backend boundaries](U4B2-ISOLATED-BACKEND-VERIFICATION.md)
- [Database workflow](../.github/workflows/kg-u4b2-backend.yml)
- [Both-editions workflow](../.github/workflows/kg-dual-edition.yml)
- [Application callbacks/navigation/progress](../index.html)
- [Permission foundation](../sql/kg-chart-u1-access-foundation.sql)
- [Draft administration RPC](../sql/kg-chart-u2-access-draft.sql)
- [Content-access helpers](../sql/kg-chart-u3b1-restrictive-content-rls.sql)
- [History RPC](../sql/kg-chart-u3b3b1-legacy-private-write-rpc.sql)
