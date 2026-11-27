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
`onViewChange` check and `LockedTopicPanel`'s `onGoQuiz` check omit it. The follow-up must
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

## F2E1a — restricted online word and sentence integration candidate

Reviewed base: `7753db59c72a90449dcea060ad7a9ea0942ff72f`. The F2D3A endpoint exists in the disposable SQL fixture only. No production endpoint, activation flag, migration, real learner or offline outbox is changed in this increment.

The canonical F1 hook captures local-only permission provenance at quiz start from the owner-matching verified policy. Restricted drafts retain that exact revision across answer checkpoints, sealing, retries and reload. The RPC receives the original v1 envelope (without local-only saveContext) and the captured revision; its receipt must match session ID, answer count and expected revision. No direct table fallback, optional-column omission or duplicate readback is permitted for the restricted route. Missing RPC, denied/stale access, malformed receipt, storage failure, and account changes retain the original draft. The normal legacy F1 and installed offline device queue paths stay unchanged while activation is OFF. Restricted offline-facade requests are held rather than misreported as server saves; F2E3/E4 own that integration. The restricted saved result does not invoke older automatic progress/rating/level consumers; F2E2 owns their conversion.

### F3 lifecycle assumptions and reconciliation gate

* Restricted provenance is immutable; a missing, unverified, legacy-to-restricted, restricted-to-legacy or newer-revision baseline is not inferred or rebased. Existing v1 drafts without provenance are held on the restricted route, with the original download/recovery preserved. A server revision rejection does not authorize a fresh event.
* F3 must provide atomic enrollment, an explicit durable revoked/disabled identity and revision continuity across removal, regrant, email reuse and mode transitions. Until those rules are implemented and verified, a no-profile legacy snapshot is not evidence of a safe historical transition. Legacy compatibility is retained only within the existing activation-off boundary. F3C and F2E3/E4 must settle historical partials, lifecycle reconciliation and queue receipts before activation.
* The fixture accepts 1–500 answers (and its own request-size bound). New restricted runs over 500 require a smaller target; old oversized drafts are held in full, not split or truncated. The server remains authoritative for shape and payload bounds.

### Verification requirements

The existing F1 unit and browser suites now include fictional atomic RPC cases for both actual word/sentence producers, lost response and reload, malformed/device receipt, owner/storage failures, concurrent retries, missing endpoint, stale/unknown revision, mode change, oversized drafts and no direct fallback. Existing fixture SQL tests remain in place. Verify the exact PR head in both-editions and database CI. These tests do not prove real PostgREST, final schema, lifecycle, offline synchronization or physical-device acceptance; no restricted release authorization. Next bounded consumer: F2E1b timed typing and speaking after this phase is reviewed and merged.

## F2E1b — timed typing and speaking integration candidate

