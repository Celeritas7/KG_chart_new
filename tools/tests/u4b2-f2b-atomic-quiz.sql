-- F2B candidate: disposable fixture only. Never apply to hosted Supabase.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;

-- Supersede the restricted session-only API after the F2A regression runs.
-- Its owner can still call it inside the atomic operation below.
REVOKE EXECUTE ON FUNCTION public.kg_chart_f2_save_restricted_session(
  bigint,uuid,text,text,text,int,int,smallint,timestamptz,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY kg_u4b2_f2_legacy_direct_answer ON public.kg_chart_quiz_answers
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b2_is_legacy() IS TRUE);

CREATE FUNCTION public.kg_chart_f2_save_restricted_quiz(
  p_expected_revision bigint,p_session_id uuid,p_language_code text,
  p_topic_id text,p_quiz_type text,p_total_questions int,p_correct_answers int,
  p_difficulty smallint,p_completed_at timestamptz,p_created_at timestamptz,
  p_answers jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_answer public.kg_chart_quiz_answers%ROWTYPE;
  v_saved uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_correct int := 0;
  v_count int;
BEGIN
  -- Intentionally bounded to completed word and sentence quizzes.
  -- Typing, speaking, colour/session-only and other writes are follow-ups.
  IF p_quiz_type IS NULL OR p_quiz_type NOT IN (
    'native_to_image','image_to_native','devanagari_to_image',
    'english_to_native','listen_to_image','listen_to_native',
    'word_builder','type_word','sentence_to_meaning',
    'meaning_to_sentence','build_sentence'
  ) THEN
    RAISE EXCEPTION 'F2B unsupported quiz type' USING ERRCODE='22023';
  END IF;
  IF p_total_questions IS NULL OR p_total_questions NOT BETWEEN 1 AND 500
     OR p_correct_answers IS NULL OR p_completed_at IS NULL
     OR jsonb_typeof(p_answers) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'F2B invalid completed quiz' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_answers) <> p_total_questions
     OR octet_length(p_answers::text) > 2097152 THEN
    RAISE EXCEPTION 'F2B incomplete or oversized quiz' USING ERRCODE='22023';
  END IF;

  -- F2A verifies identity, current restricted mode, expected revision and all
  -- session permissions under the same profile lock held until COMMIT.
  -- Any following exception rolls back this session and every new answer.
  v_id := public.kg_chart_f2_save_restricted_session(
    p_expected_revision,p_session_id,p_language_code,p_topic_id,p_quiz_type,
    p_total_questions,p_correct_answers,p_difficulty,p_completed_at,p_created_at);
  -- Serialize complete-set validation against simultaneous retries. Never
  -- lock a parent before the profile (the common F2A lock order).
  PERFORM 1 FROM public.kg_chart_quiz_sessions
    WHERE id=v_id AND user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'F2B unverified parent' USING ERRCODE='42501';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_answers) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'F2B invalid answer object' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) k
      WHERE k NOT IN ('id','vocabulary_id','sentence_id','selected_vocabulary_id',
        'is_correct','answer_text','answered_at','completed_at','created_at')) THEN
      RAISE EXCEPTION 'F2B unexpected answer field' USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(v_item->'id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'is_correct') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(v_item->'answered_at') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'created_at') IS DISTINCT FROM 'string'
       OR EXISTS (SELECT 1 FROM jsonb_each(v_item) e
         WHERE e.key NOT IN ('is_correct') AND jsonb_typeof(e.value) NOT IN ('string','null')) THEN
      RAISE EXCEPTION 'F2B invalid answer field types' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_answer FROM jsonb_populate_record(
      NULL::public.kg_chart_quiz_answers,v_item);
    IF v_answer.id IS NULL OR v_answer.answered_at IS NULL OR v_answer.created_at IS NULL
       OR v_answer.id=ANY(v_ids) OR v_answer.is_correct IS NULL
       OR (v_answer.vocabulary_id IS NULL) = (v_answer.sentence_id IS NULL) THEN
      RAISE EXCEPTION 'F2B missing or duplicate answer identity' USING ERRCODE='22023';
    END IF;
    v_ids := array_append(v_ids,v_answer.id);
    IF v_answer.is_correct THEN v_correct := v_correct + 1; END IF;

    -- The original answer helpers enforce ownership, type, translation and
    -- private content. Also bind a sentence to a currently verified group
    -- and, for topic-specific sessions, to that same topic, not merely any
    -- other permitted group.
    IF public.kg_chart_u3b2_can_answer(v_id,v_answer.vocabulary_id,v_answer.sentence_id) IS DISTINCT FROM true
       OR public.kg_chart_u3b3b1_can_private_answer(v_id,v_answer.vocabulary_id,v_answer.sentence_id) IS DISTINCT FROM true
       OR (v_answer.sentence_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.kg_chart_sentences s
         JOIN public.kg_chart_sentence_group_topic_map m
           ON m.language_code=s.language_code AND m.group_name=s.group_name
         WHERE s.id=v_answer.sentence_id AND s.language_code=p_language_code
           AND m.review_status='verified' AND m.reviewed_by IS NOT NULL
           AND m.reviewed_at IS NOT NULL AND m.evidence_sha256 IS NOT NULL
           AND (p_topic_id IS NULL OR m.topic_id=p_topic_id)
           AND public.kg_chart_u3c2_can_sentence_group(s.language_code,s.group_name) IS TRUE
       )) THEN
      RAISE EXCEPTION 'F2B denied answer scope' USING ERRCODE='42501';
    END IF;
    INSERT INTO public.kg_chart_quiz_answers
      (id,session_id,vocabulary_id,sentence_id,selected_vocabulary_id,
       is_correct,answer_text,answered_at,completed_at,created_at)
    VALUES (v_answer.id,v_id,v_answer.vocabulary_id,v_answer.sentence_id,
      v_answer.selected_vocabulary_id,v_answer.is_correct,v_answer.answer_text,
      v_answer.answered_at,v_answer.completed_at,v_answer.created_at)
    ON CONFLICT(id) DO NOTHING RETURNING id INTO v_saved;
    IF NOT FOUND THEN
      SELECT a.id INTO v_saved FROM public.kg_chart_quiz_answers a
      WHERE a.id=v_answer.id AND a.session_id=v_id
        AND a.vocabulary_id IS NOT DISTINCT FROM v_answer.vocabulary_id
        AND a.sentence_id IS NOT DISTINCT FROM v_answer.sentence_id
        AND a.selected_vocabulary_id IS NOT DISTINCT FROM v_answer.selected_vocabulary_id
        AND a.is_correct IS NOT DISTINCT FROM v_answer.is_correct
        AND a.answer_text IS NOT DISTINCT FROM v_answer.answer_text
        AND a.answered_at IS NOT DISTINCT FROM v_answer.answered_at
        AND a.completed_at IS NOT DISTINCT FROM v_answer.completed_at
        AND a.created_at IS NOT DISTINCT FROM v_answer.created_at;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'F2B answer identity conflict' USING ERRCODE='23505';
      END IF;
    END IF;
  END LOOP;
  -- Exact answer set, not just a count. An incompatible old partial or a
  -- different concurrent request cannot be silently acknowledged.
  SELECT count(*) INTO v_count FROM public.kg_chart_quiz_answers WHERE session_id=v_id;
  IF v_correct <> p_correct_answers OR v_count <> p_total_questions
     OR EXISTS (SELECT 1 FROM public.kg_chart_quiz_answers
       WHERE session_id=v_id AND NOT (id=ANY(v_ids))) THEN
    RAISE EXCEPTION 'F2B inconsistent answer set or score' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('session_id',v_id,'answer_count',v_count,
    'expected_revision',p_expected_revision);
END $$;
REVOKE ALL ON FUNCTION public.kg_chart_f2_save_restricted_quiz(
  bigint,uuid,text,text,text,int,int,smallint,timestamptz,timestamptz,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_save_restricted_quiz(
  bigint,uuid,text,text,text,int,int,smallint,timestamptz,timestamptz,jsonb)
  TO authenticated;
COMMIT;
