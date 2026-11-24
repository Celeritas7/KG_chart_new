# KG Chart — U3B3B2 Protected Media Delivery Contract

**Starting main:** 659d5fad0f0c6d585e18e8cbbbd5a8125e031fe0 (U3B3B1 PR #81 merged).
**Status:** DRAFT code, opt-in/manual SQL proposal, fake-account tests only. **NOT DEPLOYED.**
**Production prerequisite:** U1 through U3B3B1 SQL schemas/functions remain absent from Technical Supabase despite source merges (read-only verification).
**Absolutely NO change** to the existing public vocabulary-assets bucket, Azure generation, OAuth, Cloudflare, installed Android/iPad packs, IndexedDB or service-worker identity.

## Problem U3B3B2 addresses

U3B3A and U3B3B1 close important private topic/record and legacy privileged-RPC paths. But media remains accessible on public URLs. KG Chart's current audio lookup hashes the **normalized text**, NOT a source record ID, into 32-bit FNV-1a filenames. A clip referenced by Friends' names or Sweet Talk can also be used in ordinary vocabulary. Private/ordinary overlap therefore cannot be resolved simply by deleting any public clip with a hash appearing in private vocabulary.

Previously verified live inventory, **aggregate only**: 2 private Burmese topic rules, 15 private-topic translation rows, 2 text values also used outside private topics. The Storage bucket vocabulary-assets remains **public**. No real learner emails, private words, clips or media copies were placed in this PR.

## What this code adds (candidate only)

### 1. Admin-only registry; no data populated

[sql/kg-chart-u3b3b2-private-media-registry.sql](../sql/kg-chart-u3b3b2-private-media-registry.sql) proposes a new RLS-protected table, kg_chart_private_media_assets.

One row links a **random opaque UUID** to a concrete word-audio, topic-question-audio, sentence-audio, colour-phrase-audio, or vocabulary-image resource. The row includes actual source ID, language, male/female voice when audio, expected source text/image filename, MIME type, classification, state, expected bytes/SHA256, verification timestamp and an independent verification receipt. Row contents are **admin-only**. No new source/content/permission data is inserted automatically.

- Allowed states: staged (default), verified, disabled.
- Classification: unknown (default), shared, private_exclusive. **Only private_exclusive + verified may be signed.**
- A verified row must include SHA256, positive byte length, verification timestamp and receipt. This is a *review contract*, not an automatic verification of actual stored bytes.
- The asset path is never a caller-provided string. After authorization, the signer derives protected/{asset_id}.{extension} from the registry's MIME allowlist.
- The registry enforces source-type/resource-shape, MIME, voice, and uniqueness. It does not expose a generic object-path field.

The SQL **does not create the private bucket**, move files, change Storage policy or public flag, create verified assets, or enable any learner's restricted mode.

### 2. Two authenticated, source-bound SQL functions

- kg_chart_u3b3b2_can_media(asset_id): verified caller identity and KG allowlist, then checks the registry's verified/private-only state and the **current underlying resource**. Word, topic, sentence, colour phrase, and image each require a matching source row and valid language, private lesson and (for restricted accounts) feature/topic grants. A stale source text or changed image filename **invalidates signing**. A guessed/foreign asset ID is never sufficient authorization.
- kg_chart_u3b3b2_my_media_asset(source_type,source_id,topic_id,language,voice): a learner can ask for a protected asset by its normal KG resource ID. Returns only an authorized **opaque UUID**; unauthorized, unknown or unstaged returns NULL. It does not reveal the Storage path, original text, other learners or hashes.

Both functions have fixed pg_catalog search_path, no dynamic SQL, no arbitrary email/user ID parameters, no write side effects, EXECUTE revoked from PUBLIC/anon, and explicitly checked authenticated access. SECURITY DEFINER is used only to read admin-only registry and validated source tables, **not** as unrestricted source access.

### 3. Short-lived private signed URL Edge Function

Files:
- supabase/functions/kg-private-media/core.ts
- supabase/functions/kg-private-media/index.ts

The Edge POST receives only {asset_id}. It requires:
1. Origin in **explicit KG_PRIVATE_MEDIA_ALLOWED_ORIGINS HTTPS allowlist** (no wildcard), and a valid bearer token.
2. Supabase auth.getUser verification and existing kg_chart_is_allowed.
3. Authenticated caller's kg_chart_u3b3b2_can_media(asset_id) returning exactly true.
4. Only after (1)-(3), a service-role lookup of the **same asset ID**, verified state, private-exclusive classification, digest and byte size.
5. A 30-second signed URL for ONLY bucket kg-chart-private-media and the opaque protected/... path. Its URL must match the configured Supabase HTTPS origin, private bucket, exact derived asset path and signed token parameter. Unexpected host, bucket/path or missing token fails closed.

No service role key, raw source text, arbitrary caller path or registry record is returned to the browser. Errors return sanitized codes; successful responses are no-store/no-referrer.

**Important:** The bearer token is checked in code on every POST. If the Supabase Edge gateway needs verify_jwt disabled for unauthenticated OPTIONS preflight, that DOES NOT remove core's explicit auth/allowlist/RPC checks. Verify deployment options separately; no Edge deployment is performed by this PR. A **signed URL remains usable for its 30-second lifetime even after permissions are revoked**. This is not instant revocation; choose authenticated streaming/proxy rather than signed URLs if that guarantee becomes mandatory.

### 4. Resource-context-aware preview client

[js/kg-private-media-client.mjs](../js/kg-private-media-client.mjs) resolves resource type, real UUID/topic ID, language and voice into an authorized opaque asset ID, then obtains and validates its short-lived URL. It explicitly **never falls back to a public URL** if a private resource is denied or has no registry entry.

This adapter is **NOT wired into the current public audio/image players**. No existing media URL, online page, offline pack manifest or source-pinned C4C release is modified. U3C/U3D must integrate all real resources and handle byte-range playback, live permission refresh, signed URL expiration, audio fallback between voices, preloading and pack downloads, with physical device checks.

## Synthetic tests and implementation gates

Dedicated CI workflow: [.github/workflows/kg-u3b3b2-private-delivery.yml](../.github/workflows/kg-u3b3b2-private-delivery.yml).

It executes Node tests for:
- Bearer/allowlist/asset-ID checks and forged path/bucket rejection before service-role access.
- Origin allowlist and no-store controls, 30-second signing, provider URL host/bucket/path validation, unverified/shared asset refusal.
- Resource-bound client resolver, no public URL fallback, malformed responses and wrong project origin.

The network-disabled PostgreSQL 17 test uses only fictional users/words/topics/sentences/colour phrases and the staged U1–U3B3B1 code, applies U3B3B2 twice and validates:
- RLS admin-only registry, no anonymous calls, no automatically populated rows.
- Existing legacy learner excluded from a personal topic even when guessing its asset UUID.
- Permitted learner, admin and future restricted learner with explicit grants; excluded sentence/colour resources without matching feature permissions.
- Source mapping for all five resource types; misspelled source ID, voice, language, stale text/image filename, shared/staged or disabled registration must not sign.
- Existing user rows, quiz history, flags and saved learning data untouched.

A passing test **does not** prove any real private object exists or that a formerly public object has become confidential.

## Future approved rollout, strictly separate from this PR

1. Finish a **read-only, source-complete audit** of private-only vs shared content using the U3B3B1 classifier; verify collisions and source references. Do not publish the real source inventory, hashes or names in GitHub.
2. Prepare and verify durable backups of database, public Storage objects and offline recovery artifacts; review release-source/rollback prerequisites, especially C4C PR #74.
3. With distinct approval, create **kg-chart-private-media** as non-public. Set only the necessary admin/Edge service permissions; NEVER point public media paths at a private bucket without an old-client migration.
4. **Copy, do not move**, reviewed private-exclusive candidates into protected/{random UUID}.{mime extension}. SHA256-verify every byte, record source-to-asset links and verification receipts. Do NOT overwrite, delete, unpublish or turn off public assets during staging.
5. Run actual blocked-public/authorized-signed/private-expiry tests with test identities. Review the old public URL retirement and CDN cache plan separately. Even if public copies are later removed, previously downloaded copies cannot be revoked retroactively.
6. U3C integrates authorized UI selection/denial states; U3D integrates online/offline media manifests, downloads, reconnection and queued progress without clearing site data; U4 tests Android/iPad. Only then consider a separately approved production access-publication sequence.
7. Two pre-existing npm high-severity dependency findings remain unresolved and need release triage.

### Release verdict

**NO-GO for private-media production deployment or restricted-user activation.** This PR supplies a reviewable delivery-security contract and tests only. It does not make the current vocabulary-assets content private. Do not merge/deploy automatically, apply production SQL, create buckets, change Cloudflare/OAuth, move/delete media or downloaded packs, sign out users, unregister service workers, or clear any browser website data without the owner's explicit separate approval.
