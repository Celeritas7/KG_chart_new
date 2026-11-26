-- F2C candidate: disposable fixture only. Never apply to hosted Supabase.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;
-- Model the timestamp fields already used by offline/restricted-sync.js.
-- Earlier fixtures intentionally modeled only the rating itself.
ALTER TABLE public.kg_chart_user_ratings
  ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- No directly accessible API tables for version or receipt manipulation.
-- Tombstone versions survive a rating deletion, avoiding absent-row ABA.
CREATE TABLE kg_u4b2b_test_private.f2c_versions (
  owner_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('rating','completion')),
  language_code text NOT NULL, target text NOT NULL,
  version bigint NOT NULL CHECK(version > 0),
  PRIMARY KEY(owner_id,kind,language_code,target)
);
CREATE TABLE kg_u4b2b_test_private.f2c_receipts (
  owner_id uuid NOT NULL, event_id uuid NOT NULL,
  request jsonb NOT NULL, event_version bigint NOT NULL CHECK(event_version > 0),
  PRIMARY KEY(owner_id,event_id)
);
REVOKE ALL ON TABLE kg_u4b2b_test_private.f2c_versions,
  kg_u4b2b_test_private.f2c_receipts FROM PUBLIC,anon,authenticated,service_role;

-- Existing legacy callers still use the original RLS + historical guards.
-- Restricted raw INSERT/UPSERT must fail; UPDATE/DELETE can affect zero rows
-- under RLS, so clients must not treat a transport success as an ACK.
CREATE POLICY kg_u4b2_f2_legacy_rating_insert ON public.kg_chart_user_ratings
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.kg_chart_u3b2_is_legacy() IS TRUE);
CREATE POLICY kg_u4b2_f2_legacy_rating_update ON public.kg_chart_user_ratings
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING(public.kg_chart_u3b2_is_legacy() IS TRUE)
  WITH CHECK(public.kg_chart_u3b2_is_legacy() IS TRUE);
CREATE POLICY kg_u4b2_f2_legacy_rating_delete ON public.kg_chart_user_ratings
  AS RESTRICTIVE FOR DELETE TO authenticated USING(public.kg_chart_u3b2_is_legacy() IS TRUE);
CREATE POLICY kg_u4b2_f2_legacy_completion_insert ON public.kg_chart_topic_completions
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.kg_chart_u3b2_is_legacy() IS TRUE);
CREATE POLICY kg_u4b2_f2_legacy_completion_update ON public.kg_chart_topic_completions
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING(public.kg_chart_u3b2_is_legacy() IS TRUE)
  WITH CHECK(public.kg_chart_u3b2_is_legacy() IS TRUE);
CREATE POLICY kg_u4b2_f2_legacy_completion_delete ON public.kg_chart_topic_completions
  AS RESTRICTIVE FOR DELETE TO authenticated USING(public.kg_chart_u3b2_is_legacy() IS TRUE);
REVOKE TRUNCATE ON public.kg_chart_user_ratings,public.kg_chart_topic_completions
  FROM PUBLIC,anon,authenticated,service_role;

