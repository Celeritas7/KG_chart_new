# KG Chart — U3B1 Restrictive Read-Access Enforcement

**Scope:** isolated design, reviewable proposed SQL and network-disabled fictional-user test suite.
**Starting main:** 4bfad565d78c1a87b0ea45b140b62fbfd24270b1 (U3A PR #77 merged).
**Production:** No U1/U2/U3A tables or functions have been installed in Technical Supabase; GitHub merges do not migrate the database. No SQL from this PR is applied.
**Verdict:** Review only. U3B and effective permission enforcement are NOT complete.

## U3B1 database contract

The manual SQL proposal is [sql/kg-chart-u3b1-restrictive-content-rls.sql](../sql/kg-chart-u3b1-restrictive-content-rls.sql). It adds nine AS RESTRICTIVE SELECT policies AND-ed with existing PERMISSIVE policy results. Existing allowed_read policies remain in place. Simply adding another permissive policy would OR with existing allowlists and would not protect content.

| Source table | Restricted learner read condition |
| --- | --- |
| kg_chart_languages | Granted language must be globally active |
| kg_chart_topics | At least one granted translated topic in an active language, not excluded by private lessons |
| kg_chart_topic_translations | Both language and topic granted for that language; respect private lessons |
| kg_chart_vocabulary | Parent topic must be granted in at least one language |
| kg_chart_vocabulary_translations | Actual vocabulary parent topic and the translation language must both be granted |
| kg_chart_sentences | Language granted and quiz.sentences or quiz.speak feature granted |
| kg_chart_colour_phrases | Language and quiz.colours granted, and both vocabulary components permitted |
| kg_chart_settings | Restricted users can read only safe global keys, not the private_lessons email list |
| kg_chart_flags | Restricted learners cannot enumerate other learners' reports (flags have no reporter owner column) |

A small family of read-only boolean functions uses verified auth.uid, the existing kg_chart_is_allowed server check, and email fetched from actual auth.users; NO user ID or email is supplied by the caller. These functions have fixed pg_catalog search_path, no dynamic SQL, are STABLE SECURITY DEFINER only to read protected U1 permission tables, and grant EXECUTE to authenticated but not PUBLIC/anon.

A missing profile or mode=legacy remains legacy; admins bypass restrictions. All flags/ratings/history, user levels and previously downloaded language packs are untouched. Restricted mode with empty grants gets zero content, not "All." A malformed private_lessons setting fails closed for restricted topic content. U2 stores legacy-only drafts. U3B1 has no publish or activation action.

## U3B1 isolated verification

[CI workflow](../.github/workflows/kg-u3b1-content-rls.yml) uses PostgreSQL 17 with network disabled and invented learners, content and private lessons. It applies the U1 foundation and U3A fictional identity fixture, then adds the U3B1 content fixture and installs U3B1 twice. Tests:
- Verify all 9 restrictive SELECT policies, idempotence and preservation of original permissive policies.
- Add a deliberately overly permissive second SELECT policy in synthetic data, and prove new restrictions still block denied rows.
- Test direct SQL reads and nested joins for approved legacy users, a restricted user with small grants, a restricted user with zero grants, admin, unapproved and unsigned sessions.
- Test language, topic, vocabulary translation, private name, sentence quiz, colour phrase, setting privacy and flag-report gates.
- Ensure no account roles, progress or policy profiles change after synthetic transaction rollback, and anonymous users cannot invoke permission functions.
- Require the existing dual-edition CI to remain green (offline tests, unified artifacts and Chromium migration/rollback).

**Passing U3B1 is not proof of complete permissions.** A new restricted learner must NOT be activated after this PR alone.

## Remaining U3B work / NO-GO dependencies

**U3B2 — Write access and privileged RPCs.** Current quiz-session and answer writes, ratings, completions, flags, level unlocks and some SECURITY DEFINER RPCs do not check the new permissions. Add per-language, per-topic and per-feature checks before allowing a restricted profile. Preserve historical progress and queued outbox items even if future writes are denied.

**U3B3 — Private settings, flags and public media.** For legacy accounts, private_lessons presently hides menu entries only in the UI, while the underlying settings JSON and reports remain accessible to some approved users. Their privacy cannot be claimed solved until a safe settings API and compatibility plan are reviewed. Supabase Storage bucket vocabulary-assets is PUBLIC: previously issued image/audio URLs remain accessible without authentication. Neither U3B1 nor UI filtering makes these bytes private.

**U3C — Online learner interface.** The existing app has no restricted policy awareness. When restricted, it may attempt to fetch blocked records, and the client still expects private_lessons settings. Implement approved navigation, quizzes, safe empty/denied states, and no unchecked fallback to "All."

**U3D — Installed offline PWA.** Downloaded language packs may remain readable offline after server revocation; no solution can remotely erase already-downloaded bytes without connectivity. On reconnect, preserve queued changes and conflict evidence. Respect existing IndexedDB, service worker and shared-image resolver and source-pinned compatible rollback. Do not clear site data.

**Publication gate.** U2 can only save drafts in legacy mode; U3B1 does NOT add an activation switch. Later secure publication must be an explicit admin action using revision checks, an audit trail, server-read/write/edge/media readiness and safe rollback, with separate owner approval. The currently drafted U3A snapshot must continue reporting server_enforced=false.

### Strict restrictions

Do not run U1/U2/U3A/U3B1 SQL in Technical Supabase, publish restricted access, change existing production RLS, update Cloudflare/OAuth, deploy an offline update, sign anyone out, delete packs, unregister workers, clear browser storage or expose private recovery files. C4C source-pinned release PR #74 is separately protected.
