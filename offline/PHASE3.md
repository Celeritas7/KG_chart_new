# Phase 3 — Migration readiness and device acceptance

Status: preparation implemented; production transition and physical acceptance pending.
Base: main e0df9ce8ccf64e748236d1f4fa06d46861c9742f (PR #52).

## Current deployment and destination

Read-only inspection of https://kg-chart-offline.pages.dev/offline-build.json on
2026-11-16 returned appVersion e0df9ce8ccf6, generatedAt
2026-11-16T15:13:19.089Z. This is the separate offline edition; a unified build
has the `-unified` revision suffix. New builds also record `edition` explicitly.

Recommended transition: serve the unified build on the existing offline origin.
It preserves the origin, IndexedDB name, account keys, cache layout and install
identity. No export/import of downloaded media is needed on the same origin.
Keep the original online site available until acceptance succeeds. A different
origin cannot directly read these downloads or progress. Existing recovery JSON
exports protect progress/outbox, not image or audio bytes. Cross-origin media
transfer is not implemented in this phase.

## On-device evidence

The compact offline panel now provides **Check offline readiness** and **Export
check report**. The check hashes cached shell dependencies and each active pack's
saved media, resolves shared picture references, checks recorded-audio catalogs,
and counts unsent changes. It does not repair, delete, re-download or sync data.
A file-check pass is not proof of device cold launch or complete source content:
confirmed missing-picture placeholders are counted separately. No saved pack
means the report cannot pass. The report excludes account identifiers, tokens,
vocabulary and learning records. Keep the app foregrounded for the check.

The check requires a worker supporting the audit message. A previous worker may
time out; finish a normal app update while connected and repeat. Do not unregister
it or clear storage. Audit is blocked during a quiz, download or active sync;
account changes cancel the check. Reports are point-in-time evidence, not a
permanent guarantee against browser storage eviction.

## Review and test before production

1. Review this PR. Run `npm ci` and `npm run check:unified`.
2. Use an isolated preview with `npm run build:unified`, output `dist-unified`.
   Use synthetic/test accounts and data; do not apply production SQL or write
   production progress as an automated test. Preview-origin storage is separate.
3. On each existing installation, record installed language packs and pending
   changes. Export recovery JSON before any approved transition. Preserve the
   current installation and all browser data.
4. Obtain explicit approval before merging or changing production hosting.
   The proposed Cloudflare build command is `npm run build:unified`, output
   directory `dist-unified`, on the SAME offline origin. Review build settings
   and OAuth configuration; do not change production auth settings implicitly.
5. Once an approved deployment exists, update while connected, outside a quiz.
   Check the edition is unified, run the readiness check, export the report and
   compare language packs and pending changes against the recorded baseline.
6. Complete the matrix below before treating migration as accepted.

## Physical acceptance matrix

| Scenario | Android Home Screen | iPad Home Screen |
| --- | --- | --- |
| Update without losing Burmese/Chinese packs or progress | Pending | Pending |
| Airplane mode, Wi-Fi off: refresh and navigation | Pending | Pending |
| Fully close app, reopen with no connection | Pending | Pending |
| Burmese/Chinese pictures and recorded audio, normal/slow | Pending | Pending |
| Quiz completion and local rating survive cold reopen | Pending | Pending |
| Interrupted pack download resumes without restarting all files | Pending | Pending |
| Reconnect: deliberate saved progress sync, no duplicate results | Pending | Pending |
| Update retains existing shared pictures and language audio | Pending | Pending |
| Collapsed controls do not cover learning interface | Pending | Pending |

Record OS/browser versions, build edition/revision, pack sizes/counts, report,
steps and observed failures. Network emulation alone is not physical acceptance.
Sync writes must be deliberate user tests; unresolved rating conflicts remain
queued under Phase 2's documented behavior. This phase adds no new server schema
or atomic conflict-resolution contract.

## Recovery and rollback

Do not uninstall, clear website data or manually unregister the service worker.
Use existing recovery exports and the explicit same-release shell repair only
when appropriate. Audit itself never invokes repair. If migration fails, retain
all packs and pending changes and collect the report before further action.
Any approved rollback must retain the shared-picture resolver and compatible
storage schemas. A pre-Phase-2 worker cannot safely read shared-picture reference
entries. Do not restore such a worker after those entries have been created.

## Validation and limitations

`npm run check:unified`: 35 automated tests pass; separate and unified builds pass.
New tests verify non-mutating detection of corrupt shell files and missing shared
picture payloads, account-free reports, and preservation of active pack metadata.
Tests use Node browser/storage mocks. Physical Android/iPad testing is pending;
this environment has no working browser runner, so no browser pass is claimed.
Original online index.html, js/kg-audio.js and sw.js are unchanged.
No deployment, merge, production Supabase write or browser-data deletion was made.
