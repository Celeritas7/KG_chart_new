# KG Chart — U3B2 Secure Writes and Privileged RPCs

**Status:** Draft PR and synthetic security tests only — NO LIVE ENFORCEMENT.
**Base:** merged U3B1 PR #78, main 4ff49f73e9b7a7178f29b67b4bcfd6b3cc9d1b06.
**Dependencies:** U1, U2, U3A and U3B1 source proposals have merged, but were NOT installed in Technical Supabase as of the starting read-only U3B2 audit.
**User authorization:** No production migration, no deployment, no new restricted learner, no cloud or app settings change.
**C4C unified release:** PR #74 and its frozen source/rollback hashes remain independent and must not be modified.

## Purpose and security boundary

A restricted user's permitted languages/topics/features must control **new writes and privileged server functions**, not just what their interface displays. For approved users with no profile or mode=legacy, maintain the previous experience. Do not delete historical quiz results, ratings, topic completions or cached outbox events. No publication/activation code is added.

U3B2 is a **manual SQL proposal** in sql/kg-chart-u3b2-write-rpc-guards.sql, plus an auth-verified Edge preflight (core.ts). Both must be reviewed as one release dependency. Applying the Edge update before installing the SQL blocks pronunciation calls with a deliberate 503 error, never silently permits bypass.

## Restrictive write policies

The SQL adds 10 AS RESTRICTIVE rules, AND-ed with existing PERMISSIVE policies and existing account ownership checks.

| Write table | Scope |
| --- | --- |
| kg_chart_quiz_sessions INSERT | Verified user + language + topic and exact quiz type → U1 feature |
| kg_chart_quiz_answers INSERT | Parent session belongs to auth.uid, permissible word/sentence in its actual language and topic |
| kg_chart_user_ratings INSERT/UPDATE/DELETE | Vocabulary must be granted for selected language and applicable Chart/Cards/Words/Typing feature |
| kg_chart_topic_completions INSERT/UPDATE | Language and topic granted and Chart or Words feature |
| kg_chart_flags INSERT | Exactly one valid authorized vocabulary/sentence/colour phrase target for restricted user |
| kg_chart_user_levels INSERT/UPDATE | Language must be granted, independent of visible Learner Levels screen |

No existing policies are dropped, no SELECT policy is changed for historical personal data, and the profile publication toggle is absent. A restrictive learner with zero grants cannot create new events. An admin/legacy user retains the old write-path behavior. Each RLS predicate is tested under a real (fictional) authenticated Postgres role.

The quiz type mapping was audited against index.html:
- quiz.words: native_to_image, image_to_native, devanagari_to_image, english_to_native, listen_to_image, listen_to_native, word_builder, type_word
- quiz.sentences: sentence_to_meaning, meaning_to_sentence, build_sentence
- quiz.typing: typing_copy, typing_recall
- quiz.speak: speak_lines, speak_paragraph
- quiz.colours: colour_phrase

Unknown quiz types fail closed for a restricted user; legacy entries remain compatible. Null topic_id on a word quiz means a multi-topic question pool, **not a permission bypass**: the account must have at least one real permitted topic in the requested language, and each answer still checks its actual referenced word. Wrong-answer text and other user-controlled fields are never used as proof of content authority.

## Privileged server functions

U3B2 guards the existing SEC DEFINER functions:
- kg_chart_my_answers(p_lang) retains its original return shape and current user_id filter, but now additionally enforces the parent session and referenced word permissions. Existing historical DB rows remain stored; a restricted user's denied rows are not returned through this privileged endpoint.
- kg_chart_check_level_up(p_lang) preserves the legacy percentage/answer algorithm but does NOT insert/update a denied language for a restricted account. It resolves its target email from verified auth.users via auth.uid instead of trusting a mutable/stale JWT-email claim.

The Edge Function kg-pronounce/core.ts now calls **kg_chart_u3b2_can_pronounce** with the signed-in user's token before Azure processing or service-role writes. For a restricted user, the server function verifies language, quiz.say or speak_lines feature, actual word/sentence ID and native text. A call without a valid referenced ID is rejected for restricted accounts. Legacy accounts retain the prior behavior after the RPC is installed. If the RPC is unavailable or returns an error, the Edge Function fails closed (503) rather than falling back to the general allowlist; this is why SQL and Edge code must be coordinated in any future deployment.

