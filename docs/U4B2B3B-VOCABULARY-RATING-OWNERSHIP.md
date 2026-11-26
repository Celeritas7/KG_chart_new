# U4B2B-3B — vocabulary-rating ownership

This test-only increment follows merged PR #100. It extends the isolated existing-profile experiment to rating INSERT, UPDATE, UPSERT and DELETE. The guard uses the existing permission and private-vocabulary predicates and checks both the previous and proposed record where applicable. The prototype is installed only in the disposable database used by CI, not in app or migration source.

The two fictional learners rate the same word independently. Tests require owner-scoped reads and writes, ordinary rating updates, rollback preservation, rejection of stale transactions after a permission revision change, preservation of historical ratings, and uninterrupted progress for the other learner. The existing full application workflow remains required. No new application dependency or offline storage changes.

Limits: existing profiles, one transaction ordering at repeatable read, fixture identities, and a topic revocation with a revision update in the same transaction. This is not live API verification, an approved migration, or proof that production/offline authorization is ready. Expected-revision ingestion, all grant mutation paths, other progress operations, further concurrency regression tests and isolated Supabase release acceptance remain pending.

No live permissions, production data, existing learning records, app deployment or offline storage were changed. Restricted sharing remains NO-GO.
