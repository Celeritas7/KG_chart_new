# Android launch failure after successful file audit

On 2026-11-18 (Japan time), the user reported Chrome ERR_FAILED on the installed
https://kg-chart-offline.pages.dev/ app, persisting after refresh. The preceding
readiness report identified worker b79afc6080c6, shell.ok=true, and verified
Burmese, Chinese and Malay packs with no failed hashes and no unsent changes.
This is a failed launch acceptance test. File integrity is not launch reliability.

## Candidate fix, not a confirmed root cause

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
