-- F2A CANDIDATE: disposable PostgreSQL fixture ONLY. Not a production migration.
-- Install after the historical U4B2 prototypes and U2 draft SQL in CI.
-- Existing profile grants + quiz-session inserts only. No enrollment or activation.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;

-- Reuse the reviewed U2 selection validation in one private implementation.
-- Both public wrappers call it as the schema owner; never trust a supplied actor.
CREATE FUNCTION kg_u4b2b_test_private.f2_replace_grants(
  p_email text,
  p_languages text[],
  p_topics jsonb,
  p_features text[],
  p_expected_revision bigint,
  p_required_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
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
  IF public.kg_chart_is_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'KG Chart administrator authorization required'
      USING ERRCODE = '42501';
  END IF;
  v_actor := auth.uid();
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u JOIN public.kg_chart_users k
      ON k.email = lower(u.email)
    WHERE u.id = v_actor AND u.email_confirmed_at IS NOT NULL AND k.role = 'admin'
  ) THEN
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
  IF p_required_mode NOT IN ('legacy','restricted') OR p_required_mode IS NULL
     OR (v_mode IS NOT NULL AND v_mode IS DISTINCT FROM p_required_mode)
     OR (p_required_mode = 'restricted' AND v_mode IS NULL) THEN
    RAISE EXCEPTION 'F2 profile mode cannot be changed by grant replacement' USING ERRCODE='42501';
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
    WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
       OR jsonb_typeof(value->'language_code') IS DISTINCT FROM 'string'
       OR jsonb_typeof(value->'topic_id') IS DISTINCT FROM 'string'
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
    WHERE email = v_email AND mode = p_required_mode;
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
    'mode', p_required_mode, 'languages', to_jsonb(p_languages),
    'topics', p_topics, 'features', to_jsonb(p_features),
    'publication', CASE WHEN p_required_mode='legacy' THEN 'not_authorized' ELSE 'fixture_existing_restricted' END
  ));
  RETURN jsonb_build_object(
    'email', v_email, 'mode', p_required_mode, 'revision', v_next_revision,
    'language_count', v_language_count, 'topic_count', v_topic_count,
    'feature_count', v_feature_count, 'applied_to_learners', p_required_mode = 'restricted'
  );
END;
$function$;

REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2_replace_grants(text,text[],jsonb,text[],bigint,text)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SCHEMA kg_u4b2b_test_private FROM PUBLIC,anon,authenticated,service_role;

