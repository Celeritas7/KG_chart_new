# U4B2 — isolated backend authorization verification

Scope: test-only changes on main after U4B1. No production SQL, Auth, Storage, Edge deployment, user invites or app flags changed.

The new CI job starts disposable PostgreSQL 17 with no network, uses existing fictional Auth/role fixtures and installs the reviewed U1 and U3A–U3C2 authorization scripts in the established order. Existing sentence-group SQL tests and new combined read/write/revocation assertions run under authenticated fixture roles, not postgres. The simulated Edge authorization contracts also run. Database is destroyed on completion.

## Evidence boundary
- Actual PostgreSQL RLS enforcement on the fictional schema is tested; fixture auth.uid/admin functions are NOT real JWT verification.
- Verify a permitted Burmese/Food word quiz succeeds, denied language/private-source and other-owner writes fail, restricted direct reads exclude other topics and private media, and sequential revocation blocks new reads/writes while retaining historical progress.
- No live Supabase project, PostgREST, Storage bucket, signed URL or physical device was tested. U2 draft permission publication, actual deployed schema parity and role grants, concurrent write/revocation serialization, real Auth and media endpoint behavior remain unverified. Existing public media cannot be made confidential retroactively.
- Both server_enforced snapshot flags and all client rollout flags remain OFF. Do not turn them on to make a test pass.

## Remaining online-only release gates
1. Review the full isolated SQL result; resolve any failures, including production schema/fixture differences. Verify current Supabase documentation and deployed configuration before any proposed live migration.
2. Implement and test transactional revision-aware authorization with concurrent independent connections, including direct API bypass attempts and rollback.
3. Provision an explicitly approved isolated Supabase environment; verify real restricted JWTs, PostgREST direct access, RPC privileges, private bucket policies, Edge signer behavior, and denied public fallback. No production credentials or personal learner data.
4. Review a dedicated restricted online-only release that cannot download broad packs or bypass restrictions via old cached app; preserve legacy owner access and offline storage. Validate actual permissions and revocation on a separate test account before inviting a friend.

**Release verdict: NO-GO.** Passing the new CI is only a database fixture milestone. Physical U4A/U4B3/U4C and production backup/approval remain separate.
