# Stage C3C — Hardening the disposable unified migration test

**Scope:** test/CI/doc-only change. NO production Cloudflare, Supabase, OAuth, RLS, user storage, Android/iPad, existing packs, or application runtime edits. The unified edition must not be deployed under the live offline origin without a separate C4 authorization.

## Review findings addressed

1. **Network isolation including service workers:** GitHub CI builds the application on its runner, then runs the browser test in `mcr.microsoft.com/playwright:v1.56.1-noble` with Docker `--network none`. Chromium and its worker therefore have no external network interface, even for fetches that bypass Playwright's `page.route()`. The repository is mounted read-only, with only the ephemeral container `/tmp` writable. The harness asserts that only `lo` exists when `CI=true`. The test uses public Supabase hostname text *only* to match existing media URL logic; **no request can reach Supabase**. The container image is downloaded before networkless execution.
2. **Reproducible dependencies:** Playwright `1.56.1`, `playwright-core` and macOS-optional `fsevents` are pinned in `package.json`/`package-lock.json` with recorded tarball integrity. The Docker browser image matches version `1.56.1`, CI uses `npm ci`, and the previous mutable `npm install --no-save` step is removed.
3. **Realistic multi-language packs:** Two fictional account-scoped `my` and `zh` packs have active pointers and nonempty file lists with SHA-256/byte sizes, picture content (shared and old formats), audio bytes, and saved `clips.json` catalogs. The actual `KGOffline.verifyOffline()` checks both packs, their hashes, shell and queued work after cold launches in the separate, unified, and rollback editions. These are tiny test packs, **not** the user's approximately 85.9 MB live packs.
4. **Account isolation:** A second invented owner is enrolled in the disposable IndexedDB; a new controlled browser client switches to it and verifies that only its own ratings are available, the first account's pending changes/packs are not visible, and the worker does not disclose first-owner saved media. Switching back demonstrates the original records remain recoverable. No real sign-in or OAuth session is used.
5. **Worker-mediated media:** Cross-origin picture/audio requests are issued through the controlled browser's `fetch()`, rather than only directly inspecting CacheStorage. The test asserts legacy/shared images, both language recordings, and MP3 byte-range responses are served correctly while Docker denies external egress.
6. **Deterministic interrupted install:** The localhost server intentionally corrupts a hashed unified CSS asset *after* the worker has created its candidate shell. CI waits for the candidate's `redundant` state, verifies only the incomplete candidate cache was removed, and confirms the prior worker, packs, shell, progress and outbox remain. Successful upgrade and compatible rollback remain gated by exact worker and application revisions.

## Remaining boundaries (Stage C4 NO-GO)

- These tests do not simulate real Google OAuth redirect allowlists, actual Supabase synchronization or expired sessions. They exercise synthetic enrollment and browser/media boundaries.
- Only Chromium is tested; Android Home Screen and iPad Safari still need physical acceptance **after an explicitly approved release**.
- Synthetic tiny packs do not demonstrate full-volume storage pressure or operating-system eviction behavior on the user's device.
- Compatible rollback uses `dist-offline` rebuilt at the same commit with the shared-picture resolver, not an arbitrary older worker. Rollback to pre-shared-picture code remains unsafe.
- A successful C3C test-only PR does not authorize automatically merging, publishing `dist-unified`, redirecting the original GitHub Pages site, changing Cloudflare/Supabase production configuration, deleting packs, or clearing storage.
- The project previously reported a high-severity dependency warning during `npm install`. Triage via `npm audit` separately; do not run `npm audit fix --force` or silently change application dependencies.

**Evidence gate:** Wait for the GitHub Actions run corresponding to the final C3C PR head SHA. Review the browser log's explicit pass statements plus all existing offline/artifact tests. On any test failure, keep PR draft and retain C4 NO-GO. 
