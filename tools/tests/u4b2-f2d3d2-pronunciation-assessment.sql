-- F2D3D2: pronunciation authorization and assessment receipts.
-- Disposable fixture only; not a production migration or deployed Edge change.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;

-- Model the fields written by kg-pronounce/core.ts, plus stable request ID.
-- Raw WAV data is never stored. The existing fixture has no attempts table.
CREATE TABLE public.kg_chart_pronunciation_attempts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  language_code text NOT NULL,
  vocabulary_id uuid,
  sentence_id uuid,
  source text NOT NULL,
  reference_text text NOT NULL,
  score integer NOT NULL CHECK(score BETWEEN 0 AND 100),
  accuracy integer CHECK(accuracy BETWEEN 0 AND 100),
  fluency integer CHECK(fluency BETWEEN 0 AND 100),
  completeness integer CHECK(completeness BETWEEN 0 AND 100),
  words jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((vocabulary_id IS NOT NULL)::int+(sentence_id IS NOT NULL)::int=1)
);
ALTER TABLE public.kg_chart_pronunciation_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kg_chart_pronunciation_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.kg_chart_pronunciation_attempts TO authenticated;
CREATE POLICY f2d3d2_attempt_owner ON public.kg_chart_pronunciation_attempts
  FOR SELECT TO authenticated USING (
    auth.uid() IS NOT NULL AND public.kg_chart_is_allowed() IS TRUE
    AND (user_id=auth.uid() OR public.kg_chart_is_admin() IS TRUE)
    AND public.kg_chart_u3b2_can_pronounce(language_code,reference_text,vocabulary_id,sentence_id,source) IS TRUE
  );