Reviewed base: `29018a4f4b07687964a050c8dde44766830e510c` (PR #120 merged, all exact-head checks successful). The F2D3B1 timed RPC remains an isolated SQL candidate. Extend F1 recovery with separate owner-scoped timed storage to preserve rollback compatibility with older F1 readers. Original IDs, answer associations, first-attempt evidence, capture revision and elapsed duration are checkpointed at each recorded answer; final duration and completion timestamp are frozen before network saving. Reopening a partially answered run offers recovery of only the recorded attempts at the last recorded duration, not a fabricated full run or a retry-time duration. For speaking lines only first judgments count; paragraph answers are created only after confirmation. Typing copy completion counts selected IDs, not mistake-free accuracy. The online restricted route invokes only kg_chart_f2_save_timed_quiz, verifies session/count/revision/duration, and retains failures. No direct fallback or rebasing. The existing legacy path uses stable direct inserts with readback and never drops timed evidence columns. Legacy offline queue remains the existing device-save path, not atomic server synchronization; timed completion markers/queue conversion remain F2E3/E4. Restricted offline facade is held.

The actual quiz producers render the local score separately from save acknowledgement. Recovery is available in each mode's setup. New restricted speaking paragraphs above 500 lines cannot start a saved step; restricted typing item lists are bounded and end when exhausted; old oversized records are held. Typing-best legacy behavior stays separate, while restricted preference reads/writes are deferred to F2E2d (no restricted personal-best claims). Existing raw progress and legacy best storage remain later review boundaries. F3 lifecycle assumptions from F2E1a continue to apply.

The existing F1 test commands include new timed unit cases (all four modes) and canonical browser scenarios with fictional RPCs. The historical source guard is extended only to the two reviewed timed producer regions, with negative coverage for unrelated preference, pronunciation and colour paths. No production schema, activation, outbox conversion, device-data clearing or deployment is authorized. Verify exact-head CI; hosted API, final schema, lifecycle and device acceptance remain pending. Next bounded phase: F2E1c colour evidence.

### F2E1b CI fixture correction

The initial both-editions run 46001272788 passed compilation but failed three existing typing-topic component tests because their deliberately isolated JSX harness did not provide the newly required useQuizSaving hook or recovery panel. Update that fixture only, retain all existing topic/legacy-key assertions, and assert the real Start handler selects the correct timed quiz type. Add only this exact test path to the eight historical phase scope lists; retain their other boundaries and tests. The real recovery hook remains exercised by the canonical browser and unit suites. Cloudflare reported a build failure separately; its provider-side detailed log was not available through the GitHub check. Recheck both providers on the corrected head before merge.

## F2E1c — colour quiz evidence integration candidate

Reviewed base: `1c5a93d42ba962765c6c80bb98b6f972f7917f10` (PR #121 merged; all 16 exact-head checks passed after the fixture correction). The F2D3B2 RPC remains fixture-only. The actual ColourQuizView now checkpoints each chosen phrase, the target and the displayed option order, together with the original mode, timestamps, stable session ID, owner and captured permission revision. Colour evidence is stored as ordered question objects in a separate owner-scoped recovery namespace; it is not represented as ordinary quiz-answer rows. The score is derived from the actual IDs; duplicate targets/options and malformed evidence are rejected. Replay freezes evidence, duration and mode, and validates session ID, question count, derived correct count, revision and duration in the receipt. A restricted save never falls back to a direct summary. Unknown historical summary-only requests are not upgraded or assigned invented choices. Permission changes, missing RPC, bad receipts, account changes and storage failures retain work; partial recovery sends only recorded questions. Existing restricted offline requests remain held for F2E3/E4.

Legacy production and the installed offline queue still support only colour session summaries: the existing F1 stable-ID insert/readback route confirms the summary and the UI explicitly identifies summary-only acknowledgement. Actual evidence stays in the recovery draft until that acknowledgement; it is not retroactively uploaded or asserted as stored by the old schema. No ordinary answer rows, level side effects or new offline completion markers are introduced. Colour pending recovery does not gate unrelated word-level checks. New restricted All runs above 500 require a smaller target, and existing oversized drafts are held intact; no truncation or non-atomic splitting.

New unit tests cover all three modes, exact ordered replay, score/count/revision/duration receipt validation, missing evidence, stale access, owner/storage failure, concurrent retries, large runs and legacy/device summary-only behavior. Canonical Chromium scenarios use actual ColourQuizView with fictional phrase data, capture visible target/option identities, verify lost-response recovery and partial recovery. The historical source-scope guard adds only the reviewed colour producer region and preserves negative coverage for unrelated Say It and colour rendering helpers. Existing F1/F2E1b and database tests remain. Verify exact-head CI before merge. No production changes, activation, deployment, real learner permissions or pack/data clearing. Hosted integration, lifecycle, outbox conversion and physical-device acceptance remain pending. Next bounded consumer: F2E2a vocabulary ratings.

## F2E2a — versioned vocabulary ratings integration candidate

Reviewed base: `2f468876dd97a2d89474ee41b371db63b6bdf128` (PR #122 merged, all 16 exact-head checks successful). F2C remains fixture-only; no production migration. The existing shared recovery asset now includes a separate owner/language-scoped rating event store and versioned client. Chart rating callbacks and Cards sort/Undo use the F2C baseline/read/save protocol only for verified restricted scope. A restricted click opens an explicit review of the current server rating and version before confirmation. A stable event ID, original revision, baseline version, prior rating state and new timestamps are durably written before the RPC. The restricted card does not advance optimistically and Undo is bound to the previously acknowledged version and revision. A historical receipt is not treated as the current value: read back the verified baseline and display the latest state before clearing recovery. Deletions use null rating/timestamps and retain the server tombstone version. A stale, denied, malformed or uncertain request remains recoverable; no silent rebasing, direct-write fallback or duplicate generation. Account/language scope changes invalidate old UI requests.

The recovery panel permits exact retry, JSON export and explicit review of the latest server rating. Only after observing a newer version within the original revision may the learner keep that rating and archive the original event locally; a same-version uncertain request or changed-revision event remains held. This is intentionally conservative until F3 settles lifecycle continuity. Multiple distinct word events remain independent; same-word pending records block a fresh event. Cross-tab races are resolved by the server's baseline check rather than overwriting a pending record. Legacy activation-off writes and old offline queues retain their original contract; the restricted offline facade cannot call these RPCs yet. Restricted auto-ratings after quiz completion remain deferred until an explicit rating provenance/advancement contract is available; the F2E2a change does not silently create a new rating from earlier quiz evidence. No changes to completion/reset chronology, difficulty, typing bests, account lifecycle, production schema, production permissions, downloaded packs or outbox conversion.

Focused unit tests exercise version zero, deletion tombstones, ABA, stale baseline/revision, event replay, receipt/readback errors, storage and identity, explicit archive and independent words. Isolated Chromium scenarios exercise the actual rating hook and recovery panel, lost-response reload with a superseding rating, and the actual Cards sort/Undo. The scope guard adds only the reviewed rating hook, Cards component and exact AppContent wiring, with negative checks for unrelated progress and authorization. CI must verify the exact submitted head; hosted Supabase, physical-device and restricted activation remain pending. Next bounded phase: F2E2b topic completion and reset chronology.

## F2E2b — restricted topic completion and reset chronology candidate

Reviewed base: `fdd2582a1247014569577ca035f5325608f645ed` (PR #123 merged, all 16 exact-head checks successful). F2E2b integrates the restricted learning path with a final-fixture server snapshot rather than deriving new completions from legacy history or a client wall clock. The isolated SQL extends F2D3E2 after its existing tests. Newly inserted atomic word and typing-recall sessions receive immutable answer-ID and server-confirmation evidence under the existing authorization/profile lock order. Historical sessions remain intact; their replay does not backfill evidence. A new completion uses only permitted whole confirmed sessions, original session/answer chronology, server receipt timestamps, current rules and the actual reset cutoff. Older or future-dated activity cannot gain eligibility by being uploaded again. The generic F2C timestamp-based completion operation is made internal; public rating operations keep their signature. The dedicated completion endpoint freezes event ID, expected version, revision, reset cutoff and evidence time; it checks the current eligibility under the same locks before committing. Exact replay is historical acknowledgement, not proof of a current unlocked topic.

The restricted learner path reads the verified snapshot, including manual unlocks, completion versions, server rule fields and confirmed counts. It shows a deliberate Confirm completion action for eligible topics, leaving the next topic locked until an exact receipt and current readback. Quiz acknowledgement triggers a scoped path refresh without enabling old automatic rating or difficulty side effects. Uncertain events survive reload in a separate owner/language-scoped recovery namespace. Retry uses the unchanged event; review/explicit archive of obsolete requests preserves the original record. No automatic rebasing on reset or scope change. The activation-off legacy path (including its existing optimistic completion behavior) and old offline outbox are unchanged; they are not covered by the restricted acknowledgement claim. Offline migration, legacy/hosted schema reconciliation, historical eligibility review, account lifecycle and physical-device acceptance remain release prerequisites. No SQL is applied to production and no restricted activation is authorized.

Focused fictional JS unit and canonical Chromium cases cover durable storage, no local unlock before server readback, exact lost-reply replay, reset conflict, archive and scope isolation. The appended isolated PostgreSQL case covers old-versus-fresh evidence, exact replay, reset chronology and independent learner scope. The eight historical scope lists admit only the named final-fixture SQL/test and workflow; no existing test is removed. Next bounded consumer after exact-head CI: F2E2c difficulty and advancement.