-- Keep the actual current admin UI's endpoint and legacy-only response contract.
CREATE OR REPLACE FUNCTION public.kg_chart_u2_save_access_draft(
  p_email text,p_languages text[],p_topics jsonb,p_features text[],p_expected_revision bigint
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $$
  SELECT kg_u4b2b_test_private.f2_replace_grants(
    p_email,p_languages,p_topics,p_features,p_expected_revision,'legacy');
$$;
-- Existing restricted profiles only; cannot create or change a profile's mode.
CREATE FUNCTION public.kg_chart_f2_replace_restricted_grants(
  p_email text,p_languages text[],p_topics jsonb,p_features text[],p_expected_revision bigint
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $$
  SELECT kg_u4b2b_test_private.f2_replace_grants(
    p_email,p_languages,p_topics,p_features,p_expected_revision,'restricted');
$$;
REVOKE ALL ON FUNCTION public.kg_chart_u2_save_access_draft(text,text[],jsonb,text[],bigint)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.kg_chart_f2_replace_restricted_grants(text,text[],jsonb,text[],bigint)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_u2_save_access_draft(text,text[],jsonb,text[],bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_replace_restricted_grants(text,text[],jsonb,text[],bigint) TO authenticated;

-- Direct API grant changes would evade the row lock + revision increment.
-- Leave existing SELECT/RLS intact for the admin screen; no direct audit writes.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON
  public.kg_chart_access_profiles, public.kg_chart_access_languages,
  public.kg_chart_access_topics, public.kg_chart_access_features,
  public.kg_chart_access_draft_audit
  FROM PUBLIC,anon,authenticated,service_role;

-- Restricted clients must supply a revision via the RPC rather than INSERT.
-- Legacy inserts retain the prior policies (the earlier fixture trigger still
-- requires an existing profile; lifecycle and missing-profile testing are F3).
CREATE POLICY kg_u4b2_f2_legacy_direct_session ON public.kg_chart_quiz_sessions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b2_is_legacy() IS TRUE);

CREATE FUNCTION public.kg_chart_f2_save_restricted_session(
  p_expected_revision bigint,p_session_id uuid,p_language_code text,
  p_topic_id text,p_quiz_type text,p_total_questions int,p_correct_answers int,
  p_difficulty smallint,p_completed_at timestamptz,p_created_at timestamptz
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_mode text;
  v_revision bigint;
  v_saved uuid;
BEGIN
  IF v_uid IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2 unverified learner' USING ERRCODE='42501';
  END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u
    JOIN public.kg_chart_users k ON k.email=lower(u.email)
    WHERE u.id=v_uid AND u.email_confirmed_at IS NOT NULL AND k.role='operator';
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'F2 unverified operator' USING ERRCODE='42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'F2 explicit revision required' USING ERRCODE='40001';
  END IF;
  -- This shares the same existing profile row that grant publication updates.
  -- At READ COMMITTED, subsequent statements observe the post-lock snapshot.
  -- At REPEATABLE READ PostgreSQL can reject a concurrently updated row.
  SELECT mode,revision INTO v_mode,v_revision FROM public.kg_chart_access_profiles
    WHERE email=v_email FOR SHARE;
  IF NOT FOUND OR v_mode IS DISTINCT FROM 'restricted' THEN
    RAISE EXCEPTION 'F2 existing restricted profile required' USING ERRCODE='42501';
  END IF;
  IF v_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'F2 stale permission revision' USING ERRCODE='40001';
  END IF;
  IF p_session_id IS NULL OR p_created_at IS NULL OR p_total_questions IS NULL
     OR p_correct_answers IS NULL OR p_total_questions < 0
     OR p_correct_answers < 0 OR p_correct_answers > p_total_questions THEN
    RAISE EXCEPTION 'F2 invalid session payload' USING ERRCODE='22023';
  END IF;
  -- SECURITY DEFINER bypasses RLS: explicitly require all current session
  -- scope predicates and derive the owner from auth.uid(), never the payload.
  IF public.kg_chart_is_allowed() IS DISTINCT FROM true
     OR public.kg_chart_u3b2_can_quiz_session(p_language_code,p_topic_id,p_quiz_type) IS DISTINCT FROM true
     OR public.kg_chart_u3b3b1_can_private_session(p_language_code,p_topic_id) IS DISTINCT FROM true
     OR public.kg_chart_u3c2_can_sentence_session(p_language_code,p_topic_id,p_quiz_type) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2 revoked session scope' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.kg_chart_quiz_sessions
    (id,user_id,language_code,topic_id,quiz_type,total_questions,correct_answers,difficulty,completed_at,created_at)
    VALUES (p_session_id,v_uid,p_language_code,p_topic_id,p_quiz_type,p_total_questions,p_correct_answers,p_difficulty,p_completed_at,p_created_at)
    ON CONFLICT(id) DO NOTHING RETURNING id INTO v_saved;
  IF NOT FOUND THEN
    -- Exact immutable replay only; do not disclose a different owner's row.
    SELECT s.id INTO v_saved FROM public.kg_chart_quiz_sessions s
      WHERE s.id=p_session_id AND s.user_id=v_uid
        AND s.language_code IS NOT DISTINCT FROM p_language_code
        AND s.topic_id IS NOT DISTINCT FROM p_topic_id
        AND s.quiz_type IS NOT DISTINCT FROM p_quiz_type
        AND s.total_questions IS NOT DISTINCT FROM p_total_questions
        AND s.correct_answers IS NOT DISTINCT FROM p_correct_answers
        AND s.difficulty IS NOT DISTINCT FROM p_difficulty
        AND s.completed_at IS NOT DISTINCT FROM p_completed_at
        AND s.created_at IS NOT DISTINCT FROM p_created_at;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'F2 session identity conflict' USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN v_saved;
END $$;
REVOKE ALL ON FUNCTION public.kg_chart_f2_save_restricted_session(bigint,uuid,text,text,text,int,int,smallint,timestamptz,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_save_restricted_session(bigint,uuid,text,text,text,int,int,smallint,timestamptz,timestamptz)
  TO authenticated;
COMMIT;
