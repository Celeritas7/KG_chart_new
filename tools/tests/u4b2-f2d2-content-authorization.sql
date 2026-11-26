-- F2D2 CANDIDATE: disposable fixture only. Never install in hosted Supabase.
BEGIN;
DO $fixture$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $fixture$;

-- Any changed content/catalog row can change effective authorization or the
-- bytes of a restricted pack. Conservative invalidation is intentional;
-- no-op updates do not publish. F2D1's global lock is acquired first.
CREATE FUNCTION kg_u4b2b_test_private.f2d2_publish_content()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $f2d2$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME NOT IN (
    'kg_chart_access_feature_catalog','kg_chart_languages','kg_chart_topics',
    'kg_chart_topic_translations','kg_chart_vocabulary',
    'kg_chart_vocabulary_translations','kg_chart_sentences',
    'kg_chart_colour_phrases','kg_chart_private_media_assets'
  ) THEN
    RAISE EXCEPTION 'F2D2 unexpected authorization source' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
  END IF;
  UPDATE kg_u4b2b_test_private.f2d_authorization_gate
    SET epoch=epoch+1 WHERE singleton;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'F2D2 authorization gate unavailable' USING ERRCODE='42501';
  END IF;
  UPDATE public.kg_chart_access_profiles SET revision=revision+1,updated_at=now()
    WHERE mode='restricted';
  RETURN NULL;
END $f2d2$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d2_publish_content()
  FROM PUBLIC,anon,authenticated,service_role;

-- Fixed, reviewed list: attach statement locks and row publication to
-- authorization-source DML, including FK-originating statements. The
-- pre-existing mapping trigger also publishes actual cascaded mapping edits.
DO $install$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'kg_chart_access_feature_catalog','kg_chart_languages','kg_chart_topics',
    'kg_chart_topic_translations','kg_chart_vocabulary',
    'kg_chart_vocabulary_translations','kg_chart_sentences',
    'kg_chart_colour_phrases','kg_chart_private_media_assets'
  ] LOOP
    EXECUTE format('CREATE TRIGGER f2d2_content_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION kg_u4b2b_test_private.f2d_lock_edit()',t);
    EXECUTE format('CREATE TRIGGER f2d2_content_publish AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION kg_u4b2b_test_private.f2d2_publish_content()',t);
    EXECUTE format('CREATE TRIGGER f2d2_content_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION kg_u4b2b_test_private.f2d_no_truncate()',t);
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  END LOOP;
  -- The original fictional content fixture models read RLS, not the admin's
  -- existing editing capability. Add only test adapter DML policies, not
  -- any broader SELECT policy or real production privilege.
  FOREACH t IN ARRAY ARRAY[
    'kg_chart_languages','kg_chart_topics','kg_chart_topic_translations',
    'kg_chart_vocabulary','kg_chart_vocabulary_translations',
    'kg_chart_sentences','kg_chart_colour_phrases'
  ] LOOP
    EXECUTE format('GRANT INSERT,UPDATE,DELETE ON public.%I TO authenticated',t);
    EXECUTE format('CREATE POLICY f2d2_fixture_admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.kg_chart_is_admin() IS TRUE AND auth.uid() IS NOT NULL)',t);
    EXECUTE format('CREATE POLICY f2d2_fixture_admin_update ON public.%I FOR UPDATE TO authenticated USING (public.kg_chart_is_admin() IS TRUE AND auth.uid() IS NOT NULL) WITH CHECK (public.kg_chart_is_admin() IS TRUE AND auth.uid() IS NOT NULL)',t);
    EXECUTE format('CREATE POLICY f2d2_fixture_admin_delete ON public.%I FOR DELETE TO authenticated USING (public.kg_chart_is_admin() IS TRUE AND auth.uid() IS NOT NULL)',t);
  END LOOP;
END $install$;
COMMIT;
