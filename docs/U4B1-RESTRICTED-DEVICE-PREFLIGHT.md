# KG Chart U4B1 — restricted learner device-acceptance preflight (source-only)

**Status: NO-GO for restricted friend sharing.** This is a review-only, synthetic preflight for the later U4B Android and iPad tests. It is **not a hardware PASS**, not a production authorization audit, and not a deployed permission change.

**Dependency:** U4A **PR #95** is open as a draft at the start of this phase. U4B1 is intentionally based on its branch, with a separate draft PR targeted at the U4A branch. Review/merge U4A first; once it lands, rebase or retarget the U4B1 PR and re-run all required CI before merging. Never merge or deploy U4A/U4B1 automatically.

## Why this small phase exists

The U4A checklist records existing Android/iPad offline lessons, images, audio, queued quiz progress and reconnect, but explicitly does not authorize restricted access. U4B requires a new, isolated **separate test account** whose actual server-side permissions are enforced; synthetic browser filtering alone cannot prove that a learner cannot fetch another person's lessons, media or writes.

At this checkpoint both SQL snapshot sources (U3A access and U3C2 sentence groups) still emit **server_enforced: false**. The U3C1 UI gate and all seven U3D offline gates remain hard OFF. Technical Supabase RLS, SQL/Edge/private-media deployment and revision-atomic write enforcement are **not verified**. Real restricted tests must therefore remain **BLOCKED**, even if an emulator or unit test reports all assertions green. This is a safety boundary, not a reason to turn on a switch.

## U4B1 implementation scope

- A Node-only synthetic test suite verifies granted/denied languages, topics, vocabulary and quiz views, including disallowed saved preferences; sentence/speak require separately enforced group-to-topic proof.
- Negative probes verify malformed or unenforced policy, owner mismatch, policy expiration, changed grant/revision and revoked topics all **fail closed**.
- The outbox probe verifies pending quiz events remain held, byte-for-byte, after a policy revision or account switch; a local classifier is not permission to send queued records to the real server.
- The CI workflow checks unchanged OFF flags, both SQL sources still fail closed, reviewed files only, and runs the existing privacy, scoped-pack, protected-media and restricted-sync unit suites.
- **No U4B1 code is bundled into the online/offline app** and no new UI controls, storage keys, IndexedDB schema, service workers, caches, APIs or network requests are added. The existing U4A Settings checklist remains unchanged.
- These tests use reserved synthetic UUIDs; no real emails, invitations, recovery JSON, user progress, access tokens, signed media links or production records.

## Gates before any live test account is used

1. Finish U4A review and real owner-account Android and iPad baseline acceptance. The two privacy-safe reports may be shared; the **private recovery** export contains sensitive learning data and must stay private.
2. Verify the Technical production backup and independent recovery plan, but conduct the restricted learner trials on an **isolated test backend** with reversible synthetic fixtures, not the owner's existing account or live friend's email.
3. Review and install the complete U1–U3C2 SQL/RLS/private lesson and media authorization stack on the isolated environment. Prove denied direct table queries, RPC writes and media reads actually fail with a restricted JWT. An optimistic server_enforced value alone is insufficient; an unverified or false snapshot must remain blocked.
4. Resolve the U3D3C acknowledged server-side **transaction/revision race**. Check that permission revocation and the associated write either share an atomic enforcement boundary or are rejected. Do not treat a client-side before/after policy check as that proof.
5. Approve a separate staged activation plan for U3C1/U3D gates and a safe, dedicated test PWA/profile. Keep the existing owner Android/iPad Home Screen installations, legacy saved packs and unsent outbox completely untouched. With all current gates OFF, **never enable** restricted sharing just to make a checklist pass.
6. Only then perform U4B physical acceptance, using the test account and **both actual devices**. Require explicit owner approval for account switching, grant revocation, and simulated rollback; use a distinct browser profile/device rather than signing the owner out of their installed app.

## Physical U4B test matrix — all BLOCKED, not run in U4B1

| Scenario | Android | iPad | Expected outcome once isolated backend is approved |
| --- | --- | --- | --- |
| Dedicated test account / wrong-account storage isolation | BLOCKED | BLOCKED | Test learner never loads the owner's legacy packs, notes or outbox |
| Only assigned language and topic shown | BLOCKED | BLOCKED | Granted Burmese / Food visible; denied language/topic absent from UI AND remote data |
| Only assigned Chart/Quiz modes visible | BLOCKED | BLOCKED | Denied features cannot be reopened from saved preference or direct URL |
| Protected picture and pronunciation source identity | BLOCKED | BLOCKED | Allowed private source decodes/plays; unassigned media is refused |
| Offline cold-open restricted pack | BLOCKED | BLOCKED | Only revision-bound downloaded restricted bundle; never fallback to broad public pack |
| Quiz and unsent work while offline | BLOCKED | BLOCKED | Supported records retained without leaking across accounts |
| Expired or missing policy offline | BLOCKED | BLOCKED | Restrict/lock instead of widening access; do not alter device clock to fake expiration |
| Permission revocation while offline | BLOCKED | BLOCKED | Previously downloaded bytes cannot be remotely erased; on reconnect, current policy locks revoked content |
| Denied/ambiguous outbox after reconnect | BLOCKED | BLOCKED | Original records and private recovery preserved; server refuses denied writes; no false ACK |
| Re-authorized grant and reinstallable pack | BLOCKED | BLOCKED | Fresh server policy required; no stale pointer or revoked private media resurrected |
| Account switch and return to owner | BLOCKED | BLOCKED | No cross-account pack, audio or quiz visibility; owner data remains intact |
| Private recovery export and audit evidence | BLOCKED | BLOCKED | Backup stays private, acceptance report contains no identifiers or raw answers |

The eventual U4B physical evidence must say which device, PWA edition, worker version, isolated test environment revision and individual scenario was **manually observed**; CI results cannot mark those as PASS. Never record live emails, IDs, private words, raw answers, signed URLs or private recovery bytes in a shareable acceptance report. Observations that were not performed remain **Not tested**.

## Stop criteria and safe responses

- **Stop immediately** if a disallowed topic, private image/audio, or other account's saved data appears; revoke the test fixture server-side, preserve local evidence privately, and record a sanitized failure code.
- Stop on 403/permission mismatch, an unexpected successful denied write, unauthorized fallback to legacy cached packs, media source mismatch, worker/version change, missing pending events, failed cold reopen or stale rollback. Do not erase packs or outbox to hide a failure.
- A 24-hour offline policy expiry is a source-contract limit, not evidence of instantaneous offline revocation. Never claim remote revocation can erase media already downloaded to a disconnected device.
- Do not test on the friend's personal account, public production SQL or an existing owner PWA. Hardware rollback and same-origin migration are U4C and need a separate backup and explicit authorization.

## Review result

**U4B1 = synthetic test preflight only; physical U4B = NOT TESTED/BLOCKED; release = NO-GO.**

Next independent increments after this reviewed preflight: **U4B2** isolated-backend enforcement proof and dedicated test fixtures (approval required for any backend changes); **U4B3** hands-on Android/iPad restricted learner acceptance; **U4C** physical PWA update, compatible worker rollback and outbox preservation. The separate C4D/C5/C6 hosting rollout, server transaction-lock security, dependency advisories and final release approval remain open.
