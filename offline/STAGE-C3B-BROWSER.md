# Stage C3B — Real-browser same-origin rehearsal (pre-C4, NOT a release)

## Isolation
CI builds `dist-offline` and `dist-unified` from one commit, then starts a localhost-only HTTP server for *both* editions. A fresh Chromium persistent profile is created under the CI runner's temporary directory; test exit closes Chromium, closes the server, and deletes **only that disposable test profile**. No Cloudflare, external Supabase, production device origin, or real account is used. Browser requests outside the localhost test origin are blocked.

The server changes the bytes served at the **same localhost origin** rather than opening distinct Pages preview origins. The existing production Cloudflare configuration remains `dist-offline`.

## Browser acceptance assertions
- Activate an actual `dist-offline/sw.js` service worker in Chromium; seed only invented account IDs and lesson content in IndexedDB `kg-chart-offline-v1`, owner-scoped active pack pointers, saved rating, completed Food topic, unlocked level and pending outbox.
- Cache two picture formats (legacy bytes and owner-scoped shared hash reference) and invented audio; record the original offline worker version and saved cache names.
- Present an intentionally inconsistent candidate service worker while the unified files are offered. Reject it during real worker installation, keep the old active controller, previous shell and data.
- Offer the actual unified worker at **the same origin**, apply update if waiting, reload the actual built learner app and verify new worker revision and the same owner, language pack, quiz progress, outbox, and image/audio bytes.
- Switch server back to compatible `dist-offline` generated from the **same source commit**; apply worker update, cold reload, verify owner-scoped data and shared-media references still work. Both versioned shell caches remain.
- Other owner's local rows remain separate; synthetic-only tests cannot substitute for real OAuth redirect or signed-in account transfer acceptance.

CI is expected to fail closed on a missing asset, failed worker activation, incompatible picture resolver, lost outbox, corrupted progress, wrong edition/revision, or missing rollback shell. Review artifacts are published by existing workflow only if checks pass.

## Limits, critical
This tests Chromium headless and a real browser service-worker lifecycle, **not Android Home Screen or iPad Safari**. Fictional media are tiny and do not simulate 85.9 MB storage pressure. It does not prove Google OAuth, Supabase server access, queue acknowledgment, iOS background worker behavior, true offline physical launch, concurrent tabs, or browser eviction. The rollback is the compatible **separate edition generated from the same commit**, not an arbitrary historical commit; do not deploy pre-shared-picture workers. No production release approval follows from a green CI run.

## Next gate
Review PR/CI logs and ensure no production configuration was changed. Before any C4 deployment, record a fresh Android baseline and private recovery export, confirm OAuth return configuration read-only, and obtain explicit approval identifying the existing production origin, exact candidate SHA/output, rollback SHA, and go/no-go decision. Never uninstall, clear website data, unregister existing workers, or delete saved packs as part of acceptance.

## Historical CI blocker (2026-11-22): resolved in final harness
The real Chromium harness runs on pinned `ubuntu-24.04` with Playwright 1.56.1. The current CI **does not pass** the browser rehearsal. Diagnostic run at `de760a2` confirmed the first worker loaded, two synthetic account boundaries and owner outbox were retained, and an intentionally mismatched candidate worker failed without replacing the controlling worker or removing stored data. Subsequent diagnostic run at `0ffe4ce` showed:

- Server served `sw.js` and `index.html` from the **unified** build at the same localhost origin.
- The unified versioned shell CacheStorage existed, and its cached root HTML contained `window.KG_UNIFIED=true`.
- Navigation reported `fromServiceWorker=true` but the loaded page remained `KG Chart Offline`, with the **separate-offline** application revision and `window.KG_UNIFIED=false`.
- Reloading again and opening a new tab with the same isolated browser profile did **not** resolve the old-page result.

This **was not evidence of device data loss**. The failing runs were caused by a test-harness lifecycle race: the initial update check could precede worker installation, and the legacy-recovery path could auto-activate after a `waiting` observation. The final test was corrected to verify the exact controlling revision through either valid path. See the final PASS section below. Production release is still separately blocked pending owner approval and device/OAuth gates.

### Additional evidence from real Chromium CI
In the earlier failing runs, a post-upgrade newly opened tab reported **old worker revision** through `KG_OFFLINE_GET_VERSION`, while `navigator.serviceWorker.getRegistration('/').active` was `activated` and identical to its controller. At the same time, the unified cache contained the correct unified root document. This narrows the issue to service-worker registration/controller selection or test harness interactions rather than missing compiled unified HTML. The final harness now verifies installation completion and controller revision and successfully runs the complete rollback acceptance. See final PASS below; production release still requires separate approval.

## Final C3B test outcome — PASS (2026-11-22)
At commit `92ce5b06bf57f0d77b1dff65bfa699fcd4f7e232`, GitHub Actions run [45016312221](https://github.com/Celeritas7/KG_chart_new/actions/runs/45016312221) completed **successfully**: 75/75 offline tests, 4/4 unified artifact tests and the real Chromium same-origin rehearsal. CI logs explicitly confirmed the separate worker and synthetic storage, rejection of a bad candidate, an automatically activated unified worker, and a separately approved waiting-worker rollback to the compatible separate edition with shared-image bytes and unsent outbox intact.

**Resolved CI test-harness race:** `registration.update()` does not guarantee the next worker is already waiting, and the existing one-time legacy recovery marker can automatically activate a complete candidate. The first C3B harness checked the old controller too early and falsely reported the unified shell as inactive. The final harness waits for installation to settle, accepts either a *verified* automatic activation or an explicit waiting-worker activation, and requires exact app/worker revisions. It still fails closed on a mismatch. Earlier red CI runs are retained as diagnostic history, not evidence of an unresolved production bug.

**Remaining NO-GO for C4:** This PASS is a synthetic localhost Chromium rehearsal, not production release approval. Android and iPad installed-app acceptance, real OAuth allowlist/redirect checks, private baseline and full downloaded-pack preservation under real browser pressure remain outstanding. Never use this pass to auto-merge or switch Cloudflare to `dist-unified`.
