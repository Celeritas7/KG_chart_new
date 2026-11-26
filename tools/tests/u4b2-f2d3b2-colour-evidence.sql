-- F2D3B2: isolated candidate, never install on hosted infrastructure.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;

-- New restricted colour runs require explicit evidence. Historical summary
-- rows are not backfilled. Retain immutable IDs even if a phrase is later
-- edited or removed; no content text is stored here. Existing score/progress
-- readers still use the ordinary session table; colour is not word strength.
CREATE TABLE kg_u4b2b_test_private.f2d3b2_colour_receipts (
  session_id uuid PRIMARY KEY REFERENCES public.kg_chart_quiz_sessions(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK(mode IN ('phrase_to_picture','listen_to_picture','picture_to_phrase')),
  questions jsonb NOT NULL CHECK(jsonb_typeof(questions)='array')
);
REVOKE ALL ON TABLE kg_u4b2b_test_private.f2d3b2_colour_receipts
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.kg_chart_f2_save_colour_quiz(
  p_expected_revision bigint,p_session jsonb,p_mode text,p_questions jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  email_id text;
  profile_mode text;
  rev bigint;
  s public.kg_chart_quiz_sessions%ROWTYPE;
  item jsonb;
  phrase_id uuid;
  choice_id uuid;
  option_id uuid;
  options uuid[];
  seen uuid[] := ARRAY[]::uuid[];
  at_time timestamptz;
  correct_count int := 0;
  normalized jsonb := '[]'::jsonb;
  inserted uuid;
BEGIN
  IF uid IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3B2 unverified learner' USING ERRCODE='42501';
  END IF;
  SELECT lower(u.email) INTO email_id FROM auth.users u
    JOIN public.kg_chart_users k ON k.email=lower(u.email)
    WHERE u.id=uid AND u.email_confirmed_at IS NOT NULL AND k.role='operator';
  IF email_id IS NULL THEN
    RAISE EXCEPTION 'F2D3B2 unverified operator' USING ERRCODE='42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision<1 THEN
    RAISE EXCEPTION 'F2D3B2 revision required' USING ERRCODE='40001';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('phrase_to_picture','listen_to_picture','picture_to_phrase')
    OR jsonb_typeof(p_session) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_questions) IS DISTINCT FROM 'array'
    OR octet_length(p_session::text)>8192 OR octet_length(p_questions::text)>2097152 THEN
    RAISE EXCEPTION 'F2D3B2 malformed payload' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_session) k WHERE k NOT IN
    ('id','user_id','language_code','topic_id','quiz_type','total_questions',
     'correct_answers','time_spent_seconds','created_at','completed_at'))
    OR EXISTS (SELECT 1 FROM unnest(ARRAY['id','user_id','language_code','quiz_type',
      'created_at','completed_at']) k WHERE jsonb_typeof(p_session->k) IS DISTINCT FROM 'string')
    OR EXISTS (SELECT 1 FROM unnest(ARRAY['total_questions','correct_answers',
      'time_spent_seconds']) k WHERE jsonb_typeof(p_session->k) IS DISTINCT FROM 'number'
      OR (p_session->>k) !~ '^(0|[1-9][0-9]*)$')
    OR (p_session ? 'topic_id' AND p_session->'topic_id' IS DISTINCT FROM 'null'::jsonb) THEN
    RAISE EXCEPTION 'F2D3B2 invalid session fields' USING ERRCODE='22023';
  END IF;
  SELECT * INTO s FROM jsonb_populate_record(NULL::public.kg_chart_quiz_sessions,p_session);
  IF s.user_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'F2D3B2 wrong owner' USING ERRCODE='42501';
  END IF;
  IF s.quiz_type IS DISTINCT FROM 'colour_phrase'
    OR s.total_questions NOT BETWEEN 1 AND 500
    OR s.correct_answers NOT BETWEEN 0 AND s.total_questions
    OR jsonb_array_length(p_questions)<>s.total_questions
    OR s.time_spent_seconds<0 OR NOT isfinite(s.created_at) OR NOT isfinite(s.completed_at)
    OR s.completed_at<s.created_at THEN
    RAISE EXCEPTION 'F2D3B2 invalid colour session' USING ERRCODE='22023';
  END IF;

  -- All permission-changing content/catalog/rule edits share this gate.
  -- Lock profile before any quiz records. Recheck even exact retries.
  PERFORM kg_u4b2b_test_private.f2d_lock_shared();
  SELECT mode,revision INTO profile_mode,rev FROM public.kg_chart_access_profiles
    WHERE email=email_id FOR SHARE;
  IF NOT FOUND OR profile_mode IS DISTINCT FROM 'restricted'
    OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3B2 existing restricted profile required' USING ERRCODE='42501';
  END IF;
  IF rev IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'F2D3B2 stale permission revision' USING ERRCODE='40001';
  END IF;
  IF public.kg_chart_u3b2_can_quiz_session(s.language_code,NULL,s.quiz_type) IS DISTINCT FROM true
    OR public.kg_chart_u3b3b1_can_private_session(s.language_code,NULL) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3B2 denied session scope' USING ERRCODE='42501';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_questions) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'F2D3B2 invalid question' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN
        ('phrase_id','selected_phrase_id','option_ids','answered_at'))
      OR EXISTS (SELECT 1 FROM unnest(ARRAY['phrase_id','selected_phrase_id','answered_at']) k
        WHERE jsonb_typeof(item->k) IS DISTINCT FROM 'string')
      OR jsonb_typeof(item->'option_ids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'F2D3B2 invalid evidence fields' USING ERRCODE='22023';
    END IF;
    IF jsonb_array_length(item->'option_ids') NOT BETWEEN 1 AND 4
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(item->'option_ids') v
        WHERE jsonb_typeof(v) IS DISTINCT FROM 'string') THEN
      RAISE EXCEPTION 'F2D3B2 invalid option list' USING ERRCODE='22023';
    END IF;
    phrase_id := (item->>'phrase_id')::uuid;
    choice_id := (item->>'selected_phrase_id')::uuid;
    at_time := (item->>'answered_at')::timestamptz;
    SELECT array_agg(value::uuid ORDER BY ordinality) INTO options
      FROM jsonb_array_elements_text(item->'option_ids') WITH ORDINALITY;
    IF phrase_id=ANY(seen) OR NOT (phrase_id=ANY(options)) OR NOT (choice_id=ANY(options))
      OR cardinality(options)<>(SELECT count(DISTINCT x) FROM unnest(options) x)
      OR NOT isfinite(at_time) OR at_time<s.created_at OR at_time>s.completed_at THEN
      RAISE EXCEPTION 'F2D3B2 inconsistent question evidence' USING ERRCODE='22023';
    END IF;
    -- Verify the target, the selected phrase AND every claimed distractor.
    -- Both vocabulary topics/translations and old private rules must allow
    -- each current same-language phrase; existence alone is insufficient.
    FOREACH option_id IN ARRAY options LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.kg_chart_colour_phrases c
        WHERE c.id=option_id AND c.language_code=s.language_code
          AND nullif(btrim(c.native_text),'') IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.kg_chart_vocabulary_translations vt
            WHERE vt.vocabulary_id=c.colour_id AND vt.language_code=s.language_code)
          AND EXISTS (SELECT 1 FROM public.kg_chart_vocabulary_translations vt
            WHERE vt.vocabulary_id=c.noun_id AND vt.language_code=s.language_code)
          AND public.kg_chart_u3b1_can_colour_phrase(c.language_code,c.colour_id,c.noun_id) IS TRUE
          AND public.kg_chart_u3b3a_private_colour(c.language_code,c.colour_id,c.noun_id) IS TRUE
      ) THEN
        RAISE EXCEPTION 'F2D3B2 denied phrase scope' USING ERRCODE='42501';
      END IF;
    END LOOP;
    seen := array_append(seen,phrase_id);
    IF phrase_id=choice_id THEN correct_count := correct_count+1; END IF;
    normalized := normalized || jsonb_build_array(jsonb_build_object(
      'phrase_id',phrase_id,'selected_phrase_id',choice_id,
      'option_ids',options,'answered_at',at_time));
  END LOOP;
  IF correct_count<>s.correct_answers THEN
    RAISE EXCEPTION 'F2D3B2 inconsistent derived score' USING ERRCODE='22023';
  END IF;

  -- Session and private evidence are atomic. A summary predating this
  -- candidate cannot acquire invented evidence even if all fields match.
  INSERT INTO public.kg_chart_quiz_sessions
    (id,user_id,language_code,topic_id,quiz_type,total_questions,correct_answers,
     created_at,completed_at,time_spent_seconds)
  VALUES(s.id,uid,s.language_code,NULL,s.quiz_type,s.total_questions,s.correct_answers,
     s.created_at,s.completed_at,s.time_spent_seconds)
  ON CONFLICT(id) DO NOTHING RETURNING id INTO inserted;
  PERFORM 1 FROM public.kg_chart_quiz_sessions q
    WHERE q.id=s.id AND q.user_id=uid AND q.language_code=s.language_code
      AND q.topic_id IS NULL AND q.quiz_type=s.quiz_type
      AND q.total_questions=s.total_questions AND q.correct_answers=s.correct_answers
      AND q.created_at=s.created_at AND q.completed_at=s.completed_at
      AND q.time_spent_seconds=s.time_spent_seconds
      AND q.difficulty IS NULL AND q.quiz_level IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'F2D3B2 session identity conflict' USING ERRCODE='23505';
  END IF;
  IF inserted IS NOT NULL THEN
    INSERT INTO kg_u4b2b_test_private.f2d3b2_colour_receipts(session_id,mode,questions)
      VALUES(s.id,p_mode,normalized);
  ELSIF NOT EXISTS (
    SELECT 1 FROM kg_u4b2b_test_private.f2d3b2_colour_receipts r
    WHERE r.session_id=s.id AND r.mode=p_mode AND r.questions=normalized
  ) THEN
    RAISE EXCEPTION 'F2D3B2 unknown or conflicting historical evidence' USING ERRCODE='23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kg_chart_quiz_answers WHERE session_id=s.id) THEN
    RAISE EXCEPTION 'F2D3B2 unexpected ordinary answers' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('session_id',s.id,'question_count',s.total_questions,
    'correct_answers',correct_count,'expected_revision',p_expected_revision,
    'time_spent_seconds',s.time_spent_seconds);
END $$;
REVOKE ALL ON FUNCTION public.kg_chart_f2_save_colour_quiz(bigint,jsonb,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_save_colour_quiz(bigint,jsonb,text,jsonb) TO authenticated;
COMMIT;
