# KG Chart U2 — Admin Permissions Studio (DRAFT ONLY)

**Base:** merged Stage U1 on main at 3be4f8d07db3001060983f50f6eab6bfd301de84.
**Scope:** Admin editing interface and optional draft-save backend, not permission enforcement.
**Production authorization:** NOT GRANTED. No Supabase production SQL, release, OAuth or installed app modification is performed by this PR.

## What is new

An Admin Studio sidebar item **🛡️ User Permissions** opens an administrator-only screen. It is independent from **Learner Levels**; levels continue controlling Easy, Normal, Hard and Expert.

The admin may select an existing normal learner (operator role) and draft:
- Allowed active **languages**.
- Allowed **topics** translated into each selected language; removing a language also removes its unsaved topic grants.
- Allowed **features** (Chart, Cards, Progress, Words, Sentences, Typing, Speak, Say, Colours, Offline pack) using the U1 catalogue.
- A learner preview of the *proposed restricted view*, intersecting selected languages, translations, globally hidden topics and private-lessons UI exclusions when available.

**The preview is hypothetical.** Current RLS continues to allow approved users to read shared content; this is NOT a guarantee of authorization. Earlier downloaded packs and public audio URLs are NOT made private.

The only save button is **Save permission draft (no activation)**. There is NO Publish, Enforce, Activate or Delete Learner action. User sign-up is a separate allowlist process.

## Files

- kg-chart-admin.html: sidebar and route only, no changes to learner app.
- js/kg-admin-access-core.js: pure validation, preview, deterministic payloads.
- js/kg-admin-access-ui.js: admin draft editor and explicit save call, no direct multi-table writes.
- sql/kg-chart-u2-access-draft.sql: proposed optional database backend (must be reviewed/applied manually).
- tools/tests/u2-access-fixture.sql and u2-access-assertions.sql: synthetic database tests.
- tools/tests/u2-access-ui.test.mjs: UI and pure helper unit tests.
- .github/workflows/kg-u2-admin-permissions.yml: network-disabled PostgreSQL and client tests.

## Prerequisites and graceful failure

The U1 schema is merged in GitHub but its production database installation is a separate, explicitly approved action. The U2 UI reads U1 tables; if they do not exist, it displays an explanatory unavailable message, not a fake success or unrestricted fallback.

The optional U2 SQL builds an RLS-protected access draft audit table and a PostgreSQL RPC that:
1. Uses SECURITY INVOKER, requires a verified administrator role, and is not executable by anonymous users.
2. Accepts drafts for existing operator learners only; admin/reviewer/unknown email is rejected.
3. Checks expected revision, serializes concurrent saves per email, and rejects stale edits.
4. Validates every language, topic translation, and feature grant against authoritative catalogues.
5. Replaces the selected grants and adds an audit revision atomically, or rolls back all changes on error.
6. ALWAYS saves profiles in **legacy** mode. Existing restricted profiles cannot be changed by U2.
7. Returns an explicit applied_to_learners=false status. Empty selections are allowed as DRAFTS ONLY.

No active permission profile is generated automatically. Existing user roles, ratings, learning history, saved topic unlocks, OAuth, service-worker data and offline packs are untouched. Future U3 must implement server-level enforcement and a separately approved publication flow before any restriction is effective.

## Validation

The U2 CI job uses fictional PostgreSQL 17 data, running with Docker --network none. It applies U1 and U2 schemas, repeats U2 to detect idempotence failures, then tests non-admin denial, revisions, safe atomic replacement, audit and invalid grant rejection. Synthetic admin edits are rolled back. Separate Node tests verify UI wiring, no automatic writes, topic translation checks and preview filtering.

The existing full KG Chart dual-edition CI must also stay green, including 75 offline tests, 4 unified artifact tests and isolated Chromium service-worker migration/rollback. These tests do not verify real mobile hardware, Google OAuth or production RLS rollout.

## Handoff

- **U3:** Safe verified-session permission resolution; read/write RLS and RPC enforcement; audited publishing/revocation; feature and topic filtering in online UI, quiz paths and pack access. Public media and existing offline copies require a separate privacy design.
- **U4:** Android/iPad real-user acceptance, online/offline permission refresh, previously downloaded packs, unsent progress and rollback tests.

**Strict protection:** Do not merge/deploy the PR, apply U1/U2 SQL to Technical Supabase, modify existing production policies, touch Cloudflare/OAuth, change downloaded packs or clear browser/site storage without the owner's separate explicit approval. Stage C4C PR #74 remains unrelated and its source-pinned release artifacts must not be modified.
