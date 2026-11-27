-- F2E2b: server-confirmed topic eligibility and reset chronology.
-- Disposable final fixture only. No production migration or backfill.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;

-- Only newly inserted atomic word/recall sessions receive a receipt.
-- Existing history stays intact; replay of an old session cannot invent one.
CREATE TABLE kg_u4b2b_test_private.f2e2b_path_evidence (
  session_id uuid PRIMARY KEY REFERENCES public.kg_chart_quiz_sessions(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL, language_code text NOT NULL, quiz_type text NOT NULL,
  capture_revision bigint NOT NULL CHECK(capture_revision>0),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  answer_ids uuid[] NOT NULL CHECK(cardinality(answer_ids) BETWEEN 1 AND 500)
);
CREATE TABLE kg_u4b2b_test_private.f2e2b_completion_events (
  owner_id uuid NOT NULL,event_id uuid NOT NULL,permission_revision bigint NOT NULL,
  reset_at timestamptz,evidence_at timestamptz NOT NULL,
  PRIMARY KEY(owner_id,event_id)
);
ALTER TABLE kg_u4b2b_test_private.f2e2b_path_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_u4b2b_test_private.f2e2b_completion_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kg_u4b2b_test_private.f2e2b_path_evidence,
  kg_u4b2b_test_private.f2e2b_completion_events FROM PUBLIC,anon,authenticated,service_role;

-- Global authorization gate -> existing profile -> session/level/record.
-- Serialize new evidence with completion reads and administrative resets.
CREATE FUNCTION kg_u4b2b_test_private.f2e2b_lock_profile(p_revision bigint,p_lang text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE email_id text; mode_id text; rev bigint;
BEGIN
  PERFORM kg_u4b2b_test_private.f2d_lock_shared();
  SELECT lower(u.email) INTO email_id FROM auth.users u JOIN public.kg_chart_users k
    ON k.email=lower(u.email)
    WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL AND k.role='operator';
  IF email_id IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2E2b unverified operator' USING ERRCODE='42501';
  END IF;
  SELECT mode,revision INTO mode_id,rev FROM public.kg_chart_access_profiles
    WHERE email=email_id FOR UPDATE;
  IF NOT FOUND OR mode_id IS DISTINCT FROM 'restricted' OR
    public.kg_chart_u3b1_can_language(p_lang) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2E2b denied path scope' USING ERRCODE='42501';
  END IF;
  IF p_revision IS NULL OR p_revision<1 OR rev IS DISTINCT FROM p_revision THEN
    RAISE EXCEPTION 'F2E2b stale revision' USING ERRCODE='40001';
  END IF;
END $$;

ALTER FUNCTION public.kg_chart_f2_save_recovery_quiz(bigint,jsonb)
  RENAME TO kg_chart_f2e2b_recovery_internal;
ALTER FUNCTION public.kg_chart_f2_save_timed_quiz(bigint,jsonb,jsonb)
  RENAME TO kg_chart_f2e2b_timed_internal;
REVOKE ALL ON FUNCTION public.kg_chart_f2e2b_recovery_internal(bigint,jsonb),
  public.kg_chart_f2e2b_timed_internal(bigint,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION kg_u4b2b_test_private.f2e2b_record_evidence(p_sid uuid,p_revision bigint)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  INSERT INTO kg_u4b2b_test_private.f2e2b_path_evidence
    (session_id,owner_id,language_code,quiz_type,capture_revision,answer_ids)
  SELECT q.id,q.user_id,q.language_code,q.quiz_type,p_revision,
    array_agg(a.id ORDER BY a.id)
  FROM public.kg_chart_quiz_sessions q JOIN public.kg_chart_quiz_answers a ON a.session_id=q.id
  WHERE q.id=p_sid AND q.user_id=auth.uid()
  GROUP BY q.id
  HAVING count(*)=q.total_questions;
$$;

CREATE FUNCTION public.kg_chart_f2_save_recovery_quiz(p_expected_revision bigint,p_draft jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb:=p_draft->'session'; sid uuid; existed boolean; result jsonb;
BEGIN
  IF p_draft->>'kind' IS DISTINCT FROM 'word' THEN
    RETURN public.kg_chart_f2e2b_recovery_internal(p_expected_revision,p_draft);
  END IF;
  PERFORM kg_u4b2b_test_private.f2e2b_lock_profile(p_expected_revision,s->>'language_code');
  sid:=(s->>'id')::uuid;
  SELECT EXISTS(SELECT 1 FROM public.kg_chart_quiz_sessions WHERE id=sid) INTO existed;
  result:=public.kg_chart_f2e2b_recovery_internal(p_expected_revision,p_draft);
  IF NOT existed THEN PERFORM kg_u4b2b_test_private.f2e2b_record_evidence(sid,p_expected_revision); END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.kg_chart_f2_save_timed_quiz(p_expected_revision bigint,p_session jsonb,p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sid uuid; existed boolean; result jsonb;
BEGIN
  IF p_session->>'quiz_type' IS DISTINCT FROM 'typing_recall' THEN
    RETURN public.kg_chart_f2e2b_timed_internal(p_expected_revision,p_session,p_answers);
  END IF;
  PERFORM kg_u4b2b_test_private.f2e2b_lock_profile(p_expected_revision,p_session->>'language_code');
  sid:=(p_session->>'id')::uuid;
  SELECT EXISTS(SELECT 1 FROM public.kg_chart_quiz_sessions WHERE id=sid) INTO existed;
  result:=public.kg_chart_f2e2b_timed_internal(p_expected_revision,p_session,p_answers);
  IF NOT existed THEN PERFORM kg_u4b2b_test_private.f2e2b_record_evidence(sid,p_expected_revision); END IF;
  RETURN result;
END $$;

-- Resolve the same rule fields as KGShared.resolveRules: language override,
-- then global, then defaults. Ignore invalid elements, clamp whole numbers.
CREATE FUNCTION kg_u4b2b_test_private.f2e2b_rules(p_lang text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g jsonb; item jsonb; n numeric; min_n int:=1; types text[];
  allowed constant text[]:=ARRAY['native_to_image','image_to_native','devanagari_to_image',
    'english_to_native','listen_to_image','listen_to_native','word_builder','type_word','typing_recall'];
BEGIN
  SELECT value INTO g FROM public.kg_chart_settings WHERE key='unlock_rules';
  FOREACH item IN ARRAY ARRAY[g#>ARRAY['languages',p_lang,'min_attempts'],g->'min_attempts'] LOOP
    IF jsonb_typeof(item)='number' THEN
      n:=(item#>>'{}')::numeric;
      IF trunc(n)=n THEN min_n:=least(3::numeric,greatest(1::numeric,n))::int; EXIT; END IF;
    END IF;
  END LOOP;
  FOREACH item IN ARRAY ARRAY[g#>ARRAY['languages',p_lang,'quiz_types'],g->'quiz_types'] LOOP
    IF jsonb_typeof(item)='array' THEN
      SELECT array_agg(t ORDER BY first_at) INTO types FROM (
        SELECT v#>>'{}' AS t,min(ord) AS first_at
        FROM jsonb_array_elements(item) WITH ORDINALITY AS x(v,ord)
        WHERE jsonb_typeof(v)='string' AND (v#>>'{}')=ANY(allowed) GROUP BY v#>>'{}'
      ) r;
      IF coalesce(cardinality(types),0)>0 THEN EXIT; END IF;
    END IF;
  END LOOP;
  IF coalesce(cardinality(types),0)=0 THEN types:=allowed[1:6]; END IF;
  RETURN jsonb_build_object('min_attempts',min_n,'quiz_types',types);
END $$;

-- No receipt/backfill for historical sessions. All attempts (right or wrong)
-- count exactly as the existing topic rule, but only whole confirmed sessions
-- whose original timestamps and server confirmation are after the reset.
-- A future client clock is held rather than used as post-reset evidence.
CREATE FUNCTION kg_u4b2b_test_private.f2e2b_counts(p_lang text,p_reset timestamptz,p_asof timestamptz)
RETURNS TABLE(word_id uuid,quiz_type text,n bigint,evidence_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  WITH eligible_sessions AS MATERIALIZED (
    SELECT q.id,q.quiz_type,r.confirmed_at
    FROM kg_u4b2b_test_private.f2e2b_path_evidence r
    JOIN public.kg_chart_quiz_sessions q ON q.id=r.session_id
      AND q.user_id=r.owner_id AND q.language_code=r.language_code AND q.quiz_type=r.quiz_type
    CROSS JOIN LATERAL (
      SELECT count(*) AS n,count(*) FILTER(WHERE a.is_correct) AS good,array_agg(a.id ORDER BY a.id) AS ids,
        bool_and(a.vocabulary_id IS NOT NULL AND a.sentence_id IS NULL AND a.is_correct IS NOT NULL
          AND a.answered_at BETWEEN q.created_at AND q.completed_at
          AND public.kg_chart_u3b2_can_answer(q.id,a.vocabulary_id,a.sentence_id) IS TRUE
          AND public.kg_chart_u3b3b1_can_private_answer(q.id,a.vocabulary_id,a.sentence_id) IS TRUE) AS allowed
      FROM public.kg_chart_quiz_answers a WHERE a.session_id=q.id
    ) checked
    WHERE q.user_id=auth.uid() AND q.language_code=p_lang
      AND q.quiz_type IN ('native_to_image','image_to_native','devanagari_to_image','english_to_native',
        'listen_to_image','listen_to_native','word_builder','type_word','typing_recall')
      AND q.completed_at>=q.created_at AND q.completed_at<=r.confirmed_at
      AND r.confirmed_at<=p_asof
      AND (p_reset IS NULL OR (q.created_at>p_reset AND q.completed_at>p_reset AND r.confirmed_at>p_reset))
      AND public.kg_chart_u3b2_can_quiz_session(p_lang,q.topic_id,q.quiz_type) IS TRUE
      AND public.kg_chart_u3b3b1_can_private_session(p_lang,q.topic_id) IS TRUE
      AND checked.n=q.total_questions AND checked.good=q.correct_answers
      AND checked.ids=r.answer_ids AND checked.allowed IS TRUE
  )
  SELECT a.vocabulary_id,es.quiz_type::text,count(*),max(es.confirmed_at)
    FROM eligible_sessions es JOIN public.kg_chart_quiz_answers a ON a.session_id=es.id
    GROUP BY a.vocabulary_id,es.quiz_type;
$$;

-- Read one coherent, owner-scoped path snapshot. The path control RPC holds
-- the same shared gate/profile lock; completion commits hold it exclusively.
CREATE FUNCTION kg_u4b2b_test_private.f2e2b_snapshot(p_revision bigint,p_lang text,p_asof timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE controls jsonb; rules jsonb; cutoff timestamptz; result jsonb;
BEGIN
  controls:=public.kg_chart_f2_my_path_controls(p_revision,p_lang);
  rules:=kg_u4b2b_test_private.f2e2b_rules(p_lang);
  cutoff:=(controls->>'reset_at')::timestamptz;
  WITH permitted AS MATERIALIZED (
    SELECT t.id::text AS id FROM public.kg_chart_topics t
    WHERE public.kg_chart_u3b1_can_topic(p_lang,t.id) IS TRUE
      AND public.kg_chart_u3b3a_private_topic(p_lang,t.id) IS TRUE
  ), words AS MATERIALIZED (
    SELECT v.id,v.topic_id::text AS topic FROM public.kg_chart_vocabulary v
    JOIN public.kg_chart_vocabulary_translations tr ON tr.vocabulary_id=v.id AND tr.language_code=p_lang
    JOIN permitted p ON p.id=v.topic_id
  ), counts AS MATERIALIZED (
    SELECT * FROM kg_u4b2b_test_private.f2e2b_counts(p_lang,cutoff,p_asof)
  ), required AS (
    SELECT w.topic,w.id,t.value AS quiz_type,coalesce(c.n,0) AS n,c.evidence_at
    FROM words w CROSS JOIN jsonb_array_elements_text(rules->'quiz_types') t
    LEFT JOIN counts c ON c.word_id=w.id AND c.quiz_type=t.value
  ), eligible AS (
    SELECT topic,CASE WHEN bool_and(n>=(rules->>'min_attempts')::int)
      THEN max(evidence_at) END AS eligible_at FROM required GROUP BY topic
  ), topic_rows AS (
    SELECT p.id AS topic_id,coalesce(v.version,0) AS version,c.completed_at,
      CASE WHEN public.kg_chart_u3b2_can_completion(p_lang,p.id) IS TRUE
        AND public.kg_chart_u3b3b1_can_private_session(p_lang,p.id) IS TRUE
        THEN e.eligible_at END AS eligible_at
    FROM permitted p LEFT JOIN eligible e ON e.topic=p.id
    LEFT JOIN public.kg_chart_topic_completions c ON c.user_id=auth.uid()
      AND c.language_code=p_lang AND c.topic_id=p.id
    LEFT JOIN kg_u4b2b_test_private.f2c_versions v ON v.owner_id=auth.uid()
      AND v.kind='completion' AND v.language_code=p_lang AND v.target=p.id
  )
  SELECT jsonb_build_object('rules',rules,
    'topics',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.topic_id) FROM topic_rows t),'[]'::jsonb),
    'counts',coalesce((SELECT jsonb_agg(jsonb_build_object('vocabulary_id',c.word_id,'quiz_type',c.quiz_type,'count',c.n)
      ORDER BY c.word_id,c.quiz_type) FROM counts c JOIN words w ON w.id=c.word_id),'[]'::jsonb))
  INTO result;
  RETURN controls||result;
END $$;

CREATE FUNCTION public.kg_chart_f2_my_completion_path(p_expected_revision bigint,p_lang text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT kg_u4b2b_test_private.f2e2b_snapshot(p_expected_revision,p_lang,clock_timestamp());
$$;

-- The generic F2C timestamp-based completion entry is now internal only.
-- Ratings retain the exact public F2C signature and behavior.
ALTER FUNCTION public.kg_chart_f2_save_progress(bigint,uuid,bigint,text,text,uuid,text,int,timestamptz,timestamptz,timestamptz)
  RENAME TO kg_chart_f2e2b_progress_internal;
REVOKE ALL ON FUNCTION public.kg_chart_f2e2b_progress_internal(bigint,uuid,bigint,text,text,uuid,text,int,timestamptz,timestamptz,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.kg_chart_f2_save_progress(
  p_expected_revision bigint,p_event_id uuid,p_expected_version bigint,p_operation text,
  p_language_code text,p_vocabulary_id uuid,p_topic_id text,p_rating int,
  p_last_reviewed_at timestamptz,p_updated_at timestamptz,p_completed_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN ('rating_upsert','rating_delete') THEN
    RAISE EXCEPTION 'F2E2b completion requires verified evidence endpoint' USING ERRCODE='42501';
  END IF;
  RETURN public.kg_chart_f2e2b_progress_internal(p_expected_revision,p_event_id,p_expected_version,
    p_operation,p_language_code,p_vocabulary_id,p_topic_id,p_rating,p_last_reviewed_at,p_updated_at,p_completed_at);
END $$;

CREATE FUNCTION public.kg_chart_f2_complete_topic(
  p_expected_revision bigint,p_event_id uuid,p_expected_version bigint,p_language_code text,
  p_topic_id text,p_reset_at timestamptz,p_evidence_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE uid uuid; snapshot jsonb; topic jsonb; prior record; result jsonb; cutoff timestamptz;
BEGIN
  uid:=kg_u4b2b_test_private.f2c_lock_scope(p_expected_revision,'completion',p_language_code,NULL,p_topic_id);
  IF p_event_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0
    OR p_evidence_at IS NULL OR NOT isfinite(p_evidence_at) OR p_evidence_at>clock_timestamp()
    OR (p_reset_at IS NOT NULL AND (NOT isfinite(p_reset_at) OR p_evidence_at<=p_reset_at)) THEN
    RAISE EXCEPTION 'F2E2b invalid completion event' USING ERRCODE='22023';
  END IF;
  snapshot:=kg_u4b2b_test_private.f2e2b_snapshot(p_expected_revision,p_language_code,p_evidence_at);
  cutoff:=(snapshot->>'reset_at')::timestamptz;
  IF cutoff IS DISTINCT FROM p_reset_at THEN
    RAISE EXCEPTION 'F2E2b reset cutoff changed' USING ERRCODE='40001';
  END IF;
  SELECT x INTO topic FROM jsonb_array_elements(snapshot->'topics') x WHERE x->>'topic_id'=p_topic_id;
  IF topic IS NULL THEN RAISE EXCEPTION 'F2E2b denied topic' USING ERRCODE='42501'; END IF;
  SELECT * INTO prior FROM kg_u4b2b_test_private.f2e2b_completion_events
    WHERE owner_id=uid AND event_id=p_event_id;
  IF FOUND THEN
    IF prior.permission_revision IS DISTINCT FROM p_expected_revision OR prior.reset_at IS DISTINCT FROM p_reset_at
      OR prior.evidence_at IS DISTINCT FROM p_evidence_at THEN
      RAISE EXCEPTION 'F2E2b completion identity conflict' USING ERRCODE='23505';
    END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM kg_u4b2b_test_private.f2c_receipts WHERE owner_id=uid AND event_id=p_event_id) THEN
      RAISE EXCEPTION 'F2E2b historical event cannot acquire evidence' USING ERRCODE='23505';
    END IF;
    IF (topic->>'version')::bigint IS DISTINCT FROM p_expected_version THEN
      RAISE EXCEPTION 'F2E2b stale completion version' USING ERRCODE='40001';
    END IF;
    IF topic->>'completed_at' IS NOT NULL AND (cutoff IS NULL OR (topic->>'completed_at')::timestamptz>cutoff) THEN
      RAISE EXCEPTION 'F2E2b already completed; refresh' USING ERRCODE='40001';
    END IF;
    IF (topic->>'eligible_at')::timestamptz IS DISTINCT FROM p_evidence_at THEN
      RAISE EXCEPTION 'F2E2b no matching confirmed eligibility' USING ERRCODE='42501';
    END IF;
    INSERT INTO kg_u4b2b_test_private.f2e2b_completion_events VALUES(uid,p_event_id,p_expected_revision,p_reset_at,p_evidence_at);
  END IF;
  -- Use original server evidence time, NOT client or retry time. F2C binds the
  -- event ID, topic, version and timestamp and atomically advances the version.
  result:=public.kg_chart_f2e2b_progress_internal(p_expected_revision,p_event_id,p_expected_version,
    'completion_upsert',p_language_code,NULL,p_topic_id,NULL,NULL,NULL,p_evidence_at);
  RETURN result||jsonb_build_object('owner_id',uid,'language_code',p_language_code,'topic_id',p_topic_id,
    'permission_revision',p_expected_revision,'reset_at',p_reset_at,'completed_at',p_evidence_at);
END $$;

REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2e2b_lock_profile(bigint,text),
  kg_u4b2b_test_private.f2e2b_record_evidence(uuid,bigint),kg_u4b2b_test_private.f2e2b_rules(text),
  kg_u4b2b_test_private.f2e2b_counts(text,timestamptz,timestamptz),
  kg_u4b2b_test_private.f2e2b_snapshot(bigint,text,timestamptz),
  public.kg_chart_f2_save_recovery_quiz(bigint,jsonb),public.kg_chart_f2_save_timed_quiz(bigint,jsonb,jsonb),
  public.kg_chart_f2_my_completion_path(bigint,text),
  public.kg_chart_f2_save_progress(bigint,uuid,bigint,text,text,uuid,text,int,timestamptz,timestamptz,timestamptz),
  public.kg_chart_f2_complete_topic(bigint,uuid,bigint,text,text,timestamptz,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_save_recovery_quiz(bigint,jsonb),
  public.kg_chart_f2_save_timed_quiz(bigint,jsonb,jsonb),public.kg_chart_f2_my_completion_path(bigint,text),
  public.kg_chart_f2_save_progress(bigint,uuid,bigint,text,text,uuid,text,int,timestamptz,timestamptz,timestamptz),
  public.kg_chart_f2_complete_topic(bigint,uuid,bigint,text,text,timestamptz,timestamptz) TO authenticated;
COMMIT;
