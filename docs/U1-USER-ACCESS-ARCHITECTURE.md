# KG Chart — U1 individual access architecture

**Scope:** U1 architecture, additive schema proposal and disposable tests only.
**Starting main:** 2894e003e4e036c02ce549f0c572dc78312827a3.
**No production migration or enforcement is authorized.** Stage C4C draft PR #74 is a separate release stream; U1 does not change the existing PWA.

## Why this is separate from Learner Levels

Learner Levels controls Easy / Normal / Hard / Expert independently for each user and language. It does not hide languages, topics or quiz modes. The present KG Chart allowlist permits approved users to read shared content; existing private_lessons filters are only UI rules.

U1 provides a foundation for the admin to decide exactly which languages, translated topics and features a learner sees. U2 creates the admin editor, U3 enforces the stored rules online and at the database API, and U4 validates Android/iPad and offline behavior.

## Verified starting behavior (read-only)

- Technical Supabase has four allowlist users: one admin and three normal learners. Their actual addresses are deliberately not recorded in this document.
- The table public.kg_chart_users has a lowercase-checked unique email, a role limited to admin, operator or reviewer, and the existing kg_chart_is_allowed function gates verified Supabase Auth accounts. U1 never changes these.
- The current admin Levels grid writes kg_chart_user_levels, while topic unlocks are separate. Unlocking is NOT equivalent to permitting access.
- The online learner fetches active kg_chart_languages; currently RLS allows approved learners to read shared topics/vocabulary. The client-side private_lessons setting can hide a topic but cannot provide database confidentiality.
- The offline app has downloaded packs, account-scoped state, revisioned shell and shared image bytes. Previously downloaded media cannot be remotely revoked while a device is disconnected.

## Additive schema proposed for manual review

File: [sql/kg-chart-u1-access-foundation.sql](../sql/kg-chart-u1-access-foundation.sql).

| Table | Key and purpose |
| --- | --- |
| kg_chart_access_profiles | Email references existing kg_chart_users, policy mode legacy or restricted, monotonically increasing revision |
| kg_chart_access_languages | Selected (email, language_code) pairs referencing existing language catalogue |
| kg_chart_access_topics | Selected (email, language_code, topic_id), requiring BOTH a granted language and a real translation for that language |
| kg_chart_access_feature_catalog | Canonical registry of feature keys, families and labels |
| kg_chart_access_features | Selected (email, feature_key) pairs referencing the profile and feature catalogue |

**Five protected tables:** all new tables immediately enable RLS and have a server-verified admin-only policy for read/write, based on the existing kg_chart_is_admin function. No anonymous access; ordinary learners cannot inspect anyone's policy, including their own. Later U3 may expose a safe read-only *effective policy* endpoint tied to auth.uid, never the raw grants table.

**No existing tables or functions are altered. No users or policy profiles are inserted.** The feature catalogue is seeded idempotently and may be reviewed without touching a learner's data. The migration is a manually applied SQL proposal, not an automatically deployed Supabase migration.

### Canonical initial feature keys

| Key | UI scope |
| --- | --- |
| chart | Chart lessons |
| cards | Flashcards |
| progress | Progress screen |
| quiz.words | Words quiz |
| quiz.sentences | Sentences quiz |
| quiz.typing | Typing practice |
| quiz.speak | Speak / listen practice |
| quiz.say | Pronunciation assessment |
| quiz.colours | Colours quiz |
| offline.pack | Download/update offline language pack |

These match existing screen families. An option's visibility does not create content or make Azure or Supabase services work offline.

## Effective policy semantics for later U3

1. **Verify identity and allowlist first.** An email not approved in kg_chart_users cannot sign in to study. Use the verified auth.uid and its trusted email mapping, never a client-submitted email or mutable user_metadata.
2. **Administrator bypass:** server-confirmed admins retain administrative access and a recovery path after restrictive changes.
3. **Absent profile or mode legacy:** preserve all existing behavior. This is the default for EVERY existing learner. The global active-language rules, existing private_lessons filters, topic progression and user ratings continue unchanged.
4. **Restricted mode:** languages = global active languages intersected with explicit grants. Topics = available translated topics intersected with granted topics, existing private_lessons and learning path. A *permitted* topic may still appear locked; a denied topic must not be returned by protected APIs.
5. **Features are an explicit allowlist.** Quiz navigation is present only when at least one quiz mode is permitted; denied modes and their APIs must not accept hidden requests.
6. **Empty grants in restricted mode mean no access**, never "all." An unknown feature or failed policy lookup must fail closed for restricted users rather than silently falling back to legacy.
7. **Do not change progress:** visibility changes cannot reset user levels, ratings, history, topic unlocks, sessions, outbox, offline packs or unrelated people's records.

