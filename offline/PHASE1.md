# Unified KG Chart — Phase 1 candidate

This change is a review candidate, not a production rollout. Build with
`npm ci`, `git submodule update --init`, and `npm run check:unified`.
Serve `dist-unified/` on an isolated HTTPS preview origin (or localhost).
The existing online source and its build remain unchanged.

## Behavior

- The canonical index.html learner UI is compiled into the unified candidate.
- Downloaded language content uses local storage; languages without a pack use
  the server while connected. Account-owned progress retains the existing outbox.
- The existing offline database, pack cache names, enrollment and recovery format
  are preserved. Nothing migrates to a different origin automatically.
- Download controls start collapsed, even during initial setup.
- Startup has bounded storage waits and a pre-React recovery watchdog. A blocked
  store yields recovery guidance, never automatic deletion or logout.
- Shell readiness checks every manifest dependency. Explicit repair checks hashes
  and replaces missing/corrupt app assets only when they match this release.
  If the server now serves another release, repair stops and asks for an update.
- A restarted worker asks the requesting same-origin page for its active owner
  before searching local media. It does not guess an account from stored packs.
- Network fallback for page/assets is bounded. Existing pack/outbox contents are
  not deleted. Old shells are retained; version-aware cleanup is future work.
- Unified and legacy builds use separate shell revision identifiers. The unified
  build preserves the existing installation ID for a possible same-origin upgrade.

## Verification

Automated coverage includes missing shell dependency detection/repair, account
isolation, worker restart ownership handshake, cache failure, interrupted pack
resume, local outbox acknowledgements/retries, blocked startup, collapsed controls,
and online access to undownloaded languages. Both legacy builds also compile.

Browser execution on this host is blocked: system Chromium fails with
`socket() failed: Operation not permitted`; Playwright WebKit is not installed.
No physical Android/iPad acceptance is claimed.

Before release, use a disposable preview profile with synthetic data to verify:
1. Online sign-in, language switching, each existing quiz and compact controls.
2. Download a pack, refresh online, then reload and cold-reopen in Airplane mode.
3. Interrupt a download, close the app, reopen and resume without losing progress.
4. Terminate the worker without reloading the tab; saved media must still load.
5. Remove a shell script only in a disposable test profile, verify not-ready state,
   repair online, and confirm pack/outbox records remain unchanged.
6. Update while a quiz is open: no reload; apply after finishing.
7. Repeat on physical Android Chrome/Home Screen and iPad Safari/Home Screen.

Do not clear site data or unregister workers as a normal repair step. Do not test
cache deletion on the user's existing Burmese/Chinese downloads.

## Remaining stages

Phase 2: shared picture storage (current packs still duplicate bytes), per-language
vocabulary/audio packs, deeper synchronization/conflict validation and content refresh.
Phase 3: approved final origin and deployment configuration, verified migration or
same-origin upgrade, full device acceptance. The current recovery export includes
progress/outbox but not media; keep the old origin until migration is verified.
Production deployment, merge and Supabase changes require explicit owner approval.