### Remaining limitations — NOT PRODUCTION READY

**U3B2 does not secure all read paths.** Existing U3B1 still allows restricted users to read globally granted sentences without fully filtering private sentence groups. U3B2 blocks NEW private sentence submissions, but the read gap remains for U3B3. Legacy privacy policy on flags and settings, public Storage audio/images, old user-cached media, and other privileged endpoints still need a comprehensive review.

**No completed sync contract:** An installed offline PWA may already have outbox events from before permission revocation. Denied writes must NOT be removed from that queue. U3D must handle pending events, explicit errors, reconciliation and migration/rollback compatibility. Old client versions might generate events for previously permitted topics; do not activate restricted mode before U3C/U3D readiness.

**No real permission publishing:** U2 still writes legacy drafts only. This PR cannot switch any profile to restricted or assign roles. Publishing requires separate guarded policy-version logic, thorough direct API security coverage, device compatibility and explicit owner approval.

**Existing content/rating history:** User-owned SELECT and recorded rows remain unchanged even if a future restricted user cannot create new events for those topics. The scoped my_answers endpoint deliberately does not expose denied word records to restricted users. Do not confuse preserving bytes with immediate revocation of already downloaded information.

**Security-definer and function permissions:** Helpers have fixed pg_catalog search_path, scope identity to auth.uid, do not accept a caller email, execute no dynamic SQL and grant EXECUTE only to authenticated. U3B2 checks existing approval through kg_chart_is_allowed and preserves U1 raw permission-table RLS.

**Other review gates:** audit all existing PRIVILEGED RPCs and Edge Functions for bypass; review pronunciation quota and source text content; confirm no role bypass via service_role; re-evaluate public bucket privacy and CDN caches; resolve two high-severity npm dependency advisories separately.

## Verification strategy

CI workflow [.github/workflows/kg-u3b2-write-guards.yml](../.github/workflows/kg-u3b2-write-guards.yml) uses only synthetic Auth identities and data, a PostgreSQL 17 Docker container with --network none, and a mocked Edge endpoint with no Azure requests.

Test fixtures:
- tools/tests/u3b2-write-fixture.sql: source-matched tables, existing permissive INSERT policies and fabricated historical progress.
- tools/tests/u3b2-write-assertions.sql: direct SQL policy tests with different authorized, restricted, deny-all, admin and unapproved caller sessions; blocked quiz/answer/rating/flag/completion/level writes; old progress still readable; privilege-bypass tests; real answer-history/level-up function behavior; idempotent SQL applied twice and rolled-back test changes.
- tools/tests/u3b2-pronounce-preflight.test.mjs: unauthorized or missing RPC returns 403/503 before Azure or service-role writes, successful authorized request reaches fake Azure and writes one synthetic score, unauthenticated calls fail, and sentence request arguments are passed to the verified server.

This is **not** a production security acceptance test, mobile-device validation, or a reason to merge an unfinished access rollout.

## Implementation sequence / operator GO-NO-GO

- U3B2 review: green synthetic Postgres + Edge tests and existing 75 offline / 4 unified / Chromium regressions. Draft PR for review only.
- U3B3: fix private settings/legacy flags/sentence groups and public media confidentiality contract.
- U3C: connect online UI to verified effective policy, hide disabled controls, fail closed appropriately.
- U3D: offline/sync/pack behavior, outbox protection, old worker versions, rollback, staged release prerequisite checks.
- U4: physical Android and iPad acceptance with distinctly authorized users.
- Production changes are NO-GO until all previous stages are complete, durable backup and exact source revision are verified, and the user separately approves schema, functions, edge, build and rollout.

**Strict instructions:** Do not merge or deploy this PR automatically. Do not run any U1/U2/U3A/U3B1/U3B2 SQL in production without separate authorization. Do not modify Cloudflare production, OAuth Site URL, saved recovery JSON, installed PWA, service worker, IndexedDB, downloaded packs or browser website data. No personal real-user data belongs in test fixtures or logs.
