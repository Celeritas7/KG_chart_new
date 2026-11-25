# U4B2B — concurrent revocation characterization

This first increment is a diagnostic, not a production fix. It builds on PR #97 and its passing isolated authorization and ownership tests. No live database, application, permissions, user invitations, or data changes.

## Test method
The existing disposable PostgreSQL 17 fixture runs with Docker --network none. An authenticated fictional learner starts a REPEATABLE READ transaction, checks the granted Burmese/Food topic, and waits on a test-only advisory lock held by a separate connection. A third connection revokes the grant and commits the new revision before releasing the barrier. The learner then attempts to insert a quiz session. The harness checks the persisted result, not just the client return value. A new transaction must reject the revoked topic.

A reproduced stale-snapshot commit is an explicit NO-GO finding; a successful diagnostic run does not mean the race is fixed. This is a repeatable-read transaction probe, not proof of a race under the exact default PostgREST request isolation level. A separate READ COMMITTED in-statement barrier test and actual API integration remain necessary.

## Next correction
Design a server-side transaction boundary covering permission publication and learner writes, with verified identity and an expected revision, and reject stale authorization without deleting queued progress. Direct writes must not bypass the boundary. Test lock ordering, both transaction orderings, rollback, independent accounts, retries, and legacy compatibility. Do not simply rely on a client-side preflight or a snapshot flag. Review actual Supabase privileges and endpoints before any rollout.

## Merge and release
This is stacked on the U4B2A branch because PR #97 was still open when the branch was created. Merge #97 first, then retarget/rebase and verify the diff and CI before merging this PR. No production deploy. Restricted online/offline sharing remains NO-GO until transaction security, real isolated Supabase tests and explicit release approval.
