# Stage C4A — Unified KG Chart production migration readiness (read-only)

**Assessment date:** 2026-11-22 (JST)  
**Repository:** `Celeritas7/KG_chart_new`  
**Last audited `main`:** `61aa70b686ce6858547db766c3dcefe9095de67d` (Stage C3C PR #72 merged)  
**Verdict: NO-GO for C4 production switching.** This review documents evidence and gaps, **not authorization to merge/deploy**, change Cloudflare or Supabase, sign in on a new origin, update an installed app, delete stored packs, or clear website data.

## 1. Provenance and evidence classes

- **Direct source inspection:** `index.html`, `tools/build-offline.mjs`, `offline/runtime.js`, `offline/sw.js`, `offline/pictures.js`, `offline/manifest.webmanifest`, `.github/workflows/kg-dual-edition.yml`, and C1/C3/C3B/C3C reports at `main`.
- **Read-only GitHub API:** Merged PR #72 at `61aa70b686ce...`; GitHub Action `45021170051` build-and-test **passed**, and archived all three edition artifacts (listed below).
- **Read-only Supabase connector:** Technical project `ulgrfumbwjovbjzjiems` exists, status **ACTIVE_HEALTHY**, API URL `https://ulgrfumbwjovbjzjiems.supabase.co`. Source `SUPABASE_URL` matches. No SQL, Auth configuration change, or production user-data access performed.
- **Earlier user-provided Cloudflare dashboard evidence:** `kg-chart-offline` project, Git source `Celeritas7/KG_chart_new`, production branch `main`, root folder blank (repository root), command `git submodule update --init --recursive && npm ci && npm run check:both`, output `dist-offline`; build cache disabled. No custom redirects or headers appeared in the reviewed deployment panels. A deployment of `2b7775aef5ac` returned JSON `edition:"separate-offline"`, `schemaVersion:1` in a **clean Incognito** browser at a versioned Pages URL. These are **historical observations**, not a direct read of **current** Cloudflare dashboard settings or live production `offline-build.json` after PR #72.
- **Unverified:** Actual Supabase Auth Site URL/redirect allowlist, Google provider settings, current production Pages deployment's served revision and headers, any custom domain, precise Node build environment, freshly captured Android state, iPad state, and full-media rollback under real storage pressure. Neither GitHub CI nor a Cloudflare *preview* establishes any of these.

Do not record private email, owner ID, session, recovery-export JSON, API keys, OAuth secrets, or actual quiz rows in a public PR.

## 2. Deployment and origin inventory

| Item | Current known state | C4 requirement |
| --- | --- | --- |
| Original online | Separate GitHub Pages origin, built as `dist-online/` | **Keep running.** No redirect or retirement in C4. |
| Existing installed offline | `https://kg-chart-offline.pages.dev/`; source builds `dist-offline/` | Preserve **the exact origin**, path/scope and existing Home Screen installation. |
| Proposed unified | `npm run build:unified` -> `dist-unified/`; `edition:"unified"` | Switch the **existing Pages production origin only after approval**, not preview/custom/GitHub Pages origin. |
| Cloudflare production project | Screenshot: `kg-chart-offline`, branch `main` | Reconfirm production project, branch, root, build command, output and active deployment **in dashboard read-only** just before C4. |
| Cloudflare current build | Screenshot: `git submodule update --init --recursive && npm ci && npm run check:both`; `dist-offline` | *Proposed*, **not executed:** `git submodule update --init --recursive && npm ci && npm run check:unified` with output `dist-unified`. Review precise command/output before changing. |
| Preview deployments | Cloudflare GitHub App automatically creates separate PR previews | Preview subdomains have their own origin storage; **never test migration by treating them as your existing installed Android app**. |
| Cloudflare redirects/headers | Earlier deployment tabs showed no active custom rules | Re-check full live response for `/`, `/index.html`, `/sw.js`, `/offline-build.json` and cache-control on a disposable profile; earlier preview JSON navigation anomaly is not yet fully explained. |

**No-go if:** requested migration would move to a new HTTPS origin, modify PWA `id`/`scope`, change the production Auth allowlist without approval, or erase browser data.

## 3. PWA, data-layout and authentication contract

- `offline/manifest.webmanifest`: `id: "/kg-chart-offline"`, `start_url:"./"`, `scope:"./"`, `display:"standalone"`. The unified generator changes display name/version, **not identity or scope**.
- `offline/runtime.js`: `indexedDB.open("kg-chart-offline-v1", 1)`, existing `kv` and `outbox`; account-scoped `active:<owner>:<language>`, `pack:<id>`, `active-caches:<owner>`, enrollment, progress and queued events.
- The unified and separate builds include the same runtime, picture resolver and install source; `kg-offline-pictures-v1-<owner>` holds shared image bytes, with legacy raw-picture entries still readable. `offline/sw.js` uses `kg-offline-shell-<revision>` and retains previous complete shells while removing a failed **new** shell candidate only.
- The offline build wraps the canonical client with `storageKey:'kg-chart-offline-auth'`, `flowType:'pkce'`, `detectSessionInUrl:true`, and `autoRefreshToken:false`. `offline/runtime.js` supports saved enrollment offline; online sync requires a real verified `auth.getUser()` and `kg_chart_is_allowed` check. This is **code behavior**, not proof of live Auth configuration.
- `index.html` chooses Google `signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin + window.location.pathname}})`. At the existing offline root, the **requested** return would be `https://kg-chart-offline.pages.dev/`; any `/index.html` entry and actual existing provider return URL must also be reviewed. **Do not assume** those URLs are currently allowlisted.
- Supabase **Technical** project is active; this tool connection does **not expose** the GoTrue Site URL, Additional Redirect URLs, Google provider settings or Google Cloud authorized callback list. Those settings are **UNVERIFIED**, not passed. Inspect **Authentication -> URL Configuration** and **Authentication -> Providers -> Google** in the correct project **read-only**, noting redirect URL *names only* and omitting credentials. Separate Google Cloud OAuth callback verification may require the authorized administrator.
- A recovery JSON exported from the offline app includes account-bound personal tables/outbox; it does **not include downloaded pack/media/cache bytes**. It cannot be considered a complete restore of ~85.9 MB offline downloads.

## 4. Exact source-matched reference artifacts (NOT authorized release)

GitHub Actions `KG Chart - both editions`, successful run:  
`https://github.com/Celeritas7/KG_chart_new/actions/runs/45021170051`

Source commit for **all three** artifacts: `61aa70b686ce6858547db766c3dcefe9095de67d`. Derived separate-offline app/worker revision: `61aa70b686ce`; derived unified revision: `61aa70b686ce-unified`.

| Edition | GitHub artifact name | Artifact ZIP SHA-256 digest | ZIP size |
| --- | --- | --- | ---: |
| Existing online reference | `kg-chart-online-61aa70b686ce6858547db766c3dcefe9095de67d` | `79f77ab5557327afb19557829787bbf794db1f96c5ff9ee28a6005ecef2965de` | 584,877 bytes |
| Compatible separate-offline rollback candidate | `kg-chart-offline-61aa70b686ce6858547db766c3dcefe9095de67d` | `ec0466abf2af30baec9e29c6d8a3c00a29c0b198f99b8be6c69322511ea27f49` | 11,108,562 bytes |
| Unified release *candidate* | `kg-chart-unified-61aa70b686ce6858547db766c3dcefe9095de67d` | `d7a6ec1d45595cd3b0fbb967a7ee6dab7527431c9dd45e4adce33bc2901f0b67` | 11,108,583 bytes |

These hashes are the **GitHub artifact ZIP archive digests reported by GitHub API**, **not individual packaged file digests**. Individual files are checked against each edition's `shell-manifest.json`. Artifacts expire **2026-12-06 12:14 UTC** (about 14 days after creation). **NO-GO if an approved release/rollback artifact cannot be retained immutably beyond CI retention**.

The eventual authorized C4 switch must pin an **exact reviewed commit** and rebuilt artifact pair at that commit (not choose an unreviewed moving `main`). Do not confuse the C4A documentation branch SHA with the reference `main` artifact SHA. The current reference artifacts demonstrate **source-matched compatibility only**, not production-release approval or validation of installed real packs.

## 5. Read-only artifact verification

After `npm run check:unified` has built disposable outputs in CI, run `node tools/audit-c4a-artifacts.mjs`. The script **reads only** `dist-offline/` and `dist-unified/`; it never performs network, filesystem writes, caching or deployment. It checks:

- Manifest `id`/`scope`/`start_url`, origin-independent installation contract, edition/version/schema, and matching base commit revision.
- Presence and SHA-256 hashes for every generated shell dependency in each `shell-manifest.json`.
- Unchanged `kg-chart-offline-v1` schema stores, account cache keys, auth storage key, shared-picture resolver, and same-source compatible rollback worker/runtime/picture/install sources.

CI success is necessary but **not sufficient** for C4. This audit does not access any user's browser profiles or files.

## 6. Device baseline capture (C4 approval preparation; NOT performed in C4A)

The last user-reported Android baseline from early Stage C (not a current device reading) was **three packs / ~85.9 MB**, **zero pending changes**, Burmese Ready offline, Food complete, Vegetables unlocked, 85 missing published-image placeholders, with earlier app+worker revision `fb4907190a52`. Do **not** copy that older revision into a release certificate.

**Before any production switch**, the owner should capture from the **currently installed Android Home Screen app**, without signing out or clearing data:
1. App revision and **active worker** revision, PWA origin/scope; matching versions.
2. Each of the three **actual language names**, pack file counts, total bytes, shell-ready state, image placeholder counts and readiness report. No new packs need to be downloaded simply to capture this.
3. Pending outbox count, latest acknowledged synchronization/error indicator; Food completed/Vegetables unlocked and one offline lesson/audio smoke check. Avoid creating unsynced quiz records during baseline capture.
4. Private **Export recovery** JSON held off-device. Keep it out of public GitHub/PR/Cloudflare logs, and label explicitly as **personal-data-only, no media bytes**.
5. Android OS/browser/PWA installation mode and available storage estimate, without posting private account identifiers.

Do **not** uninstall, unregister the existing service worker, change Supabase accounts, clear cache/site data, reset packs, or delete originals. Do not touch iPad during C4A. The **physical Android and iPad post-release acceptance** belongs to C5/C6 and is not claimed here.

## 7. Compatible rollback and abort plan — approval gate

Rollback candidate must be separately reviewed at the **same committed source revision as the unified candidate**, using `dist-offline/` built with current `offline/pictures.js`, account owner handshake, v1 IndexedDB and shared hash media resolver. **Never use an earlier pre-shared-picture worker**, even if its old shell cache exists. Keep the original GitHub Pages site operating independently.

Before C4: securely retain verified offline and unified artifact copies (archive digest, manifest/file hashes, source SHA, build command), and document precise authorized Cloudflare rollback action to restore `dist-offline` at the **same existing offline origin**. Record which operator can execute it, how the active worker will be verified, and who must approve actions. A Cloudflare dashboard rollback to an arbitrary historical deployment may be incompatible and is **not** automatically safe.

After a regression: **freeze changes**; leave the installed app and all website data intact; collect screenshots and version/readiness/outbox counts, and store private recovery JSON off-device. **Do not** invoke destructive repair, clear caches, unregister workers, sign out, or delete packs. Only apply an explicitly approved compatible rollback and recheck owner-scoped packs and queue. Browser cache/worker activation may be delayed; never force-clear as a shortcut.

## 8. Stage C4 GO/NO-GO checklist

| Gate | Evidence required | C4A status |
| --- | --- | --- |
| C3C real-browser synthetic rehearsal | Green CI for same-origin upgrade, failed install, account/media isolation and compatible rollback | **PASS (synthetic only)** |
| Correct production origin | Same `https://kg-chart-offline.pages.dev/` + PWA identity; no new domain | **PROPOSED, not switched** |
| Cloudflare latest production settings | Read-only screenshot/current active SHA and `offline-build.json` confirming `separate-offline` | **PENDING revalidation** |
| OAuth configuration | Technical Supabase Site URL and redirect allowlist; Google provider callback and actual root/path return | **UNVERIFIED — hard blocker** |
| Exact artifact pair | Approved commit SHA, candidate/rollback ZIP digests, manifests, immutable protected copies | **REFERENCE pair verified; approval/retention pending** |
| Android baseline | Current 3-pack count, names/bytes/readiness, pending count, app+worker, progress, private export | **PENDING; no device access** |
| Real storage and update safety | Recognized ~85.9MB baseline, enough space, non-destructive plan for interrupted update and delayed controller activation | **NOT proved on real device** |
| iPad initial handling | Plan to preserve any existing iPad data and test Safari/Home Screen after an approved switch | **PLANNED; not physically tested** |
| Explicit C4 user authorization | Exact origin, command, output directory, SHA, rollback operator/artifact, go/no-go window | **NOT GRANTED** |

**Decision: NO-GO.** C4A is for documentation and non-destructive verification only. Merging its PR would **not** authorize any production configuration change.

### Separate future release authorization (do not execute during C4A)

A valid C4 deployment instruction must explicitly identify all of:
- **Production target:** `kg-chart-offline.pages.dev` under the existing project, and confirmation that original online GitHub Pages remains available.
- **Pinned source SHA + unified artifact digest**, precise production build command and output `dist-unified`.
- **Pinned compatible separate-offline rollback SHA/digest** and verified restoration procedure.
- **Read-only verified OAuth allowlist and baseline**, accountable operator, and explicit owner approval to proceed.
- **Abort criteria:** any lost pack, auth mismatch, wrong worker, lost queue, missing picture hash support, unusable offline cold reopen or unapproved data reset.

C5 Android and C6 iPad acceptance remain separate phases; do not infer device PASS from CI.