A profile can be created in **legacy** mode with future grants drafted; that MUST NOT change the current learner experience. A later restricted publication must atomically replace the complete grant sets and bump the revision to support cache invalidation. U2/U3 should add an audit trail showing who approved a policy change. U1 does not include any active writer or automatic revision trigger.

Examples: A current learner with no profile sees the same app as before. A draft with Burmese/Japanese grants but legacy mode is also unchanged. A later explicitly published restricted learner with only Burmese, Food and Colours, and Chart + Words Quiz can see only those approved options, subject to existing locks. A restricted account with no grants sees a clear "No learning access assigned" state.

## Database and offline security constraints for U3/U4

- **U1 is NOT access enforcement.** Existing shared-content RLS policies remain unchanged; authorized learner accounts can still query shared content. UI hiding alone cannot protect private names or other learning content.
- User-level permission rules must eventually be applied to all relevant RLS queries, backend RPCs, quiz sessions, lessons, ratings, read endpoints and pack-download APIs. Do not deploy a permissive SECURITY DEFINER workaround.
- Friends' names currently uses an interface-level private_lessons filter. Published audio/images in the public Storage bucket remain fetchable by URL; protecting content requires a separate private-media design. Do not claim confidentiality until it is actually enforced.
- Already-downloaded offline packs cannot be erased remotely during an offline period. On reconnection, disallow unauthorized new downloads/API access, refresh the policy revision, and hide newly denied areas without deleting existing data or queued work. State this limitation transparently.
- Existing account isolation, shared image resolver, same-origin PWA identity, IndexedDB v1, shell revisions and the C4C compatible rollback must remain intact. No browser cache clearing, service worker unregistration, sign-out, forced re-enrollment or pack deletion.
- U3 must not infer access from UI-only settings or override Admin Studio topic unlocks. Keep ability to revert to legacy behavior if any policy enforcement fails during acceptance.

## U1 disposable validation

CI workflow: [.github/workflows/kg-u1-access-foundation.yml](../.github/workflows/kg-u1-access-foundation.yml).

PostgreSQL 17 runs in Docker with --network none. The workflow creates three fictional allowlist users, two languages and example topics; applies the U1 SQL twice; and asserts:

- Existing fictional user/role counts remain identical and no profiles are automatically created.
- All five access tables have RLS and no anon table read permissions.
- A normal authenticated user cannot read the policy catalogue or write a profile.
- An authenticated administrator can draft a legacy profile with valid language, topic and feature grants.
- Missing allowlist user, missing language grant, untranslated topic or unknown feature is rejected.
- Initial catalogue contains exactly ten keys and is idempotent.
- Every synthetic administrative draft is rolled back after verification.

These tests do NOT access actual Supabase Technical, Google OAuth, Cloudflare, browser profiles or learner data. A passing test is schema evidence, not a production migration or authorization review.

## Remaining planned steps

**U1 (current PR):** schema proposal, architecture contract and isolated PostgreSQL tests. Draft and review only.

**U2:** Admin Studio user-permission controls, policy preview and safe draft management, with no automatic active restrictions. Require atomic publication and a per-user change history.

**U3:** verified-session authorization, proper database RLS/RPC enforcement, online UI and API filtering, safe permission changes/rollback, public media privacy and compatibility with existing private lessons. Requires separate explicit production approval.

**U4:** physical online + offline tests across distinct learner accounts, Android/iPad, revocation/reconnect, packs, queued work and no destructive resets.

### Strict protections

Do not merge U1, apply its SQL to production Technical Supabase, deploy Cloudflare/GitHub Pages, change existing RLS/OAuth, modify C4C release artifacts, touch Android/iPad, uninstall apps or clear any saved packs without separate explicit approval.
