# U4B2B-2: fixture-only quiz insertion revision guard

PR #98 reproduced stale authorization at REPEATABLE READ. This experiment installs a trigger ONLY in the disposable PostgreSQL test fixture after reproducing the original race. The same test is rerun with rejection required. The trigger takes a shared row lock on the caller's existing permission profile, which conflicts with revision updates, and rechecks the quiz scope. PostgreSQL may reject a stale repeatable-read transaction with a serialization failure.

No production SQL scripts, client flags, Auth/Storage configuration, or live learner data change. This is not an approved migration. A green diagnostic is not sufficient; the guarded rerun must reject the stale insertion and leave no inserted row.

Limits: existing-profile quiz INSERT only, revocation that updates the profile revision in the same transaction, synthetic identity, and one transaction ordering at REPEATABLE READ. Missing-profile enrollment, grant-only mutations, READ COMMITTED in-statement races, write-first ordering, independent accounts, expected revision on client writes, ratings, answers, completions, and direct API bypasses remain to be tested. The prototype is deliberately not usable as a production guard.

Merge PR #98 first; then retarget/rebase this stacked PR onto main and repeat CI. Restricted sharing remains NO-GO.