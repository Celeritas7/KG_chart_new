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
