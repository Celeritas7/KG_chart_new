-- U4B2B-3A: fixture-only extension of the existing-profile revision guard.
-- Never install in a hosted database. No change to the production migration set.
BEGIN;
CREATE FUNCTION kg_u4b2b_test_private.guard_answer_insert()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE caller_email text; parent_owner uuid; current_revision bigint;
BEGIN
 IF auth.uid() IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Unverified answer identity' USING ERRCODE='42501';
 END IF;
 SELECT lower(u.email) INTO caller_email FROM auth.users u
 WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
 IF caller_email IS NULL THEN
   RAISE EXCEPTION 'Unverified answer identity' USING ERRCODE='42501';
 END IF;
 SELECT p.revision INTO current_revision
 FROM public.kg_chart_access_profiles p
 WHERE p.email=caller_email FOR SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Fixture profile required' USING ERRCODE='42501';
 END IF;
 SELECT s.user_id INTO parent_owner FROM public.kg_chart_quiz_sessions s
 WHERE s.id=NEW.session_id FOR SHARE;
 IF NOT FOUND OR parent_owner IS DISTINCT FROM auth.uid() THEN
   RAISE EXCEPTION 'Unverified answer owner' USING ERRCODE='42501';
 END IF;
 IF public.kg_chart_u3b2_can_answer(NEW.session_id,NEW.vocabulary_id,NEW.sentence_id) IS DISTINCT FROM true
 OR public.kg_chart_u3b3b1_can_private_answer(NEW.session_id,NEW.vocabulary_id,NEW.sentence_id) IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Revoked answer authorization' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.guard_answer_insert() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER kg_u4b2b_test_answer_guard BEFORE INSERT ON public.kg_chart_quiz_answers
 FOR EACH ROW EXECUTE FUNCTION kg_u4b2b_test_private.guard_answer_insert();
COMMIT;
