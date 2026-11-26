# U4B2B-3A — quiz-answer association (isolated prototype)

This increment extends PR #99's existing-profile locking experiment to quiz answer insertion, using only the disposable PostgreSQL fixture. The trigger checks the signed-in fixture identity, takes a shared lock on the existing permission profile and verifies the parent session belongs to the same learner. It reuses the existing answer and private-source authorization functions. No production migration or app source is changed.

The existing CI runs the new test after the quiz-session prototype. A fictional learner must be able to submit an answer for their own granted session; a foreign parent session must be rejected. The repeatable-read revocation scenario must reject a pending answer and preserve the original answer. Fresh revoked submissions must also be rejected. Results require CI confirmation.

Scope limits: INSERT only, existing profiles, revocation with revision increment in one transaction, one transaction ordering and synthetic identity. This is not proof of real Supabase Auth or API enforcement. Ratings, completions, other transaction orderings, grant-only changes, revision-aware production ingestion and full restricted offline acceptance are separate work. Do not apply fixture SQL to a hosted database.

No production rollout, user permissions or saved learning data are changed. Restricted sharing remains NO-GO.
