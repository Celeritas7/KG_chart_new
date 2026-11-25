-- EXPERIMENT ONLY: disposable U4B2 fixture. NOT a deployment migration.
-- Serialize quiz insertion against changes to an existing permission profile.
BEGIN;
CREATE SCHEMA kg_u4b2b_test_private;
REVOKE ALL ON SCHEMA kg_u4b2b_test_private FROM PUBLIC,anon,authenticated;
CREATE FUNCTION kg_u4b2b_test_private.guard_quiz_insert()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE caller_email text; profile_mode text; profile_revision bigint;
BEGIN
 IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid()
    OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Unverified quiz owner' USING ERRCODE='42501';
 END IF;
 SELECT lower(u.email) INTO caller_email FROM auth.users u
 WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
 IF caller_email IS NULL THEN
   RAISE EXCEPTION 'Unverified quiz identity' USING ERRCODE='42501';
 END IF;
 -- FOR SHARE conflicts with an UPDATE of the revision, and at REPEATABLE
 -- READ PostgreSQL rejects a row changed since the transaction snapshot.
 SELECT p.mode,p.revision INTO profile_mode,profile_revision
 FROM public.kg_chart_access_profiles p WHERE p.email=caller_email FOR SHARE;
 -- This prototype ONLY proves existing-profile revocation. Missing-profile
 -- enrollment and all grant mutation paths need a separate reviewed design.
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Fixture profile required' USING ERRCODE='42501';
 END IF;
 IF public.kg_chart_u3b2_can_quiz_session(NEW.language_code::text,NEW.topic_id::text,NEW.quiz_type::text) IS DISTINCT FROM true
 OR public.kg_chart_u3b3b1_can_private_session(NEW.language_code::text,NEW.topic_id::text) IS DISTINCT FROM true
 OR public.kg_chart_u3c2_can_sentence_session(NEW.language_code::text,NEW.topic_id::text,NEW.quiz_type::text) IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Revoked quiz authorization' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.guard_quiz_insert() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER kg_u4b2b_test_guard BEFORE INSERT ON public.kg_chart_quiz_sessions
 FOR EACH ROW EXECUTE FUNCTION kg_u4b2b_test_private.guard_quiz_insert();
COMMIT;
