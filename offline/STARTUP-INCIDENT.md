# Android launch failure after successful file audit

On 2026-11-18 (Japan time), the user reported Chrome ERR_FAILED on the installed
https://kg-chart-offline.pages.dev/ app, persisting after refresh. The preceding
readiness report identified worker b79afc6080c6, shell.ok=true, and verified
Burmese, Chinese and Malay packs with no failed hashes and no unsent changes.
This is a failed launch acceptance test. File integrity is not launch reliability.

## Initial candidate (PR #54), insufficient to resolve the incident

The generated worker previously executed importScripts('./js/offline-pictures.js')
before registering any event handlers. An imported-script evaluation/load failure
can prevent the worker from handling navigation at all. The cache/network catch
inside the fetch handler cannot recover from a failure before that handler exists.
The readiness report inspects application CacheStorage, not the browser's separate
service-worker script resource storage or a fresh worker process.

The build now embeds the picture resolver into sw.js, eliminating this separate
startup dependency for both offline and unified editions. Page code still uses its
existing picture script. No cache names, IndexedDB schemas, pack entries, ownership
rules, account data or original online source files change.

The screenshot does not establish that the import actually failed. Other browser
startup/navigation failures remain possible; do not describe this patch as a proven
fix for the reported device. A real Android cold-reopen test is required after an
approved release. Do not advance unified rollout on the strength of file hashes.

## Validation

36 Node tests and online/offline/unified builds pass. A new test evaluates the
actual generated worker in a fresh VM where imports and network throw, verifies
handler registration, and serves a persisted shell navigation. This exercises
worker evaluation, unlike a test that stubs importScripts as always successful.
It does not reproduce Chrome's internal process or script-resource storage.

## Safe delivery and remaining evidence

This patch is review-only until explicitly approved for merge/deployment. Preserve
the current origin, downloaded packs and progress. Do not clear site data,
uninstall, or unregister the worker. Once approved and deployed, first attempt a
normal connected visit/update; an old broken controller may need browser-specific
recovery investigation if it cannot receive the new worker. Do not promise that
merging alone immediately repairs an already stranded installation.

Record whether normal Chrome on the same device can open the same URL while the
installed app fails, and whether both fail on Wi-Fi as well as mobile data. These
are diagnostic comparisons, not a substitute for fixing offline launch. Device
logs would be needed to establish the exact worker-start failure if it persists.


## Follow-up: redirected cached navigation (after PR #55)

User screenshots show the manual update control and “No new app update was
found”, followed one minute later by ERR_FAILED. The launch incident remains
open; receipt of new page code is not a physical launch acceptance pass.

Read-only live HTTP inspection on 2026-11-18 (Japan time) confirmed:

- GET/HEAD /index.html is redirected by Pages: HTTP 308, Location: /.
- / returns HTTP 200 HTML.
- The worker installer fetched ./index.html with default redirect-following.
- CacheStorage preserves the resulting Response URL list / redirected flag.
- The navigation handler returned that saved Response directly.

Fetch HTTP-fetch rules reject a service-worker response with multiple URLs when
the request's redirect mode is not follow. Browser navigation uses manual redirect
handling. This rejection occurs after respondWith resolves: the handler's own
try/catch does not intercept it. Hashing the response body still succeeds.
This is a demonstrated code/hosting defect consistent with the reported failure;
Android process logs have not been captured to attribute every device failure.

Sources:
- https://developers.cloudflare.com/pages/configuration/serving-pages/
- https://fetch.spec.whatwg.org/#http-fetch (service-worker response validation)

### Correction

Fetch the canonical app root when installing/repairing index.html, and reconstruct
followed navigation responses with a fresh Response, preserving status, content
and security headers while streaming the decoded body. Remove stale content
encoding/length metadata. Normalize cached hits, retry fallbacks and followed
network responses. Existing cache entries are supported on read; packs, previous
shells, account records and outbox data are not deleted or migrated. Ordinary
non-navigation assets and opaque redirect responses retain existing behavior.

Replace the misleading App ready offline badge and unconditional offline-launch
claim with App files saved and an explicit instruction to verify device reopening.
This separates saved-file evidence from physical-device reliability.

### Regression evidence and limits

Two tests use a real local HTTP server's 308 redirect and native fetch Response,
not only constructed Response fixtures. The existing worker passes the file hash
audit and fails both navigation compatibility tests. The corrected worker passes
both, including a fresh worker with network disabled and the fallback after a
transient cache-read failure. The saved redirected entry and a pack sentinel are
retained. A test models the Fetch rejection rule explicitly; it is not a full
browser execution. npm run check:unified: 39 tests pass; all builds pass.

A local Chromium launch was attempted but failed before a page could open in
this environment. Physical Android/iPad acceptance remains pending. After a
reviewed/approved release, verify the active worker revision then close/reopen and
refresh with and without network. If the corrected worker is waiting behind old
clients, close all KG Chart tabs and the installed app to allow normal activation;
do not unregister or clear storage. No forced reload/activation was added.

The unified rollout remains on hold until real-device launch succeeds. No merge,
production deploy, production database write or destructive recovery was performed
while preparing this patch.
