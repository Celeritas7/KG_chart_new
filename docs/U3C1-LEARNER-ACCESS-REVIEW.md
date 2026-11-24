# KG Chart U3C1 — Learner-scoped languages, topics and practice navigation

**Starting main:** \`0430184910c0f7c7699cc090f0f2793a11b204f9\` (U3B3B2 PR #82 merged).
**Current scope:** U3C1 — staged learner interface and pure policy contract, **not active enforcement**.
**Release gate:** \`U3C1_SCOPED_UI_ENABLED = false\` in canonical \`index.html\`. It is a source-controlled, default-OFF flag. Merging this PR cannot activate learner restrictions or require missing SQL.
**Production prerequisite still missing:** The U1–U3B3B2 schema/functions exist as merged files in GitHub but remain **uninstalled in Technical Supabase**. U3A currently returns \`server_enforced:false\`; it cannot truthfully authorize restricted views.
**No app deployment or data mutation:** No Supabase SQL, Edge release, Storage change, old offline pack deletion, IndexedDB migration, sign-out, OAuth modification or Cloudflare operation is part of this PR.

## Why U3C is staged

When enabled *later*, the learner interface must display only allowed **languages**, **translated topics**, **study navigation** and **quiz modes** set in U2 by the administrator. A prior localStorage value must not reopen a revoked topic or mode. U3A's verified-session snapshot must resolve the policy from the signed-in account, not a user-supplied email. The browser is not the security boundary: database RLS, restricted write/RPC checks and media authorization must already be active first.

**Critical compatibility:** Installed iPad/Android PWAs have previously downloaded lessons and account-scoped outboxes. U3D has not yet defined the offline verified policy cache, reconnect/revocation, or permission change handling. Enabling the new RPC gate now would block those offline users. For this reason U3C1's new paths are implemented but remain OFF, returning a single immutable legacy UI policy with no additional network request. The old app behavior and offline pack identities are preserved.

## Source changes

1. **\`js/kg-learner-access.js\`**: pure, testable policy parser for U3A \`kg_chart_u3_my_access_snapshot()\`. It checks contract version, mode, revision, whether restrictions are confirmed enforced server-side, language/topic/feature array formats and scope consistency. Invalid/missing/unverified snapshots are **blocked**, not silently interpreted as legacy. The only unrestricted representation is an explicit, valid \`mode:legacy\` snapshot.
2. **\`index.html\` — gated \`useLearnerAccess\` hook**: when the release gate is eventually enabled, retrieves the caller's own verified policy from Supabase with NO email or user ID arguments, refreshes on focus/online/account change, and invalidates old async responses. Missing RPC or \`mode:restricted, server_enforced:false\` displays a non-destructive error instead of exposing content.
3. **Authorized language/topic/word lists**: filter active language selector and per-language translated topics before Chart/Cards/Quiz/Progress. Vocabulary and study-path data consume filtered topics. Topic and vocabulary loaders are scoped to both account ID and language, and clear/hide old arrays during rapid switches rather than momentarily rendering text from another account.
4. **Navigation and mode toggles**: hide denied Chart, Cards, Progress and Quiz navigation. Six quiz-mode buttons are filtered to allowed features, and the current mode is always a member of that list. A stale mode saved in \`kg_chart_quiz_mode\` is corrected; a denied mode is not rendered while React state updates.
5. **Saved study preferences**: language, active view and topic must be permitted before being shown or persisted. If the administrator changes grants, the UI selects a safe visible language/view/topic without clearing bookmarks, ratings, quiz history, unsent outbox, media caches or packs. Empty grants show an explicit \`No learning access assigned\` state.
6. **Nested navigation and typing shortcuts**: a locked-topic \`Go to Quiz\` shortcut is not shown when Quiz is denied, and Friends' names \`Practise names\` is hidden without Typing permission. Typing cannot reopen a saved unassigned topic or a restricted sentence-source shortcut.
7. **Risky sentence groups**: \`kg_chart_sentences\` and speaking sessions have language and group fields but no complete per-topic authorization relation. Restricted learners must NOT be shown the \`sentences\` or \`speak\` practice modes until a later verified group→topic contract is available, even when those feature keys appear as requested U2 draft grants. Existing legacy users retain these modes. This is intentional fail-closed behavior, not a claim that these features are already ready for restricted learners.
8. **\`tools/build-offline.mjs\`**: packages the *same* policy parser from canonical online source into the independent offline and unified candidate shells, without touching installation ID, cache prefix, IndexedDB schema or worker update protocol.
9. **\`tools/tests/u3c1-learner-permissions.test.mjs\`**: deterministic legacy/restricted/no-grant/invalid/unverified policy tests and source-contract checks for caller-scoped RPC, stale preferences, feature buttons, cache preservation and no unsafe sentence typing.

## Current behavior, with the release flag OFF

- The app uses the legacy full-language/full-feature interface exactly as before and **does not call the new U3A access snapshot RPC**.
- This avoids making a live app dependent on U1–U3B3B2 SQL before it exists.
- No new learner permissions are enforced; do not mistake filtered tests for a production authorization rollout.
- Private lesson filtering from the previously merged U3B3A client has its *own* SQL prerequisite and remains a separate coordinated-deployment risk; this PR does not remove that code or claim it is active in production.

## Future release flag activation: strict NO-GO until U3D

Changing \`U3C1_SCOPED_UI_ENABLED\` to true is a **separate explicit release PR**, not an Admin Studio toggle. It must follow:
1. Verified Technical database backup, storage inventory, Cloudflare/source-pinned rollback and review of previously merged U1–U3B3B2 SQL sequence. Production SQL cannot be inferred from a GitHub merge.
2. Actual source/RPC RLS enforcement, private lesson record protections, correct media delivery for private-only assets and public URL handling, with verified \`server_enforced:true\` contract published **only when justified**. U3A currently says \`false\`, so a restricted learner remains blocked.
3. U3D offline identity-bound cached policy and permission refresh, safe outbox handling, Android/iPad cold-start/reconnect, account switching and same-origin worker rollback tests. Never clear website data to force an update.
4. U3C2 topic relationship and protected media integration (especially sentence/speak and exact media resource IDs) before exposing those modes to restricted learners. U2 currently saves *legacy-only drafts*; policy publication still needs an approved and audited admin action.
5. U4 actual device acceptance and a separate explicit owner production approval before any restricted user is switched on.

### Security limitations

- A browser-only filter does not replace server RLS. Even once enabled, the UI must not be called secure until all referenced data and service endpoints enforce the same rights.
- Current vocabulary-assets Storage remains public. The U3B3B2 signer and registry are staged, not installed, and the current media player still fetches public URLs. No previously public/cached byte can be retroactively made confidential.
- The existing two high-severity \`npm ci\` advisories remain unresolved, separate from U3C.
- The stage must remain **unmerged/unreleased for review** until the user explicitly approves PR merging and eventually production readiness.

## Verification

[U3C1 CI](../.github/workflows/kg-u3c1-learner-access.yml) tests the pure parser, UI wiring and source-only change guard. The standard full KG Chart CI must remain green for online/offline/unified source, 81 offline tests, 4 unified artifact tests and the isolated Chromium migration/rollback, with no account data accessed.

**Status for owner:** U3C1 implementation proposal may be reviewed safely; the actual restricted learner UI remains inactive until U3C2/U3D/server enforcement and explicit approval. No user is added or restricted automatically.
