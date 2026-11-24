# KG Chart — U3B3A: private lesson records and flag ownership

**Starting main:** 145ead5f4dc4af26d90f6f3dfe9b8697e897d067 (U3B2 PR #79 merged).
**Scope:** proposed SQL and online/offline client compatibility for PRIVATE RECORDS only.
**Not implemented in production:** no SQL applied to Technical Supabase, no deployment, no bucket privacy change, no learner restriction activated, no PWA storage reset or pack deletion.
**U3B3 status:** U3B3A is only the records substage; **U3B3B media delivery remains outstanding**.

## Source-backed current risks

Read-only Technical Supabase inspection verified:
- U1/U2/U3A/U3B1/U3B2 tables/functions are still **not installed** in production despite merged source PRs. Their manual SQL is an explicit pending release gate.
- The setting private_lessons is a JSON array (two rules at inspection). It contains per-user email allowlists for some topic and sentence-group visibility. Existing learner code reads the entire value directly.
- Existing kg_chart_flags had **96 historical records** and no reporter/owner column. The current permissive SELECT allowed approved users to see reports/notes submitted by others; U3B1 blocked restricted users, but legacy users still could read other reports.
- The vocabulary-assets Storage bucket is **public**, containing 6,755 entries under audio/ and 239 other objects (read-only aggregate). It is not private merely because a topic is hidden. No actual media object paths or personal names were copied into this document.

## What the proposed SQL does (manual review only)

File: [sql/kg-chart-u3b3a-private-records.sql](../sql/kg-chart-u3b3a-private-records.sql)

1. Creates an authenticated-only **kg_chart_my_private_lesson_visibility(p_language)** RPC. The server resolves auth.uid and confirmed email from auth.users, not a caller-supplied identity; it returns only this account's hidden topic IDs and sentence-group identifiers in a {contract:1,topics:[],groups:[]} structure. Raw email allowlists are never returned. Admins receive empty hidden sets.
2. Adds seven **RESTRICTIVE SELECT** policies protecting topic rows, topic translations, vocabulary rows/translations, sentence groups, colour phrases and the raw private_lessons settings row for BOTH legacy and future restricted users. These AND with existing PERMISSIVE policies and cannot be bypassed by an extra permissive SELECT rule.
3. Leaves public/general settings available as before, but only a confirmed KG Chart admin can read the raw private_lessons JSON. The Admin Studio retains its existing administrative editing and preview workflow.
4. Adds nullable kg_chart_flags.reporter_id with a verified-auth insert trigger that overwrites any caller-supplied reporter ID. A flagged word/phrase remains validated by existing U3B2 INSERT restrictions. Old unowned flags are preserved **as-is** (no guessed ownership or deletion) and visible to admins, not other learners.
5. Replaces the previous restrictive flags-read policy with "admin OR reporter_id = auth.uid()" for all learners, including restricted learners. This is an additional permission check layered on top of existing approved-user SELECT policies.

Functions use fixed pg_catalog search_path and no dynamic SQL; helper calls are authenticated-only. The special review RPC is SECURITY DEFINER solely to read the protected settings row on behalf of an already verified user; its entire output is sanitized and has no raw email lists. It does NOT authorize publication of restrictions, create users, change roles, erase historic flags, or alter learner progress.

**Historic flags caveat:** The 96 existing records cannot be safely attributed to a reporter, so they become admin-only after the future coordinated rollout. Admins retain review access, and users can submit new flags normally. There is no inferred ownership backfill.

## Online client change

The main learner's usePrivateLessons hook now calls the caller-scoped RPC instead of fetching the globally readable private_lessons settings row. If the RPC is missing or returns malformed data, private content is not displayed and a non-destructive error is shown. No fallback to the unfiltered public email list is allowed. The Admin Studio remains the separate admin-only place for editing private lesson configuration.

The new RPC must be installed BEFORE deploying updated online/offline clients. Conversely, denying raw private settings before older online clients are updated will break their private-lesson filtering. This is why SQL and client rollout are **not independently deployable**, and old app versions must be accounted for in U3D.

## Offline compatibility and privacy

The new offline pack fetch will NEVER include raw private_lessons email lists. While online, it resolves the current account's hidden topics/groups by the new RPC and caches only an account-scoped per-language snapshot under a new internal cache key. Disconnected installed apps read the account's cached snapshot through the existing local Supabase RPC adapter; connected apps use the current server RPC rather than stale cache.

**Legacy packs are preserved.** If an old pack already includes the raw private_lessons setting, the updated offline adapter can derive the current enrolled user's hidden IDs locally without exposing other email addresses in the RPC response. The existing raw bytes remain in that older pack for rollback and cannot be made secret retroactively. If the pack lacks reliable visibility metadata, the learner gets an explicit safe error and guidance to refresh when connected; no site-data deletion or silent content exposure.

U3D still must prove safe policy refresh, revocation, account switching, hidden content not included in new packs, queued changes preservation, rollback and Android/iPad acceptance. U3B3A is not a standalone offline production release.

## Isolated testing

CI: [.github/workflows/kg-u3b3a-private-records.yml](../.github/workflows/kg-u3b3a-private-records.yml).

In a disposable Docker PostgreSQL 17 database with network disabled and **only fictional users**, tests verify:
- New restricted AND legacy direct SQL reads cannot retrieve private topic/translation/word/sentence or the raw private_lessons email lists even under extra deliberately permissive policies.
- The authorized member and administrator retain intended access.
- New flags are stamped with the verified reporter regardless of spoofed reporter_id; other learners cannot read them. Historic unowned flags remain present for admins.
- RPC cannot be called anonymously or by an unapproved account; malformed privacy data fails closed.
- U1/U2 permission roles and all existing history remain unchanged.
- Node offline tests verify online uses the safe RPC, new pack data has no raw emails, old pack compatibility and fail-closed missing data.

These isolated tests do NOT validate real Auth OAuth state, CDN cache invalidation, public media protection, existing installed iPad/Android apps or Cloudflare production.

## U3B3B — Required separate media security stage

**Current situation: NO-GO for confidential audio/images.** The public vocabulary-assets bucket still serves media by URL without the privacy guarantees of a restricted RLS-protected private bucket. Both the online JS audio catalog and old offline packs use public audio/image URLs.

Before promising confidential media, U3B3B must:
1. Inventory which individual assets are actually private and which are shared with ordinary lessons. Hash-named audio can be reused; do not assume a path belongs exclusively to one private word.
2. Design an **additional private bucket or private namespace**, with authenticated user+language+topic authorization, short-lived signed delivery or a permitted-user proxy. Do not expose a service-role key or sign arbitrary object paths.
3. Adapt manifests and players (male/female clips), pictures, offline pack download and caches to an origin-safe authorization flow without changing existing PWA identity or deleting saved files. Signed URLs expire; downloaded packs require a separate approved offline entitlement/revocation policy.
4. Copy and integrity-verify private assets, run blocked-URL tests for revoked/unauthorized accounts, and prepare a durable backup/rollback. Do not remove, move, overwrite or invalidate current public assets until the user approves an exact action.
5. Explain honestly that once-public URLs, CDN copies and content already downloaded by past users cannot be made retroactively private. A private bucket alone is not proof of complete confidentiality.

U3B3B is a separate reviewable PR and must coordinate with U3C learner UI, U3D offline rollout, U4 physical acceptance, and pending C4C/C4D release safeguards.

### Strict safety gates

Do not merge/release the U3B3A PR or apply SQL without separate review. No Technical Supabase writes, production RLS/Storage changes, Cloudflare/OAuth edits, service-worker uninstall, site-data clearing, pack deletion, logout, or modification of C4C source-pinned artifacts in this phase.
