-- KG Chart U2: ADMIN-ONLY, ATOMIC, DRAFT-ONLY access-policy editing.
-- Requires reviewed U1 tables. Do NOT run automatically in production.
-- No online/offline learner enforcement. No changes to existing app policies.
-- Run manually only after backup and separate explicit approval.
-- Never grants real restricted access: mode is ALWAYS 'legacy' on save.

BEGIN;

CREATE TABLE IF NOT EXISTS public.kg_chart_access_draft_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL REFERENCES public.kg_chart_users(email)
    ON UPDATE CASCADE ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision >= 1),
  changed_by uuid NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, revision)
);

ALTER TABLE public.kg_chart_access_draft_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kg_chart_access_draft_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.kg_chart_access_draft_audit TO authenticated, service_role;
DROP POLICY IF EXISTS kg_u2_admin_only ON public.kg_chart_access_draft_audit;
CREATE POLICY kg_u2_admin_only ON public.kg_chart_access_draft_audit
  FOR ALL TO authenticated
  USING ((SELECT public.kg_chart_is_admin()))
  WITH CHECK ((SELECT public.kg_chart_is_admin()));

-- One RPC call = one PostgreSQL transaction. No intermediate partial grants.
-- SECURITY INVOKER: admin check plus the RLS on every U1 and U2 table.
-- The function refuses existing restricted profiles: U3 publication is separate.
CREATE OR REPLACE FUNCTION public.kg_chart_u2_save_access_draft(
  p_email text,
  p_languages text[],
  p_topics jsonb,
  p_features text[],
  p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = 'pg_catalog', 'public'
AS $function$
DECLARE
  v_email text;
  v_role text;
  v_actor uuid;
  v_mode text;
  v_current_revision bigint;
  v_next_revision bigint;
  v_topic_count integer;
  v_language_count integer;
  v_feature_count integer;
BEGIN
  IF NOT public.kg_chart_is_admin() THEN
    RAISE EXCEPTION 'KG Chart administrator authorization required'
      USING ERRCODE = '42501';
  END IF;
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'A verified administrator session is required'
      USING ERRCODE = '42501';
  END IF;

  v_email := lower(btrim(coalesce(p_email, '')));
  IF v_email = '' OR v_email <> p_email THEN
    RAISE EXCEPTION 'A normalized existing learner email is required';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'An explicit expected draft revision is required';
  END IF;

  -- Serialize drafts per email without requiring UPDATE privilege on the
  -- existing allowlist table. This transaction-scoped lock also covers the
  -- first save, when no access profile exists yet.
  PERFORM pg_advisory_xact_lock(hashtext('kg_chart_u2_draft:' || v_email));
  SELECT u.role INTO v_role
    FROM public.kg_chart_users AS u
    WHERE u.email = v_email;
  IF v_role IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'U2 drafts are only for existing operator learners';
  END IF;

  SELECT a.mode, a.revision INTO v_mode, v_current_revision
    FROM public.kg_chart_access_profiles AS a
    WHERE a.email = v_email
    FOR UPDATE;
  IF v_mode IS NOT NULL AND v_mode <> 'legacy' THEN
    RAISE EXCEPTION 'U2 cannot edit or activate an enforced restricted profile';
  END IF;
  IF coalesce(v_current_revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'Draft changed since it was opened; reload before saving'
      USING ERRCODE = '40001';
  END IF;

  IF p_languages IS NULL OR p_features IS NULL OR p_topics IS NULL
     OR jsonb_typeof(p_topics) <> 'array' THEN
    RAISE EXCEPTION 'Supply complete language, topic and feature selections';
  END IF;
  IF cardinality(p_languages) > 100 OR cardinality(p_features) > 100
     OR jsonb_array_length(p_topics) > 2000 THEN
    RAISE EXCEPTION 'Access draft exceeds safe selection limits';
  END IF;
  IF EXISTS(
    SELECT 1 FROM unnest(p_languages) AS code
    WHERE code IS NULL OR btrim(code) = '' OR code <> btrim(code)
  ) OR EXISTS (
    SELECT 1 FROM unnest(p_features) AS feature
    WHERE feature IS NULL OR btrim(feature) = '' OR feature <> btrim(feature)
  ) THEN
    RAISE EXCEPTION 'Language and feature codes must be nonempty canonical values';
  END IF;
  IF EXISTS(
    SELECT 1 FROM unnest(p_languages) AS code
    GROUP BY code HAVING count(*) > 1
  ) OR EXISTS(
    SELECT 1 FROM unnest(p_features) AS feature
    GROUP BY feature HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate language or feature grant in access draft';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_languages) AS selected_lang(code)
    LEFT JOIN public.kg_chart_languages AS l ON l.code = selected_lang.code
    WHERE l.code IS NULL OR l.is_active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'Draft includes a language that is not active in KG Chart';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_features) AS selected_feature(feature_key)
    LEFT JOIN public.kg_chart_access_feature_catalog AS f
      ON f.feature_key = selected_feature.feature_key
    WHERE f.feature_key IS NULL OR f.is_active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'Draft includes an unavailable learning feature';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_topics) AS item(value)
    WHERE jsonb_typeof(value) <> 'object'
       OR jsonb_typeof(value->'language_code') <> 'string'
       OR jsonb_typeof(value->'topic_id') <> 'string'
       OR coalesce(btrim(value->>'language_code'),'') = ''
       OR coalesce(btrim(value->>'topic_id'),'') = ''
       OR (value->>'language_code') <> btrim(value->>'language_code')
       OR (value->>'topic_id') <> btrim(value->>'topic_id')
  ) THEN
    RAISE EXCEPTION 'Topic grants require valid language_code and topic_id';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_topics) AS item(value)
    GROUP BY value->>'language_code', value->>'topic_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate topic grant in access draft';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_topics) AS item(value)
    LEFT JOIN public.kg_chart_topic_translations AS tt
      ON tt.language_code = value->>'language_code'
      AND tt.topic_id = value->>'topic_id'
    WHERE NOT (value->>'language_code' = ANY(p_languages))
      OR tt.topic_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Topic must have a translation in an explicitly selected language';
  END IF;

  v_next_revision := coalesce(v_current_revision, 0) + 1;
  IF v_current_revision IS NULL THEN
    INSERT INTO public.kg_chart_access_profiles(email, mode, revision)
    VALUES (v_email, 'legacy', v_next_revision);
  ELSE
    UPDATE public.kg_chart_access_profiles
    SET revision = v_next_revision, updated_at = now()
    WHERE email = v_email AND mode = 'legacy';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Access profile cannot be updated safely';
    END IF;
  END IF;

  -- Remove dependent rows before the language rows. Reinsert complete selected
  -- grants; an error rolls the ENTIRE RPC back, including the profile revision.
  DELETE FROM public.kg_chart_access_topics WHERE email = v_email;
  DELETE FROM public.kg_chart_access_features WHERE email = v_email;
  DELETE FROM public.kg_chart_access_languages WHERE email = v_email;

  INSERT INTO public.kg_chart_access_languages(email, language_code)
    SELECT v_email, lang FROM unnest(p_languages) AS lang;
  INSERT INTO public.kg_chart_access_topics(email, language_code, topic_id)
    SELECT v_email, value->>'language_code', value->>'topic_id'
    FROM jsonb_array_elements(p_topics) AS item(value);
  INSERT INTO public.kg_chart_access_features(email, feature_key)
    SELECT v_email, feature FROM unnest(p_features) AS feature;

  v_language_count := cardinality(p_languages);
  v_topic_count := jsonb_array_length(p_topics);
  v_feature_count := cardinality(p_features);
  INSERT INTO public.kg_chart_access_draft_audit
    (email, revision, changed_by, snapshot)
  VALUES (v_email, v_next_revision, v_actor, jsonb_build_object(
    'mode', 'legacy', 'languages', to_jsonb(p_languages),
    'topics', p_topics, 'features', to_jsonb(p_features),
    'publication', 'not_authorized'
  ));
  RETURN jsonb_build_object(
    'email', v_email, 'mode', 'legacy', 'revision', v_next_revision,
    'language_count', v_language_count, 'topic_count', v_topic_count,
    'feature_count', v_feature_count, 'applied_to_learners', false
  );
END;
$function$;

-- No public/default access to this API. A verified admin is still checked
-- inside the function; the invoker must also satisfy RLS.
REVOKE ALL ON FUNCTION public.kg_chart_u2_save_access_draft(
  text, text[], jsonb, text[], bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kg_chart_u2_save_access_draft(
  text, text[], jsonb, text[], bigint) TO authenticated;

COMMIT;
