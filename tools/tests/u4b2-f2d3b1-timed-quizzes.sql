-- F2D3B1 candidate: timed typing and speaking quizzes, isolated fixture only.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;
-- The existing timed quiz producers already send this column. Do not infer
-- a duration for historical rows lacking it.
ALTER TABLE public.kg_chart_quiz_sessions ADD COLUMN time_spent_seconds integer;

CREATE FUNCTION public.kg_chart_f2_save_timed_quiz(
  p_expected_revision bigint,p_session jsonb,p_answers jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE
  uid uuid := auth.uid();
  email_id text;
  profile_mode text;
  rev bigint;
  s public.kg_chart_quiz_sessions%ROWTYPE;
  a public.kg_chart_quiz_answers%ROWTYPE;
  item jsonb;
  saved uuid;
  ids uuid[] := ARRAY[]::uuid[];
  tally integer := 0;
  actual_count integer;
  typing boolean;
BEGIN
  IF uid IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3B1 unverified learner' USING ERRCODE='42501';
  END IF;
  SELECT lower(u.email) INTO email_id FROM auth.users u
    JOIN public.kg_chart_users k ON k.email=lower(u.email)
    WHERE u.id=uid AND u.email_confirmed_at IS NOT NULL AND k.role='operator';
  IF email_id IS NULL THEN
    RAISE EXCEPTION 'F2D3B1 unverified operator' USING ERRCODE='42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision<1 THEN
    RAISE EXCEPTION 'F2D3B1 revision required' USING ERRCODE='40001';
  END IF;
  IF jsonb_typeof(p_session) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_answers) IS DISTINCT FROM 'array'
    OR octet_length(p_session::text)>8192 OR octet_length(p_answers::text)>2097152 THEN
    RAISE EXCEPTION 'F2D3B1 malformed payload' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_session) k WHERE k NOT IN
    ('id','user_id','language_code','topic_id','quiz_type','total_questions',
     'correct_answers','time_spent_seconds','created_at','completed_at'))
    OR EXISTS (SELECT 1 FROM unnest(ARRAY['id','user_id','language_code','quiz_type',
      'created_at','completed_at']) k WHERE jsonb_typeof(p_session->k) IS DISTINCT FROM 'string')
    OR EXISTS (SELECT 1 FROM unnest(ARRAY['total_questions','correct_answers',
      'time_spent_seconds']) k WHERE jsonb_typeof(p_session->k) IS DISTINCT FROM 'number'
      OR (p_session->>k) !~ '^(0|[1-9][0-9]*)$')
    OR (p_session ? 'topic_id' AND jsonb_typeof(p_session->'topic_id') NOT IN ('string','null')) THEN
    RAISE EXCEPTION 'F2D3B1 invalid session fields' USING ERRCODE='22023';
  END IF;
  SELECT * INTO s FROM jsonb_populate_record(NULL::public.kg_chart_quiz_sessions,p_session);
  IF s.user_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'F2D3B1 wrong owner' USING ERRCODE='42501';
  END IF;
  IF s.quiz_type NOT IN ('typing_copy','typing_recall','speak_lines','speak_paragraph')
    OR s.total_questions NOT BETWEEN 1 AND 500
    OR s.correct_answers NOT BETWEEN 0 AND s.total_questions
    OR jsonb_array_length(p_answers)<>s.total_questions
    OR s.time_spent_seconds<0 OR NOT isfinite(s.created_at) OR NOT isfinite(s.completed_at)
    OR s.completed_at<s.created_at THEN
    RAISE EXCEPTION 'F2D3B1 invalid timed session' USING ERRCODE='22023';
  END IF;
  typing := s.quiz_type IN ('typing_copy','typing_recall');
  -- Same shared authorization gate and profile-before-data lock order as F2A.
  PERFORM kg_u4b2b_test_private.f2d_lock_shared();
  SELECT mode,revision INTO profile_mode,rev FROM public.kg_chart_access_profiles
    WHERE email=email_id FOR SHARE;
  IF NOT FOUND OR profile_mode IS DISTINCT FROM 'restricted'
    OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3B1 existing restricted profile required' USING ERRCODE='42501';
  END IF;
  IF rev IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'F2D3B1 stale permission revision' USING ERRCODE='40001';
  END IF;
  IF public.kg_chart_u3b2_can_quiz_session(s.language_code,s.topic_id,s.quiz_type) IS DISTINCT FROM true
    OR public.kg_chart_u3b3b1_can_private_session(s.language_code,s.topic_id) IS DISTINCT FROM true
    OR public.kg_chart_u3c2_can_sentence_session(s.language_code,s.topic_id,s.quiz_type) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3B1 denied session scope' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.kg_chart_quiz_sessions
    (id,user_id,language_code,topic_id,quiz_type,total_questions,correct_answers,
     created_at,completed_at,time_spent_seconds)
  VALUES(s.id,uid,s.language_code,s.topic_id,s.quiz_type,s.total_questions,s.correct_answers,
     s.created_at,s.completed_at,s.time_spent_seconds)
  ON CONFLICT(id) DO NOTHING;
  -- Exact immutable session replay. A historical unknown duration cannot
  -- silently become a new asserted duration. Lock before answer mutations.
  PERFORM 1 FROM public.kg_chart_quiz_sessions q WHERE q.id=s.id AND q.user_id=uid
    AND q.language_code=s.language_code AND q.topic_id IS NOT DISTINCT FROM s.topic_id
    AND q.quiz_type=s.quiz_type AND q.total_questions=s.total_questions
    AND q.correct_answers=s.correct_answers AND q.created_at=s.created_at
    AND q.completed_at=s.completed_at AND q.time_spent_seconds=s.time_spent_seconds
    AND q.difficulty IS NULL AND q.quiz_level IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'F2D3B1 session identity conflict' USING ERRCODE='23505';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_answers) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'F2D3B1 invalid answer object' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN
        ('id','session_id','vocabulary_id','sentence_id','selected_vocabulary_id',
         'is_correct','answer_text','answered_at'))
      OR EXISTS (SELECT 1 FROM unnest(ARRAY['id','session_id','answered_at']) k
          WHERE jsonb_typeof(item->k) IS DISTINCT FROM 'string')
      OR jsonb_typeof(item->'is_correct') IS DISTINCT FROM 'boolean'
      OR EXISTS (SELECT 1 FROM jsonb_each(item) e WHERE e.key<>'is_correct'
          AND jsonb_typeof(e.value) NOT IN ('string','null')) THEN
      RAISE EXCEPTION 'F2D3B1 invalid answer fields' USING ERRCODE='22023';
    END IF;
    SELECT * INTO a FROM jsonb_populate_record(NULL::public.kg_chart_quiz_answers,item);
    IF a.session_id IS DISTINCT FROM s.id OR a.id=s.id OR a.id=ANY(ids)
      OR NOT isfinite(a.answered_at) THEN
      RAISE EXCEPTION 'F2D3B1 invalid answer identity' USING ERRCODE='22023';
    END IF;
    IF typing THEN
      -- Restricted typing is word-only in the actual learner UI. A completed
      -- word can have is_correct=false in copy mode (first attempt was wrong).
      IF a.vocabulary_id IS NULL OR a.sentence_id IS NOT NULL THEN
        RAISE EXCEPTION 'F2D3B1 restricted typing requires a word' USING ERRCODE='42501';
      END IF;
      IF (a.selected_vocabulary_id IS NOT NULL AND a.selected_vocabulary_id<>a.vocabulary_id::text)
         OR (a.is_correct AND a.selected_vocabulary_id IS NULL)
         OR (s.quiz_type='typing_recall' AND a.is_correct IS DISTINCT FROM
           (a.selected_vocabulary_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'F2D3B1 inconsistent typing result' USING ERRCODE='22023';
      END IF;
      IF a.selected_vocabulary_id IS NOT NULL THEN tally := tally+1; END IF;
    ELSE
      IF a.sentence_id IS NULL OR a.vocabulary_id IS NOT NULL
         OR a.selected_vocabulary_id IS NOT NULL OR a.answer_text IS NOT NULL THEN
        RAISE EXCEPTION 'F2D3B1 invalid speaking result' USING ERRCODE='22023';
      END IF;
      IF a.is_correct THEN tally := tally+1; END IF;
      -- In topic-specific future requests bind every sentence to that topic.
      IF NOT EXISTS (
        SELECT 1 FROM public.kg_chart_sentences st
        JOIN public.kg_chart_sentence_group_topic_map m
          ON m.language_code=st.language_code AND m.group_name=st.group_name
        WHERE st.id=a.sentence_id AND st.language_code=s.language_code
          AND m.review_status='verified' AND m.reviewed_by IS NOT NULL
          AND m.reviewed_at IS NOT NULL AND m.evidence_sha256 IS NOT NULL
          AND (s.topic_id IS NULL OR m.topic_id=s.topic_id)
          AND public.kg_chart_u3c2_can_sentence_group(st.language_code,st.group_name) IS TRUE
      ) THEN
        RAISE EXCEPTION 'F2D3B1 denied speaking group' USING ERRCODE='42501';
      END IF;
    END IF;
    IF public.kg_chart_u3b2_can_answer(s.id,a.vocabulary_id,a.sentence_id) IS DISTINCT FROM true
      OR public.kg_chart_u3b3b1_can_private_answer(s.id,a.vocabulary_id,a.sentence_id) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'F2D3B1 denied answer scope' USING ERRCODE='42501';
    END IF;
    ids := array_append(ids,a.id);
    INSERT INTO public.kg_chart_quiz_answers
      (id,session_id,vocabulary_id,sentence_id,selected_vocabulary_id,is_correct,
       answer_text,answered_at,created_at)
    VALUES(a.id,s.id,a.vocabulary_id,a.sentence_id,a.selected_vocabulary_id,a.is_correct,
      a.answer_text,a.answered_at,a.answered_at)
    ON CONFLICT(id) DO NOTHING RETURNING id INTO saved;
    IF NOT FOUND THEN
      PERFORM 1 FROM public.kg_chart_quiz_answers q
      WHERE q.id=a.id AND q.session_id=s.id
        AND q.vocabulary_id IS NOT DISTINCT FROM a.vocabulary_id
        AND q.sentence_id IS NOT DISTINCT FROM a.sentence_id
        AND q.selected_vocabulary_id IS NOT DISTINCT FROM a.selected_vocabulary_id
        AND q.is_correct=a.is_correct AND q.answer_text IS NOT DISTINCT FROM a.answer_text
        AND q.answered_at=a.answered_at AND q.completed_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'F2D3B1 answer identity conflict' USING ERRCODE='23505';
      END IF;
    END IF;
  END LOOP;
  SELECT count(*) INTO actual_count FROM public.kg_chart_quiz_answers WHERE session_id=s.id;
  IF tally<>s.correct_answers OR actual_count<>s.total_questions
    OR EXISTS (SELECT 1 FROM public.kg_chart_quiz_answers
      WHERE session_id=s.id AND NOT(id=ANY(ids))) THEN
    RAISE EXCEPTION 'F2D3B1 inconsistent score or answer set' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('session_id',s.id,'answer_count',actual_count,
    'expected_revision',p_expected_revision,'time_spent_seconds',s.time_spent_seconds);
END $$;
REVOKE ALL ON FUNCTION public.kg_chart_f2_save_timed_quiz(bigint,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_save_timed_quiz(bigint,jsonb,jsonb) TO authenticated;
COMMIT;
