# KG Chart U3A — verified-session permission snapshot and enforcement audit

**Status:** U3A implementation in an isolated draft PR. NO production release or effective access restrictions.
**Repository:** Celeritas7/KG_chart_new
**Baseline main:** c24fa1aa14c679ead23b589307513323be62bf3f (merged U2 PR #76).
**U1/U2 production state, read-only:** Neither the five U1 permission tables nor the U2 audit table/save RPC are installed in Technical Supabase as of the initial U3 audit. Merging GitHub source did not migrate Supabase.
**U3A deliverable:** read-only RPC, exact identity binding, synthetic RLS/response tests and a mapped U3B/U3C/U3D rollout plan.
**Verdict:** U3 permissions are NOT currently enforced; no user can be safely switched to restricted mode yet.

## 1. Required U3 work split

| Substage | Deliverable | Current status |
| --- | --- | --- |
| U3A | Authenticated read-only permission snapshot, security inventory, tests | This PR |
| U3B | Enforce language/topic/feature scope on relevant tables, RPCs, and sensitive data endpoints; publish/revoke protocol | Pending separate PR |
| U3C | Bind online learner navigation, quiz modes and all data loaders to verified enforced scope; empty/error states | Pending separate PR |
| U3D | Enforce live download/sync policy, handle already-downloaded packs safely, rollback rehearsal and approval | Pending separate PR |
| U4 | Android/iPad installed-app acceptance across multiple users | Not started |

Do not merge a subset and claim user content is secure; U3B, U3C, U3D and explicit deployment approval must pass before a restricted policy can be activated.

## 2. U3A read-only RPC

Source: [sql/kg-chart-u3a-access-snapshot.sql](../sql/kg-chart-u3a-access-snapshot.sql)

Function: public.kg_chart_u3_my_access_snapshot(), no arguments, JSON object result.

**Identity and execution boundaries**
- Requires the verified auth.uid and existing kg_chart_is_allowed() server authorization. It rejects unsigned/missing or unapproved accounts. It does not accept an email, user ID or arbitrary topic name from the client.
- Runs STABLE and SECURITY DEFINER only because the raw U1 access tables have strict admin-only RLS. The function uses a fixed pg_catalog search_path and schema-qualified relations; there are no writes or dynamic SQL.
- EXECUTE is granted to authenticated only and revoked from PUBLIC and anon. It returns **only the caller's** effective policy *selection*, not learner email, UUID, administrator lists, private lesson email lists or raw audit data.
- Server-confirmed admins and reviewers, plus existing normal learners without a profile or with a U2 legacy draft, receive mode legacy. Grants are null in legacy mode (NOT an empty deny list). The draft revision may be displayed but does not activate restrictions.
- A synthetic restricted profile returns explicit language, topic and feature arrays, intersecting only globally active languages, existing translated/unhidden topics, private_lesson exclusions and active feature keys. Empty restricted arrays remain empty.
- Each response includes server_enforced=false, because no source table, RPC, Storage or worker restrictions are implemented in U3A. This is intentionally **not an authorization token** or an invitation to switch the client UI to restricted mode.

**Response examples (fictional)**
- Legacy: {"contract":1,"mode":"legacy","revision":0,"languages":null,"topics":null,"features":null,"server_enforced":false}
- Restricted proposal: {"contract":1,"mode":"restricted","revision":7,"languages":["my"],"topics":[{"language_code":"my","topic_id":"food"}],"features":["chart","quiz.words"],"server_enforced":false}

A U3C client must require a separately reviewed, authenticated and server_enforced=true contract before applying restrictions. Do not treat API failure as legacy / unlimited access for an already restricted learner. Do not store raw private policy rows in publicly accessible browser storage.

## 3. Verified read-only production security inventory

Source evidence: Technical Supabase pg_policies, function definitions, schema columns, bucket metadata; KG Chart main source and offline runtime.

| Source or operation | Present behavior | U3B/U3D action required |
| --- | --- | --- |
| KG allowlist | kg_chart_is_allowed checks verified/confirmed Auth user and kg_chart_users (admin exception) | Preserve this baseline; no client-provided identity |
| kg_chart_languages | allowed_read policy uses kg_chart_is_allowed() | Add scope for published restricted users |
| kg_chart_topics and topic_translations | allowed_read on all topics and translations | Language-specific translated topic grants; do not leak unassigned topics |
| kg_chart_vocabulary and vocabulary_translations | allowed_read on shared vocabulary / all translations | Parent rows limited to granted topics; translations limited by BOTH topic and language |
| kg_chart_sentences | allowed_read on all sentences | Scope language and group/topic semantics (schema inspection required) |
| kg_chart_colour_phrases | read policy uses kg_chart_is_allowed() | Scope by permitted language/topics and referenced noun/colour visibility |
| kg_chart_settings | settings_read uses kg_chart_is_allowed(), including private_lessons JSON | Stop exposing other users' private email lists; offer a safe setting view without breaking existing clients |
| kg_chart_flags | flags_read uses kg_chart_is_allowed(), not reporter-only | Review cross-user flag text/notes and attachments, and restrict learner read |
| kg_chart_quiz_sessions and quiz_answers | Own-user RLS for SELECT, allowed-user inserts | Block writes to denied language/topic/mode while preserving already saved records and old offline outboxes |
| kg_chart_user_ratings / topic_completions | Own-user access with allowed-user write checks | New restricted writes must respect explicit topic/language selection |
| kg_chart_user_levels, topic_unlocks | Existing per-user learning progression | Permission vs unlock must stay separate; don't reset levels |
| kg_chart_my_answers RPC | SECURITY DEFINER, user-scoped, but no per-language permission check | Audit/guard exposed SECURITY DEFINER RPCs |
| kg_chart_check_level_up RPC | SECURITY DEFINER, computes/updates levels for requested language | Authorize p_lang before mutation; no privilege escalation |
| kg_chart_review_langs and reviewer workflows | Separate admin/reviewer authorization | Preserve reviewer role and its editing boundaries |
| kg-pronounce Edge Function | Checks signed-in learner + kg_chart_is_allowed, then calls Azure | Enforce language, word/text ownership, quiz.say selection; protect service-role operations |
| Cloud Storage vocabulary-assets | Verified public=true; public URLs for pictures and generated Azure clips | No confidentiality from UI/RLS alone; separate private-media design + cache migration needed |
| Existing offline packs | Account scoped caches and IndexedDB v1, same-origin worker | Already stored bytes cannot be remotely erased while device is disconnected. Never clear site data to force revocation |

**Crucial PostgreSQL rule:** Existing policy sets are PERMISSIVE. Adding one more permissive SELECT policy with a stronger check would be OR-ed with the existing allowed_read, so unauthorized data would still be returned. U3B must carefully replace existing SELECT policies or add reviewed RESTRICTIVE policies and prove their interaction with admin/editor roles. This must be tested on a disposable database before any production authorization.

**Source-specific caveat:** KG topics are shared rows (not per language); translations identify the language. A restrict-by-language only policy on the shared vocabulary table would not suffice. The policy must enforce relationships across granted translated topics and vocabulary translations. Parent item queries, nested PostgREST joins and language fallback meanings must be tested.

## 4. Safe publication/revocation design (U3B onward)

- U2 currently creates only mode=legacy drafts. Do not add an unguarded mode toggle directly to the U2 checkbox UI.
- Publishing a restricted profile must be an admin-only, explicit, audited, atomic operation after enforcement has been proven at every access path.
- Publish must check an immutable policy revision, full language/topic/feature grant set, rollback readiness and server-enforcement readiness. Fail closed on missing/partial policies or exceptions.
- Admin recovery path must remain available, and existing users without restricted profiles must continue their current access after SQL installation.
- Access revocation takes effect on server for future authorized requests, including mobile sync, new offline pack downloads and APIs. An offline device may still have old bytes and queued changes: preserve the bytes, never falsely promise immediate remote deletion or data secrecy.
- Rejecting an unauthorized queued event must **not** silently drop the event; use an explicit non-destructive error/reconciliation path. Keep existing ratings and completions intact.
- The production deployment plan must include old-PWA compatibility, cross-account media isolation, source-pinned compatible rollback and a no-site-data-clearing rule.
- A historic PUBLIC Storage asset should not be called private after merely creating a policy. Existing public links remain accessible unless the storage and asset URL design is changed with separate approval.

## 5. U3A synthetic tests

Run [U3A CI](../.github/workflows/kg-u3a-access-snapshot.yml), network-disabled disposable PostgreSQL 17 with invented users, after applying U1 schema in CI.

The contract tests cover:
- Repeatable SQL function installation and no learner profile or role changes.
- Anonymous denial; approved authenticated caller gets only their own snapshot; rejected unapproved/unconfirmed/missing session.
- Verified admin and reviewer legacy behavior; legacy draft with grants never activates.
- Restricted simulation with active and inactive languages, translated topics, excluded private names and disabled features. Empty restricted grant sets remain empty.
- No leaked learner email/UUID, and every response clearly declares server_enforced=false.
- No production project data, actual emails, browser profiles, cloud credentials or real downloads are accessed.

**Passing U3A establishes the snapshot contract, not source-table RLS enforcement.** C4C draft PR #74 is independent. U3B/C/D and U4 need their own review, tests and explicit approvals.

## 6. U3A NO-GO / operator instructions

- Don't run any U1/U2/U3A SQL against Technical Supabase without backup, manual review and separate authorization.
- Don't merge/release U3A as a completed permission rollout. Its RPC reads scopes but cannot restrict data; do not set live U1 profiles to restricted.
- Don't modify existing Cloudflare build output, OAuth Site URL, GitHub Pages, PWA identity, IndexedDB, service workers, recovery JSON, downloaded packs or browser storage.
- Don't invite an assumed-private user into KG Chart until content visibility and public assets match their privacy expectations.
- Continue U3B with a source-matched PostgreSQL simulation of legacy and restricted read/write RLS, including direct REST/API bypass tests.