-- Always acquire the permission-profile lock before progress records.
-- FOR UPDATE also serializes mutations and exact receipt checks for one
-- learner. It conflicts with F2A publication and F2B's shared profile lock.
CREATE FUNCTION kg_u4b2b_test_private.f2c_lock_scope(
  p_expected_revision bigint,p_kind text,p_lang text,p_vocab uuid,p_topic text
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_uid uuid := auth.uid(); v_email text; v_mode text; v_revision bigint;
BEGIN
  IF v_uid IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2C unverified learner' USING ERRCODE='42501';
  END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u
    JOIN public.kg_chart_users k ON k.email=lower(u.email)
    WHERE u.id=v_uid AND u.email_confirmed_at IS NOT NULL AND k.role='operator';
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'F2C unverified operator' USING ERRCODE='42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'F2C explicit revision required' USING ERRCODE='40001';
  END IF;
  SELECT mode,revision INTO v_mode,v_revision FROM public.kg_chart_access_profiles
    WHERE email=v_email FOR UPDATE;
  IF NOT FOUND OR v_mode IS DISTINCT FROM 'restricted'
     OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2C existing restricted profile required' USING ERRCODE='42501';
  END IF;
  IF v_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'F2C stale permission revision' USING ERRCODE='40001';
  END IF;
  IF p_lang IS NULL OR btrim(p_lang)='' THEN
    RAISE EXCEPTION 'F2C invalid language' USING ERRCODE='22023';
  END IF;
  IF p_kind='rating' AND p_vocab IS NOT NULL AND p_topic IS NULL THEN
    IF public.kg_chart_u3b2_can_rating(p_lang,p_vocab) IS DISTINCT FROM true
       OR public.kg_chart_u3b3b1_can_private_rating(p_lang,p_vocab) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'F2C denied rating scope' USING ERRCODE='42501';
    END IF;
  ELSIF p_kind='completion' AND p_vocab IS NULL AND p_topic IS NOT NULL AND btrim(p_topic)<>'' THEN
    IF public.kg_chart_u3b2_can_completion(p_lang,p_topic) IS DISTINCT FROM true
       OR public.kg_chart_u3b3b1_can_private_session(p_lang,p_topic) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'F2C denied completion scope' USING ERRCODE='42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'F2C invalid progress target' USING ERRCODE='22023';
  END IF;
  RETURN v_uid;
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2c_lock_scope(bigint,text,text,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;

-- Read a current owner-scoped baseline under the same permission lock.
-- Version 0 means no F2C operation yet, NOT that the legacy row is absent.
CREATE FUNCTION public.kg_chart_f2_my_progress_state(
  p_expected_revision bigint,p_kind text,p_language_code text,p_vocabulary_id uuid,p_topic_id text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog SET timezone='UTC'
AS $$
DECLARE v_uid uuid; v_version bigint; v_state jsonb; v_target text;
BEGIN
  v_uid := kg_u4b2b_test_private.f2c_lock_scope(
    p_expected_revision,p_kind,p_language_code,p_vocabulary_id,p_topic_id);
  v_target := coalesce(p_vocabulary_id::text,p_topic_id);
  SELECT version INTO v_version FROM kg_u4b2b_test_private.f2c_versions
    WHERE owner_id=v_uid AND kind=p_kind AND language_code=p_language_code AND target=v_target;
  IF p_kind='rating' THEN
    SELECT jsonb_build_object('rating',rating,'last_reviewed_at',last_reviewed_at,'updated_at',updated_at)
      INTO v_state FROM public.kg_chart_user_ratings
      WHERE user_id=v_uid AND vocabulary_id=p_vocabulary_id AND language_code=p_language_code;
  ELSE
    SELECT jsonb_build_object('completed_at',completed_at)
      INTO v_state FROM public.kg_chart_topic_completions
      WHERE user_id=v_uid AND topic_id=p_topic_id AND language_code=p_language_code;
  END IF;
  RETURN jsonb_build_object('version',coalesce(v_version,0),'state',v_state,
    'permission_revision',p_expected_revision);
END $$;

CREATE FUNCTION public.kg_chart_f2_save_progress(
  p_expected_revision bigint,p_event_id uuid,p_expected_version bigint,
  p_operation text,p_language_code text,p_vocabulary_id uuid,p_topic_id text,
  p_rating int,p_last_reviewed_at timestamptz,p_updated_at timestamptz,p_completed_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog SET timezone='UTC'
AS $$
DECLARE
  v_uid uuid; v_kind text; v_target text; v_request jsonb; v_prior jsonb;
  v_version bigint; v_event_version bigint;
BEGIN
  v_kind := CASE p_operation WHEN 'rating_upsert' THEN 'rating'
    WHEN 'rating_delete' THEN 'rating' WHEN 'completion_upsert' THEN 'completion' END;
  -- Check current permission even on a previously recorded event.
  v_uid := kg_u4b2b_test_private.f2c_lock_scope(
    p_expected_revision,v_kind,p_language_code,p_vocabulary_id,p_topic_id);
  IF p_event_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0 THEN
    RAISE EXCEPTION 'F2C event ID and baseline version required' USING ERRCODE='22023';
  END IF;
  IF p_operation='rating_upsert' THEN
    IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5
       OR p_updated_at IS NULL OR NOT isfinite(p_updated_at)
       OR (p_last_reviewed_at IS NOT NULL AND NOT isfinite(p_last_reviewed_at))
       OR p_completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'F2C invalid rating payload' USING ERRCODE='22023';
    END IF;
  ELSIF p_operation='rating_delete' THEN
    IF p_rating IS NOT NULL OR p_last_reviewed_at IS NOT NULL
       OR p_updated_at IS NOT NULL OR p_completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'F2C invalid delete payload' USING ERRCODE='22023';
    END IF;
  ELSIF p_operation='completion_upsert' THEN
    IF p_completed_at IS NULL OR NOT isfinite(p_completed_at)
       OR p_rating IS NOT NULL OR p_last_reviewed_at IS NOT NULL OR p_updated_at IS NOT NULL THEN
      RAISE EXCEPTION 'F2C invalid completion payload' USING ERRCODE='22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'F2C invalid operation' USING ERRCODE='22023';
  END IF;
  v_target := coalesce(p_vocabulary_id::text,p_topic_id);
  v_request := jsonb_build_object('operation',p_operation,'language_code',p_language_code,
    'target',v_target,'expected_version',p_expected_version,'rating',p_rating,
    'last_reviewed_at',p_last_reviewed_at,'updated_at',p_updated_at,'completed_at',p_completed_at);
  SELECT version INTO v_version FROM kg_u4b2b_test_private.f2c_versions
    WHERE owner_id=v_uid AND kind=v_kind AND language_code=p_language_code AND target=v_target;
  v_version := coalesce(v_version,0);
  SELECT request,event_version INTO v_prior,v_event_version
    FROM kg_u4b2b_test_private.f2c_receipts WHERE owner_id=v_uid AND event_id=p_event_id;
  IF FOUND THEN
    IF v_prior IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'F2C event identity conflict' USING ERRCODE='23505';
    END IF;
    -- Historical ACK, not an assertion that its old value is still current.
    RETURN jsonb_build_object('event_id',p_event_id,'event_version',v_event_version,
      'current_version',v_version,'replayed',true);
  END IF;
  IF p_expected_version IS DISTINCT FROM v_version THEN
    RAISE EXCEPTION 'F2C stale progress baseline' USING ERRCODE='40001';
  END IF;
  -- The owner is always the verified auth.uid(), never a supplied user ID.
  IF p_operation='rating_upsert' THEN
    INSERT INTO public.kg_chart_user_ratings
      (user_id,vocabulary_id,language_code,rating,last_reviewed_at,updated_at)
    VALUES(v_uid,p_vocabulary_id,p_language_code,p_rating,p_last_reviewed_at,p_updated_at)
    ON CONFLICT(user_id,vocabulary_id,language_code) DO UPDATE
      SET rating=excluded.rating,last_reviewed_at=excluded.last_reviewed_at,updated_at=excluded.updated_at;
  ELSIF p_operation='rating_delete' THEN
    DELETE FROM public.kg_chart_user_ratings
      WHERE user_id=v_uid AND vocabulary_id=p_vocabulary_id AND language_code=p_language_code;
  ELSE
    INSERT INTO public.kg_chart_topic_completions(user_id,language_code,topic_id,completed_at)
    VALUES(v_uid,p_language_code,p_topic_id,p_completed_at)
    ON CONFLICT(user_id,language_code,topic_id) DO UPDATE SET completed_at=excluded.completed_at;
  END IF;
  v_event_version := v_version+1;
  INSERT INTO kg_u4b2b_test_private.f2c_versions(owner_id,kind,language_code,target,version)
    VALUES(v_uid,v_kind,p_language_code,v_target,v_event_version)
    ON CONFLICT(owner_id,kind,language_code,target) DO UPDATE SET version=excluded.version;
  INSERT INTO kg_u4b2b_test_private.f2c_receipts(owner_id,event_id,request,event_version)
    VALUES(v_uid,p_event_id,v_request,v_event_version);
  RETURN jsonb_build_object('event_id',p_event_id,'event_version',v_event_version,
    'current_version',v_event_version,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.kg_chart_f2_my_progress_state(bigint,text,text,uuid,text),
  public.kg_chart_f2_save_progress(bigint,uuid,bigint,text,text,uuid,text,int,timestamptz,timestamptz,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_my_progress_state(bigint,text,text,uuid,text),
  public.kg_chart_f2_save_progress(bigint,uuid,bigint,text,text,uuid,text,int,timestamptz,timestamptz,timestamptz)
  TO authenticated;
COMMIT;