-- Private ticket binds the authorization snapshot, resource and audio digest.
-- No score is accepted from a learner. The digest detects changed input on
-- retry; retention and eventual deletion rules require lifecycle review.
CREATE TABLE kg_u4b2b_test_private.f2d3d2_pronunciation_tickets (
  request_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  owner_email text NOT NULL,
  revision bigint NOT NULL,
  language_code text NOT NULL,
  reference_text text NOT NULL,
  vocabulary_id uuid,
  sentence_id uuid,
  source text NOT NULL,
  audio_sha256 text NOT NULL CHECK(audio_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK(state IN ('running','saved','failed','no_speech')),
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE kg_u4b2b_test_private.f2d3d2_pronunciation_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kg_u4b2b_test_private.f2d3d2_pronunciation_tickets FROM PUBLIC,anon,authenticated,service_role;

-- Daily limit edits participate in the same global publication protocol as
-- private rules and unlock rules. In-flight tickets cannot outlive a changed
-- authorization revision. Retain the existing statement-level source locks.
CREATE OR REPLACE FUNCTION kg_u4b2b_test_private.f2d_publish_edit()
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
      v_sensitive := OLD.key IN ('private_lessons','unlock_rules','pronunciation_daily_limit');
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_sensitive := v_sensitive OR NEW.key IN ('private_lessons','unlock_rules','pronunciation_daily_limit');
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


REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d_publish_edit()
  FROM PUBLIC,anon,authenticated,service_role;

-- Global gate -> verified identity/allowlist row -> profile -> per-user
-- reservation lock. Service finalization derives authority from the
-- previously verified ticket, not a synthetic impersonation of auth.uid().
CREATE FUNCTION kg_u4b2b_test_private.f2d3d2_lock_identity(p_owner uuid,p_revision bigint)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE email_id text; profile_mode text; current_revision bigint;
BEGIN
  IF p_owner IS NULL THEN
    RAISE EXCEPTION 'F2D3D2 missing owner' USING ERRCODE='42501';
  END IF;
  IF p_revision IS NULL OR p_revision<1 THEN
    RAISE EXCEPTION 'F2D3D2 revision required' USING ERRCODE='40001';
  END IF;
  PERFORM kg_u4b2b_test_private.f2d_lock_shared();
  SELECT lower(u.email) INTO email_id FROM auth.users u
    JOIN public.kg_chart_users k ON k.email=lower(u.email)
    WHERE u.id=p_owner AND u.email_confirmed_at IS NOT NULL AND k.role='operator'
    FOR SHARE OF u,k;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'F2D3D2 unverified operator' USING ERRCODE='42501';
  END IF;
  SELECT mode,revision INTO profile_mode,current_revision FROM public.kg_chart_access_profiles
    WHERE email=email_id FOR SHARE;
  IF NOT FOUND OR profile_mode IS DISTINCT FROM 'restricted' THEN
    RAISE EXCEPTION 'F2D3D2 existing restricted profile required' USING ERRCODE='42501';
  END IF;
  IF current_revision IS DISTINCT FROM p_revision THEN
    RAISE EXCEPTION 'F2D3D2 stale permission revision' USING ERRCODE='40001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('kg-pronounce:'||p_owner::text,0));
  RETURN email_id;
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d3d2_lock_identity(uuid,bigint)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION kg_u4b2b_test_private.f2d3d2_usage(p_owner uuid,p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE v jsonb; lim integer:=100; used bigint; reserved bigint; day_start timestamptz;
BEGIN
  SELECT value INTO v FROM public.kg_chart_settings WHERE key='pronunciation_daily_limit';
  IF jsonb_typeof(v)='number' AND (v#>>'{}') ~ '^[1-9][0-9]{0,3}$' THEN
    lim := (v#>>'{}')::integer;
  END IF;
  day_start := date_trunc('day',p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  SELECT count(*) INTO used FROM public.kg_chart_pronunciation_attempts
    WHERE user_id=p_owner AND created_at>=day_start;
  -- Count active reservations even across UTC midnight. No-speech and
  -- known failed checks are released; unknown outcomes expire naturally.
  SELECT count(*) INTO reserved FROM kg_u4b2b_test_private.f2d3d2_pronunciation_tickets
    WHERE owner_id=p_owner AND state='running' AND expires_at>p_at;
  RETURN jsonb_build_object('used',used,'reserved',reserved,'limit',lim);
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d3d2_usage(uuid,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION kg_u4b2b_test_private.f2d3d2_result(p_id uuid,p_owner uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('score',score,'accuracy',accuracy,'fluency',fluency,
    'completeness',completeness,'words',words)
  FROM public.kg_chart_pronunciation_attempts WHERE id=p_id AND user_id=p_owner;
$$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d3d2_result(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- User-bound authorization phase. Only a NEW reservation authorizes one
-- Edge provider operation. Replays return pending/terminal status, never
-- another start. An authenticated direct caller can reserve only their own
-- permitted check, cannot finalize or submit a provider score.
CREATE FUNCTION public.kg_chart_f2_begin_pronunciation(
  p_expected_revision bigint,p_request_id uuid,p_lang text,p_text text,
  p_vocabulary_id uuid,p_sentence_id uuid,p_source text,p_audio_sha256 text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  uid uuid:=auth.uid(); email_id text; t kg_u4b2b_test_private.f2d3d2_pronunciation_tickets%ROWTYPE;
  at_now timestamptz; usage jsonb; result jsonb; st text;
BEGIN
  IF uid IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3D2 unauthenticated learner' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR p_lang IS NULL OR p_text IS NULL OR btrim(p_text)=''
     OR char_length(p_text)>300 OR p_audio_sha256 IS NULL OR p_audio_sha256 !~ '^[0-9a-f]{64}$'
     OR p_source IS NULL OR NOT ((p_source='word' AND p_vocabulary_id IS NOT NULL AND p_sentence_id IS NULL)
       OR (p_source='speak_lines' AND p_sentence_id IS NOT NULL AND p_vocabulary_id IS NULL)) THEN
    RAISE EXCEPTION 'F2D3D2 invalid reference' USING ERRCODE='22023';
  END IF;
  email_id:=kg_u4b2b_test_private.f2d3d2_lock_identity(uid,p_expected_revision);
  IF public.kg_chart_u3b2_can_pronounce(p_lang,p_text,p_vocabulary_id,p_sentence_id,p_source) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3D2 denied pronunciation scope' USING ERRCODE='42501';
  END IF;
  at_now:=clock_timestamp();
  SELECT * INTO t FROM kg_u4b2b_test_private.f2d3d2_pronunciation_tickets
    WHERE request_id=p_request_id FOR UPDATE;
  usage:=kg_u4b2b_test_private.f2d3d2_usage(uid,at_now);
  IF FOUND THEN
    -- Do not disclose another owner's reservation or saved score.
    IF t.owner_id IS DISTINCT FROM uid OR t.owner_email IS DISTINCT FROM email_id
       OR t.language_code IS DISTINCT FROM p_lang OR t.reference_text IS DISTINCT FROM p_text
       OR t.vocabulary_id IS DISTINCT FROM p_vocabulary_id OR t.sentence_id IS DISTINCT FROM p_sentence_id
       OR t.source IS DISTINCT FROM p_source OR t.audio_sha256 IS DISTINCT FROM p_audio_sha256 THEN
      RAISE EXCEPTION 'F2D3D2 request identity conflict' USING ERRCODE='23505';
    END IF;
    IF t.revision IS DISTINCT FROM p_expected_revision THEN
      RAISE EXCEPTION 'F2D3D2 historical revision requires reconciliation' USING ERRCODE='40001';
    END IF;
    st:=CASE WHEN t.state='running' AND t.expires_at<=at_now THEN 'expired'
             WHEN t.state='running' THEN 'pending' ELSE t.state END;
    IF st='saved' THEN
      result:=kg_u4b2b_test_private.f2d3d2_result(p_request_id,uid);
      IF result IS NULL THEN
        RAISE EXCEPTION 'F2D3D2 missing saved receipt' USING ERRCODE='23505';
      END IF;
    END IF;
    RETURN usage||jsonb_build_object('request_id',p_request_id,'status',st,'result',result);
  END IF;
  IF EXISTS(SELECT 1 FROM public.kg_chart_pronunciation_attempts WHERE id=p_request_id) THEN
    RAISE EXCEPTION 'F2D3D2 historical request collision' USING ERRCODE='23505';
  END IF;
  IF (usage->>'used')::bigint+(usage->>'reserved')::bigint >= (usage->>'limit')::integer THEN
    RETURN usage||jsonb_build_object('request_id',p_request_id,'status','limit','result',NULL);
  END IF;
  INSERT INTO kg_u4b2b_test_private.f2d3d2_pronunciation_tickets
    (request_id,owner_id,owner_email,revision,language_code,reference_text,vocabulary_id,sentence_id,
     source,audio_sha256,state,started_at,expires_at)
  VALUES(p_request_id,uid,email_id,p_expected_revision,p_lang,p_text,p_vocabulary_id,p_sentence_id,
    p_source,p_audio_sha256,'running',at_now,at_now+interval '3 minutes')
  ON CONFLICT(request_id) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'F2D3D2 concurrent request identity conflict' USING ERRCODE='23505';
  END IF;
  RETURN kg_u4b2b_test_private.f2d3d2_usage(uid,at_now)||
    jsonb_build_object('request_id',p_request_id,'status','start','result',NULL);
END $$;
REVOKE ALL ON FUNCTION public.kg_chart_f2_begin_pronunciation(bigint,uuid,text,text,uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_begin_pronunciation(bigint,uuid,text,text,uuid,uuid,text,text) TO authenticated;

CREATE FUNCTION kg_u4b2b_test_private.f2d3d2_score_valid(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text; x jsonb;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>131072 THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) key WHERE key NOT IN ('score','accuracy','fluency','completeness','words'))
     OR NOT (p ?& ARRAY['score','accuracy','fluency','completeness','words']) THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['score','accuracy','fluency','completeness'] LOOP
    x:=p->k;
    IF x='null'::jsonb AND k<>'score' THEN CONTINUE; END IF;
    IF jsonb_typeof(x) IS DISTINCT FROM 'number' OR (x#>>'{}') !~ '^(0|[1-9][0-9]?|100)$' THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_typeof(p->'words') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p->'words')>1000 THEN RETURN false; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(p->'words') LOOP
    IF jsonb_typeof(x) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(x) key WHERE key NOT IN ('w','accuracy','error'))
       OR NOT (x ?& ARRAY['w','accuracy','error'])
       OR jsonb_typeof(x->'w') IS DISTINCT FROM 'string'
       OR jsonb_typeof(x->'error') IS DISTINCT FROM 'string'
       OR char_length(x->>'w')>300 OR char_length(x->>'error')>64 THEN RETURN false; END IF;
    IF x->'accuracy'<>'null'::jsonb AND (jsonb_typeof(x->'accuracy') IS DISTINCT FROM 'number'
        OR (x->>'accuracy') !~ '^(0|[1-9][0-9]?|100)$') THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d3d2_score_valid(jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

-- The score-writing endpoint is service-only. The Edge adapter supplies
-- the identity obtained from verified Auth, never a browser owner/score.
-- The same revision is rechecked under the global/profile/reservation locks.
-- Content and grant edits must publish revisions; identity lifecycle remains F3.
CREATE FUNCTION public.kg_chart_f2_finish_pronunciation(
  p_owner uuid,p_expected_revision bigint,p_request_id uuid,p_state text,p_result jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  email_id text; at_now timestamptz;
  t kg_u4b2b_test_private.f2d3d2_pronunciation_tickets%ROWTYPE;
  saved_result jsonb;
BEGIN
  IF p_request_id IS NULL OR p_state IS NULL OR p_state NOT IN ('saved','no_speech','failed')
     OR (p_state='saved' AND kg_u4b2b_test_private.f2d3d2_score_valid(p_result) IS DISTINCT FROM true)
     OR (p_state<>'saved' AND p_result IS NOT NULL) THEN
    RAISE EXCEPTION 'F2D3D2 invalid assessment result' USING ERRCODE='22023';
  END IF;
  email_id:=kg_u4b2b_test_private.f2d3d2_lock_identity(p_owner,p_expected_revision);
  at_now:=clock_timestamp();
  SELECT * INTO t FROM kg_u4b2b_test_private.f2d3d2_pronunciation_tickets
    WHERE request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR t.owner_id IS DISTINCT FROM p_owner OR t.owner_email IS DISTINCT FROM email_id THEN
    RAISE EXCEPTION 'F2D3D2 unknown or foreign reservation' USING ERRCODE='42501';
  END IF;
  IF t.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'F2D3D2 stale reservation' USING ERRCODE='40001';
  END IF;
  IF t.state='running' THEN
    IF t.expires_at<=at_now THEN
      RAISE EXCEPTION 'F2D3D2 expired reservation' USING ERRCODE='22023';
    END IF;
    IF p_state='saved' THEN
      INSERT INTO public.kg_chart_pronunciation_attempts
        (id,user_id,language_code,vocabulary_id,sentence_id,source,reference_text,score,accuracy,
         fluency,completeness,words,created_at)
      VALUES(p_request_id,p_owner,t.language_code,t.vocabulary_id,t.sentence_id,t.source,t.reference_text,
        (p_result->>'score')::integer,(p_result->>'accuracy')::integer,(p_result->>'fluency')::integer,
        (p_result->>'completeness')::integer,p_result->'words',at_now);
    END IF;
    UPDATE kg_u4b2b_test_private.f2d3d2_pronunciation_tickets SET state=p_state WHERE request_id=p_request_id;
  ELSIF t.state IS DISTINCT FROM p_state THEN
    RAISE EXCEPTION 'F2D3D2 terminal outcome conflict' USING ERRCODE='23505';
  END IF;
  IF p_state='saved' THEN
    saved_result:=kg_u4b2b_test_private.f2d3d2_result(p_request_id,p_owner);
    IF saved_result IS DISTINCT FROM p_result THEN
      RAISE EXCEPTION 'F2D3D2 score receipt conflict' USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN kg_u4b2b_test_private.f2d3d2_usage(p_owner,at_now)||
    jsonb_build_object('request_id',p_request_id,'status',p_state,'result',saved_result);
END $$;
REVOKE ALL ON FUNCTION public.kg_chart_f2_finish_pronunciation(uuid,bigint,uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_finish_pronunciation(uuid,bigint,uuid,text,jsonb) TO service_role;
COMMIT;
