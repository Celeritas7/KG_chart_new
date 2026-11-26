-- F2D1 CANDIDATE: disposable fixture only. Never install in hosted Supabase.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;

-- The historical settings fixture had SELECT only. Model the existing admin
-- editing capability for these synthetic tests, retaining all SELECT RLS.
-- This is a fixture adapter, NOT a proposed production privilege grant.
GRANT INSERT,UPDATE,DELETE ON public.kg_chart_settings TO authenticated;
CREATE POLICY kg_f2d1_fixture_admin_settings_write ON public.kg_chart_settings
  FOR ALL TO authenticated
  USING (public.kg_chart_is_admin() IS TRUE AND auth.uid() IS NOT NULL)
  WITH CHECK (public.kg_chart_is_admin() IS TRUE AND auth.uid() IS NOT NULL);

-- Statement-level BEFORE acquires the global lock before the editor locks
-- source rows. This also catches direct INSERT/UPDATE/DELETE/UPSERT and
-- trusted maintenance DML, not only a particular RPC or browser path.
CREATE FUNCTION kg_u4b2b_test_private.f2d_lock_edit()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
  PERFORM 1 FROM kg_u4b2b_test_private.f2d_authorization_gate
    WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'F2D authorization gate unavailable' USING ERRCODE='42501';
  END IF;
  RETURN NULL;
END $$;

-- Advance the epoch and each EXISTING restricted profile revision in the
-- very same transaction as a changed sensitive row. Conservative global
-- invalidation avoids incorrectly guessing which learner a rule affects.
-- No-op edits and unrelated settings do not change any revision.
CREATE FUNCTION kg_u4b2b_test_private.f2d_publish_edit()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_sensitive boolean := false;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME NOT IN (
    'kg_chart_settings','kg_chart_sentence_group_topic_map') THEN
    RAISE EXCEPTION 'F2D unexpected source' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
  END IF;
  IF TG_TABLE_NAME='kg_chart_settings' THEN
    IF TG_OP <> 'INSERT' THEN
      v_sensitive := OLD.key='private_lessons';
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_sensitive := v_sensitive OR NEW.key='private_lessons';
    END IF;
  ELSE
    v_sensitive := true;
  END IF;
  IF NOT v_sensitive THEN RETURN NULL; END IF;
  UPDATE kg_u4b2b_test_private.f2d_authorization_gate SET epoch=epoch+1 WHERE singleton;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'F2D authorization gate unavailable' USING ERRCODE='42501';
  END IF;
  UPDATE public.kg_chart_access_profiles SET revision=revision+1,updated_at=now()
    WHERE mode='restricted';
  RETURN NULL;
END $$;

-- TRUNCATE has no row events. Explicitly prohibit it rather than allowing
-- silent deletion of every private rule or mapping, including as fixture owner.
CREATE FUNCTION kg_u4b2b_test_private.f2d_no_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'F2D authorization sources cannot be truncated' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d_lock_edit(),
  kg_u4b2b_test_private.f2d_publish_edit(),kg_u4b2b_test_private.f2d_no_truncate()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER f2d1_settings_lock BEFORE INSERT OR UPDATE OR DELETE ON public.kg_chart_settings
  FOR EACH STATEMENT EXECUTE FUNCTION kg_u4b2b_test_private.f2d_lock_edit();
CREATE TRIGGER f2d1_settings_publish AFTER INSERT OR UPDATE OR DELETE ON public.kg_chart_settings
  FOR EACH ROW EXECUTE FUNCTION kg_u4b2b_test_private.f2d_publish_edit();
CREATE TRIGGER f2d1_settings_no_truncate BEFORE TRUNCATE ON public.kg_chart_settings
  FOR EACH STATEMENT EXECUTE FUNCTION kg_u4b2b_test_private.f2d_no_truncate();
CREATE TRIGGER f2d1_mapping_lock BEFORE INSERT OR UPDATE OR DELETE ON public.kg_chart_sentence_group_topic_map
  FOR EACH STATEMENT EXECUTE FUNCTION kg_u4b2b_test_private.f2d_lock_edit();
CREATE TRIGGER f2d1_mapping_publish AFTER INSERT OR UPDATE OR DELETE ON public.kg_chart_sentence_group_topic_map
  FOR EACH ROW EXECUTE FUNCTION kg_u4b2b_test_private.f2d_publish_edit();
CREATE TRIGGER f2d1_mapping_no_truncate BEFORE TRUNCATE ON public.kg_chart_sentence_group_topic_map
  FOR EACH STATEMENT EXECUTE FUNCTION kg_u4b2b_test_private.f2d_no_truncate();
REVOKE TRUNCATE ON public.kg_chart_settings,public.kg_chart_sentence_group_topic_map
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
