# U4B2B-3D / F2D3D3 — account personal preferences

Base: `2df45bc67fe5da55d68159eca8c8fbec378a4b54` (merged #116, both CI workflows passed).
This is an isolated database candidate, not a hosted migration.

## Actual source inventory

- `js/kg-audio.js`: account row `audio_voice` (m/f), `audio_muted`
  (boolean). The local mirror is `kg_chart_audio_prefs`; account-init
  requests can resolve after account changes and the current save sends both
  fields even when only one changed.
- `index.html` TypingView: account `typing_best` map, key
  `lang|copy/recall|words[|topic]` or legacy `lang|mode|sentences`.
  Restricted UI allows words only. Values are {cpm,last,at}. Best CPM
  should be the maximum and last CPM/time should reflect the latest run.
  The current read/merge/upsert can race; its local mirror
  `kg_chart_typing_best` has no account prefix.
- `offline/runtime.js`: prefs are an owner-row outbox type. The existing
  legacy merge uses maximum CPM but can lose the latest run and treats
  the whole audio row as one last-write-wins timestamp. It stamps the
  current owner into queued rows; this does not prove original ownership
  of an unscoped local value. U3D3A/B/C already hold restricted prefs for
  server review, so do not reclassify old queued records in this phase.
- Other audited learner database writes: ratings/completions (F2C),
  word/sentence quizzes (F2D3A), timed/colour quizzes (F2D3B), levels
  (F2D3C), flags (F2D3D1), pronunciation (F2D3D2). Content creation and
  Devanagari overrides are shared editorial writes, not preferences.
  Admin manual topic unlocks, progress resets, level overrides and
  `admin_bypass_lock` are administrative learning-path controls; verify
  actual RLS, revision and audit coverage in F2D3E/3F, not by assigning
  them to a learner preference endpoint. Local-only UI settings, voice
  recordings and downloads are not newly uploaded by this candidate.

## Candidate contract

`kg_chart_f2_my_preferences(revision, owner_id)` and
`kg_chart_f2_patch_preferences(revision, owner_id, event_id, version, patch)`
check actual auth.uid(), confirmed operator, restricted profile and explicit
revision under the shared gate and existing profile lock. The explicit
owner is only a consistency check, never authority. Missing row/version
has baseline 0. Version is private; each accepted event increments it.
The patch contains only supplied audio fields or a bounded set of typing
keys, never arbitrary account/table fields, timestamps or a replacement
map. Audio is account-wide non-content configuration; an approved
restricted profile can change it even when typing is revoked.

Typing keys require current language, feature, topic and private scope
(the same word-only restriction as the current UI). Restricted reads
return only valid, currently permitted typing entries. Revoked, legacy
sentence and malformed historical keys remain stored, not silently deleted
or rewritten. Touching an invalid historical value is held for
reconciliation. An invalid whole historical map is held on read or typing
patch; an audio-only patch does not erase it. The candidate retains
historical best CPM and merges maximum CPM independently of latest
last/at. Equivalent instants compare as timestamps; conflicting last
values at the same instant require reconciliation. No incoming value may
assert a future timestamp beyond five minutes or an out-of-bound CPM;
limits (50 keys per patch, 64 KiB, 0–100000 CPM) are candidate bounds.
These are self-reported practice metrics, not anti-cheat, quiz scores or
unlock evidence.

The profile lock serializes mutations and prevents stale writes. An
exact replay of the same UUID, owner, payload, baseline and revision
returns the original event version plus current version, not stale
values. A changed owner/payload or stale revision/baseline fails closed.
Receipt and version tables are private with RLS and no API grants;
receipts store hashes, not another plaintext typing map. Raw restricted
read/upsert/update is blocked even if a permissive policy exists. Legacy
own-row read/upsert remains modeled; no real privileges are granted.
F3 must coordinate account deletion and transitions (including writes
made in legacy mode), preserve identity/version barriers and decide
receipt retention. The actual historical schema is not inspected here.

## Verification and release boundaries

Append an isolated PostgreSQL regression step after F2D3D2. Cover raw
policy bypass, explicit owner mismatch, invalid/private/foreign typing
keys, field-only updates, maximum/last merge, malformed historical
values, stale/conflicting/replayed events, concurrent same-owner
operations and independent learners, rollback, grant races, revoke and
regrant history preservation and legacy compatibility.

F2E must integrate field-level patches with stable event IDs, explicit
baseline/version and original owner/revision. Separate local mirrors by
account, guard every asynchronous response with owner/generation, retain
unowned historical local data for an explicit reconciliation decision,
never upload it by guessing ownership, and hold old outbox records with
unknown versions instead of silently rebasing them. Reconcile the actual
Supabase schema, grants and API privileges in isolated integration.
No deployed app changes, production migration, activation, device-data
clearing or real preference edits. Restricted friend access remains NO-GO.
Next: F2D3E authorization performance and audit.
