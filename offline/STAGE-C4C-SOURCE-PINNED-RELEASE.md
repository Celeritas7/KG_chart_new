# KG Chart — Stage C4C source-pinned release and compatible rollback

**Assessment date:** 2026-11-22 (JST)
**Repository:** Celeritas7/KG_chart_new
**Starting main:** 2894e003e4e036c02ce549f0c572dc78312827a3 (C4A PR #73 merged)
**C4C outcome target:** isolated branch, draft PR, exact source-head release + rollback pair, independent integrity verification, retention plan, and documented C4D gate.
**Production verdict: NO-GO.** This is preparation and review only. No merge, production switch, Cloudflare/Supabase/OAuth/RLS change, PWA reinstall, browser storage clearing, or Android/iPad changes.

## Evidence and its limitations

| Evidence | Provenance | What it proves |
| --- | --- | --- |
| main at 2894e003..., C4A PR #73 merged | Read-only GitHub API | Verified repository checkpoint, NOT release authorization |
| GitHub Actions successful three-edition build run 45024915157 | Read-only GitHub API | Verified artifacts exist at that source SHA; they are temporary |
| Three Android saved language packs (~85.9 MB), 0 outbox, Burmese ready offline, Food complete, Vegetables unlocked; airplane cold launch, vocabulary, saved pictures, pronunciation audio and matching app/worker PASS | User-provided C4B acceptance | User-verified real-device baseline; C4C did not touch the device |
| Private recovery JSON exported | User confirmation | State recovery only: DOES NOT include pack, media or CacheStorage bytes; it must never be placed in this public PR |
| Technical Supabase Google provider enabled; offline root URL allowlisted; Site URL remains http://localhost:8000 | User's dashboard observations | User-confirmed configuration, NOT end-to-end live unified Google OAuth proof; do not modify Site URL |
| Cloudflare production project kg-chart-offline with main, build command git submodule update --init --recursive && npm ci && npm run check:both, output dist-offline | User's dashboard verification | Existing separate offline production settings; never treat a PR preview as same-origin migration proof |
| OAuth callback from Google, real installed unified edition, iPad post-switch behavior and retention under full storage pressure | Not physically tested | UNVERIFIED; separate gates |

No private recovery contents, account IDs, tokens, email, OAuth secrets, personal lesson rows, or real cache data may be put in the branch, CI logs or PR.

## Initial reference artifacts (not approved release)

On initial main at 2894e003e4e036c02ce549f0c572dc78312827a3, successful Actions run 45024915157 archived:
- Compatible separate-offline ZIP — API SHA-256 2a5bae6c75786a8a3d259da01739fb5bee0491c754dcea53c85362debae717ac; expires 2026-12-06 12:58 UTC.
- Unified ZIP — API SHA-256 165f0d0232c772940c5bc042ad9bb67cac2e761dd7668f69b71aaf9d1dd52aab; expires 2026-12-06 12:58 UTC.
- Original online ZIP — API SHA-256 8910036a379121f5d6c51c3c837ef659333c9b591ab6dba4965a8de0192537d1; expires 2026-12-06 12:58 UTC.

Those are **GitHub Actions outer archive hashes**, not per-file hashes or durable copies. They are source-matched **reference** builds. C4C creates a *new* pair from the final PR head SHA, NOT the temporary refs/pull/merge revision and NOT automatically from this initial main SHA.

## C4C pipeline: source pin and safety

The existing workflow continues to run offline/unified tests, C4A artifact contract audit, network-isolated C3C Chromium same-origin synthetic migration and rollback, online source verification, and ordinary CI artifacts. It does not deploy production.

For a PR whose head branch begins release/stage-c4c-, an additional non-deploying job depends on the normal CI job and:
1. Checks out the exact full 40-hex PR HEAD commit with converter submodules, not GitHub's PR merge revision. It rejects any checkout/source mismatch.
2. Uses Node 24, npm ci, and seven isolated Python packaging tests with invented fixture data; no network, production account, device, or saved real packs are accessed by these tests.
3. Sets SOURCE_DATE_EPOCH from the pinned Git commit time, builds with npm run check:unified, and reruns the read-only C4A shell audit. In the regular production build, generatedAt continues to use the current time; only explicitly pinned CI builds use the deterministic timestamp.
4. Uses the Python stdlib-only tools/c4c_release.py to reject any shell SHA-256 mismatch, invalid/duplicate paths, missing/unlisted assets, source/version/schema mismatch, PWA installation identity drift, changed IndexedDB name/schema/stores, auth storage key change, media resolver mismatch, or incompatible rollback runtime/worker/installer.
5. Generates stable, sorted inner ZIPs with fixed ZIP timestamps and permissions. Reopens each ZIP to independently verify its archive checksum, individual shell hashes, PWA identity, account-scoped shared-picture support and matching rollback. Prints C4C_ARCHIVE_VERIFICATION_PASS only on success.
6. Uploads one *temporary* GitHub Actions artifact containing both ZIPs, c4c-release-record.json, and SHA256SUMS. Requested retention is 30 days, subject to repository retention policy. The actual expiry MUST be verified from the run's artifacts API.

The generated records explicitly say production_authorized=false, personal_recovery_data_included=false and retention_verified=false. They do not grant release permission. No CI step contains a Cloudflare deploy, Supabase write, OAuth setting change, release publication or branch merge. Independently configured Cloudflare Git integration may generate a separate PR preview; this must NOT be used as a substitute for the installed same-origin Android app.

The release commit is the **final PR head SHA**. If any file is subsequently edited and the SHA changes, regenerate the pair, rerun checks, and discard the outdated release receipt. Avoid treating the normal PR merge-check SHA or a moving main branch as a release pin.

## Artifact retention and recovery — mandatory C4D gate

The source-pinned CI artifact contains four files:
- kg-chart-c4c-compatible-rollback-FULL_SHA.zip — separate edition rebuilt from SAME source, including the shared-image resolver and v1 IndexedDB contract.
- kg-chart-c4c-unified-candidate-FULL_SHA.zip — unified edition at that same source.
- c4c-release-record.json — source/tree SHA, commit time, version, archive and shell hashes, PWA identity and storage contract.
- SHA256SUMS — reference hashes for the two inner ZIPs and the record itself.

Before the actual artifact expires, download the CI artifact and extract its four contents together. Record the exact GitHub run ID, PR-head SHA, artifact ID, actual expiry and checksums. Do not confuse the downloadable GitHub outer ZIP with the stable inner release ZIPs.

Offline verification of the retained four-file directory (not a deployment):

~~~text
python tools/c4c_release.py verify --source-sha FULL_40_CHARACTER_SHA --out PATH_TO_EXTRACTED_BUNDLE
~~~

The verifier must print C4C_ARCHIVE_VERIFICATION_PASS. On Windows, Get-FileHash -Algorithm SHA256 can independently check each inner ZIP against SHA256SUMS. Verification can be run disconnected from the network and does not require local browser data.

**Durable retention is not achieved by a 14- or 30-day Actions artifact.** Keep two access-controlled, independently recoverable copies of all four files: ideally one offline encrypted local copy and one encrypted off-site/versioned/immutable copy. Compare every copy's SHA-256 with the saved CI receipt, log retention expiry and an approved restoration operator in a **private** release register, then rehearse restoring a copy and rerunning the offline verifier. Preserve the Git commit and submodule revision. Do not upload the user's private recovery JSON into this artifact set. Hold the JSON privately as a separate account/progress backup, not a replacement for ~85.9 MB of saved media.

Do not publish a GitHub Release, create a production tag, push to Cloudflare, modify backup settings or copy any private data without separate approval. If retention cannot be independently verified, production migration is NO-GO.

## Final OAuth and production prerequisites — documentation only

**Supabase Technical** — keep Site URL http://localhost:8000 unchanged. The actual same-origin application redirectTo is dynamically constructed from window.location.origin + window.location.pathname. Confirm the root https://kg-chart-offline.pages.dev/ in Additional Redirect URLs (user has confirmed); review /index.html only if it is a real return path. Site URL is not the same as Additional Redirect URLs. No setting changes are authorized.

**Google OAuth** — provider enablement is user-verified, but final Google Cloud OAuth client authorized callback for the correct Technical Supabase project and a complete login/redirect/reauth round trip on the unified edition remain UNVERIFIED. The typical Supabase callback pattern is https://PROJECT_REF.supabase.co/auth/v1/callback; verify the actual project/client read-only and do not publish secrets or claim a complete live PASS from a provider toggle.

**Cloudflare** — recheck the exact live Pages project, main branch, deployed SHA, root, production command/output, active origin response, /sw.js, /offline-build.json and cache-control immediately before approval. The currently verified project uses dist-offline; the proposed separate future switch would use git submodule update --init --recursive && npm ci && npm run check:unified with dist-unified on the SAME production origin. Never change it in C4C. Original online GitHub Pages remains independent.

**Rollback** — restore the C4C SHA-matched separate-offline archive to the SAME existing origin only with explicit approval; never revert to an arbitrary old pre-shared-picture worker. A user recovery JSON does not restore offline packs/media. Do not clear any site data, delete caches, unregister workers, sign out, uninstall the PWA or create a new origin. After an authorized rollback, verify active app/worker, private progress, full pack list/size, shared media, audio, outbox and airplane-mode reopening; account for delayed service-worker activation. Pause and collect evidence if a gate fails.

## C4D GO/NO-GO checklist

| Gate | Required before GO | C4C status |
| --- | --- | --- |
| Source revision | Final reviewed SHA, no unreviewed changes | Pending final PR head |
| CI checks | Original tests + C3C browser + source-pinned C4C packaging/ZIP verification green | Pending final PR run |
| Compatible release pair | Both ZIP digests, shell SHA audits, v1 storage, unchanged PWA, shared media, rollback all PASS | Pending final CI artifacts |
| Retention | Two verified copies beyond CI expiry, retained receipt, restore operator and rehearsal | NO-GO until owner verifies |
| Real Android baseline | C4B 3 packs ~85.9 MB, 0 outbox, Food/Vegetables and saved media/audio cold launch | User-reported PASS; do not touch |
| OAuth | Correct Technical configuration, root allowlist, Google Cloud callback, real unified sign-in acceptance planned | Configuration partially user-verified; live unified behavior UNVERIFIED |
| Current Cloudflare | Read-only live build/deployment/header revalidation | User-verified settings, fresh release-date check pending |
| Rollback safety | Same-origin restoration operator, compatible pair, abort conditions, no data deletion | Plan prepared; not exercised in production |
| User authorization | Explicit separate go-ahead naming source, two ZIP hashes, exact Pages origin, build/output change, rollback procedure | NOT GRANTED — hard NO-GO |
| Post-switch acceptance | C5 Android and C6 iPad physical tests | NOT RUN |

**C4C produces evidence and a draft PR only. C4D remains NO-GO unless these gates pass and the owner expressly authorizes the specific production migration.**
