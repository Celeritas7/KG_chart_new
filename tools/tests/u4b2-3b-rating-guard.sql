-- U4B2B-3B: disposable-fixture-only vocabulary rating prototype.
-- This is not a migration and must never be installed in a hosted project.
BEGIN;
DO $$
BEGIN
 IF current_database() <> 'kg_u4b2_fixture' THEN
   RAISE EXCEPTION 'Disposable KG fixture required';
 END IF;
END $$;
CREATE FUNCTION kg_u4b2b_test_private.guard_rating_write()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE caller_email text; current_revision bigint;
BEGIN
 IF auth.uid() IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Unverified rating identity' USING ERRCODE='42501';
 END IF;
 IF TG_OP <> 'INSERT' THEN
   IF OLD.user_id IS DISTINCT FROM auth.uid() THEN
     RAISE EXCEPTION 'Unverified rating owner' USING ERRCODE='42501';
   END IF;
 END IF;
 IF TG_OP <> 'DELETE' THEN
   IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
     RAISE EXCEPTION 'Unverified rating owner' USING ERRCODE='42501';
   END IF;
 END IF;
 SELECT lower(u.email) INTO caller_email FROM auth.users u
 WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
 IF caller_email IS NULL THEN
   RAISE EXCEPTION 'Unverified rating identity' USING ERRCODE='42501';
 END IF;
 SELECT p.revision INTO current_revision
 FROM public.kg_chart_access_profiles p WHERE p.email=caller_email FOR SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Fixture profile required' USING ERRCODE='42501';
 END IF;
 -- Evaluate both the previous and proposed records, leaving RLS in force.
 IF TG_OP <> 'INSERT' THEN
   IF public.kg_chart_u3b2_can_rating(OLD.language_code::text,OLD.vocabulary_id) IS DISTINCT FROM true
      OR public.kg_chart_u3b3b1_can_private_rating(OLD.language_code::text,OLD.vocabulary_id) IS DISTINCT FROM true THEN
     RAISE EXCEPTION 'Revoked rating authorization' USING ERRCODE='42501';
   END IF;
 END IF;
 IF TG_OP <> 'DELETE' THEN
   IF public.kg_chart_u3b2_can_rating(NEW.language_code::text,NEW.vocabulary_id) IS DISTINCT FROM true
      OR public.kg_chart_u3b3b1_can_private_rating(NEW.language_code::text,NEW.vocabulary_id) IS DISTINCT FROM true THEN
     RAISE EXCEPTION 'Revoked rating authorization' USING ERRCODE='42501';
   END IF;
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.guard_rating_write() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER kg_u4b2b_test_rating_guard
 BEFORE INSERT OR UPDATE OR DELETE ON public.kg_chart_user_ratings
 FOR EACH ROW EXECUTE FUNCTION kg_u4b2b_test_private.guard_rating_write();
COMMIT;
