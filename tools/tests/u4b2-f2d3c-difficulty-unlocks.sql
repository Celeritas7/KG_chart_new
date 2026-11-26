-- F2D3C candidate: restricted difficulty selection and advancement.
-- Disposable fixture only; no hosted migration or activation.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;

ALTER TABLE public.kg_chart_user_levels
  ADD COLUMN f2_level_version bigint NOT NULL DEFAULT 0 CHECK(f2_level_version>=0);

-- Keep legacy writes available under their existing RLS; restricted clients
-- cannot write a selected level, unlock value, version or timestamp directly.
CREATE POLICY f2d3c_legacy_level_insert ON public.kg_chart_user_levels
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b2_is_legacy() IS TRUE);
CREATE POLICY f2d3c_legacy_level_update ON public.kg_chart_user_levels
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.kg_chart_u3b2_is_legacy() IS TRUE)
  WITH CHECK (public.kg_chart_u3b2_is_legacy() IS TRUE);
CREATE POLICY f2d3c_legacy_level_delete ON public.kg_chart_user_levels
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.kg_chart_u3b2_is_legacy() IS TRUE);
REVOKE TRUNCATE ON public.kg_chart_user_levels FROM PUBLIC,anon,authenticated,service_role;

-- Extend the existing shared authorization publication rule to unlock_rules.
-- Its BEFORE statement lock already covers settings DML. Changes now make
-- old permission revisions stale, while no-op/unrelated edits still do not.
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
      v_sensitive := OLD.key IN ('private_lessons','unlock_rules');
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_sensitive := v_sensitive OR NEW.key IN ('private_lessons','unlock_rules');
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

CREATE TABLE kg_u4b2b_test_private.f2d3c_mcq_receipts (
  session_id uuid PRIMARY KEY REFERENCES public.kg_chart_quiz_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  language_code text NOT NULL,
  difficulty smallint NOT NULL CHECK(difficulty BETWEEN 1 AND 4),
  answer_ids uuid[] NOT NULL CHECK(cardinality(answer_ids) BETWEEN 1 AND 500)
);
REVOKE ALL ON kg_u4b2b_test_private.f2d3c_mcq_receipts FROM PUBLIC,anon,authenticated,service_role;

-- Shared global gate -> existing profile -> owned level row -> session.
-- All restricted difficulty operations use this lock order. No caller email.
CREATE FUNCTION kg_u4b2b_test_private.f2d3c_lock_level(p_revision bigint,p_lang text)
RETURNS public.kg_chart_user_levels
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  uid uuid := auth.uid();
  email_id text;
  profile_mode text;
  rev bigint;
  l public.kg_chart_user_levels%ROWTYPE;
BEGIN
  IF uid IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3C unverified learner' USING ERRCODE='42501';
  END IF;
  SELECT lower(u.email) INTO email_id FROM auth.users u
    JOIN public.kg_chart_users k ON k.email=lower(u.email)
    WHERE u.id=uid AND u.email_confirmed_at IS NOT NULL AND k.role='operator';
  IF email_id IS NULL THEN
    RAISE EXCEPTION 'F2D3C unverified operator' USING ERRCODE='42501';
  END IF;
  IF p_revision IS NULL OR p_revision<1 THEN
    RAISE EXCEPTION 'F2D3C revision required' USING ERRCODE='40001';
  END IF;
  PERFORM kg_u4b2b_test_private.f2d_lock_shared();
  SELECT mode,revision INTO profile_mode,rev FROM public.kg_chart_access_profiles
    WHERE email=email_id FOR SHARE;
  IF NOT FOUND OR profile_mode IS DISTINCT FROM 'restricted'
     OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3C existing restricted profile required' USING ERRCODE='42501';
  END IF;
  IF rev IS DISTINCT FROM p_revision THEN
    RAISE EXCEPTION 'F2D3C stale permission revision' USING ERRCODE='40001';
  END IF;
  IF public.kg_chart_u3b2_can_quiz_session(p_lang,NULL,'native_to_image') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3C denied level scope' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.kg_chart_user_levels(email,language_code)
    VALUES(email_id,p_lang) ON CONFLICT DO NOTHING;
  SELECT * INTO l FROM public.kg_chart_user_levels
    WHERE email=email_id AND language_code=p_lang FOR UPDATE;
  IF NOT FOUND OR l.level NOT BETWEEN 1 AND 4 OR l.unlocked NOT BETWEEN 1 AND 4
     OR l.level>l.unlocked THEN
    RAISE EXCEPTION 'F2D3C inconsistent historical level; reconciliation required' USING ERRCODE='22023';
  END IF;
  RETURN l;
END $$;
CREATE FUNCTION kg_u4b2b_test_private.f2d3c_level_json(l public.kg_chart_user_levels)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('level',l.level,'unlocked',l.unlocked,'version',l.f2_level_version);
$$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d3c_lock_level(bigint,text),
  kg_u4b2b_test_private.f2d3c_level_json(public.kg_chart_user_levels)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.kg_chart_f2_level_state(p_expected_revision bigint,p_lang text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l public.kg_chart_user_levels%ROWTYPE;
BEGIN
  l := kg_u4b2b_test_private.f2d3c_lock_level(p_expected_revision,p_lang);
  RETURN kg_u4b2b_test_private.f2d3c_level_json(l);
END $$;

CREATE FUNCTION public.kg_chart_f2_select_difficulty(
  p_expected_revision bigint,p_lang text,p_expected_version bigint,p_level integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l public.kg_chart_user_levels%ROWTYPE;
BEGIN
  l := kg_u4b2b_test_private.f2d3c_lock_level(p_expected_revision,p_lang);
  IF p_expected_version IS DISTINCT FROM l.f2_level_version THEN
    RAISE EXCEPTION 'F2D3C stale level version' USING ERRCODE='40001';
  END IF;
  IF p_level IS NULL OR p_level NOT BETWEEN 1 AND l.unlocked THEN
    RAISE EXCEPTION 'F2D3C locked difficulty' USING ERRCODE='42501';
  END IF;
  IF p_level<>l.level THEN
    UPDATE public.kg_chart_user_levels SET level=p_level,f2_level_version=f2_level_version+1,updated_at=now()
      WHERE email=l.email AND language_code=l.language_code RETURNING * INTO l;
  END IF;
  RETURN kg_u4b2b_test_private.f2d3c_level_json(l);
END $$;

-- The previous recovery RPC remains the atomic implementation. Only this
-- wrapper is callable now; its difficulty checks precede the session lock.
ALTER FUNCTION public.kg_chart_f2_save_recovery_quiz(bigint,jsonb)
  RENAME TO kg_chart_f2_recovery_quiz_internal;
REVOKE ALL ON FUNCTION public.kg_chart_f2_recovery_quiz_internal(bigint,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.kg_chart_f2_save_recovery_quiz(p_expected_revision bigint,p_draft jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  s jsonb := p_draft->'session';
  mode text := s->>'quiz_type';
  l public.kg_chart_user_levels%ROWTYPE;
  result jsonb;
  ids uuid[];
  sid uuid;
  d smallint;
BEGIN
  IF mode IN ('native_to_image','image_to_native','devanagari_to_image',
      'english_to_native','listen_to_image','listen_to_native') THEN
    IF jsonb_typeof(s->'difficulty') IS DISTINCT FROM 'number'
       OR (s->>'difficulty') !~ '^[1-4]$' THEN
      RAISE EXCEPTION 'F2D3C explicit MCQ difficulty required' USING ERRCODE='22023';
    END IF;
    d := (s->>'difficulty')::smallint;
    l := kg_u4b2b_test_private.f2d3c_lock_level(p_expected_revision,s->>'language_code');
    IF d>l.unlocked THEN
      RAISE EXCEPTION 'F2D3C locked quiz difficulty' USING ERRCODE='42501';
    END IF;
    result := public.kg_chart_f2_recovery_quiz_internal(p_expected_revision,p_draft);
    sid := (result->>'session_id')::uuid;
    SELECT array_agg((value->>'id')::uuid ORDER BY (value->>'id')::uuid)
      INTO ids FROM jsonb_array_elements(p_draft->'answers');
    INSERT INTO kg_u4b2b_test_private.f2d3c_mcq_receipts
      (session_id,user_id,language_code,difficulty,answer_ids)
      VALUES(sid,auth.uid(),s->>'language_code',d,ids) ON CONFLICT(session_id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM kg_u4b2b_test_private.f2d3c_mcq_receipts r
       WHERE r.session_id=sid AND r.user_id=auth.uid()
         AND r.language_code=s->>'language_code' AND r.difficulty=d AND r.answer_ids=ids) THEN
      RAISE EXCEPTION 'F2D3C quiz evidence conflict' USING ERRCODE='23505';
    END IF;
    RETURN result;
  END IF;
  IF s->>'difficulty' IS NOT NULL THEN
    RAISE EXCEPTION 'F2D3C non-MCQ difficulty not allowed' USING ERRCODE='22023';
  END IF;
  RETURN public.kg_chart_f2_recovery_quiz_internal(p_expected_revision,p_draft);
END $$;

-- Match kg-shared.js: first whole numeric value (language, then global),
-- clamped to the allowed range. The old fixture helper returns defaults only.
CREATE FUNCTION kg_u4b2b_test_private.f2d3c_rule(
  rules jsonb,lang text,field text,fallback integer,lo integer,hi integer
) RETURNS integer LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb; n numeric;
BEGIN
  FOREACH item IN ARRAY ARRAY[rules#>ARRAY['languages',lang,'level_up',field],
                              rules#>ARRAY['level_up',field]] LOOP
    IF jsonb_typeof(item)='number' THEN
      n := (item#>>'{}')::numeric;
      IF trunc(n)=n THEN RETURN least(hi::numeric,greatest(lo::numeric,n))::integer; END IF;
    END IF;
  END LOOP;
  RETURN fallback;
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d3c_rule(jsonb,text,text,integer,integer,integer)
  FROM PUBLIC,anon,authenticated,service_role;

-- Never expose the old summary-only unlock path to restricted learners.
ALTER FUNCTION public.kg_chart_check_level_up(text) RENAME TO kg_chart_f2_legacy_level_up_internal;
REVOKE ALL ON FUNCTION public.kg_chart_f2_legacy_level_up_internal(text)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.kg_chart_check_level_up(p_lang text)
RETURNS smallint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM kg_u4b2b_test_private.f2d_lock_shared();
  IF public.kg_chart_u3b2_is_legacy() IS DISTINCT FROM true THEN RETURN NULL; END IF;
  RETURN public.kg_chart_f2_legacy_level_up_internal(p_lang);
END $$;

CREATE FUNCTION public.kg_chart_f2_check_level_up(
  p_expected_revision bigint,p_lang text,p_expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  l public.kg_chart_user_levels%ROWTYPE;
  rules jsonb;
  target integer;
  pct integer;
  total bigint := 0;
  correct bigint := 0;
  s record;
BEGIN
  l := kg_u4b2b_test_private.f2d3c_lock_level(p_expected_revision,p_lang);
  IF p_expected_version IS DISTINCT FROM l.f2_level_version THEN
    RAISE EXCEPTION 'F2D3C stale level version' USING ERRCODE='40001';
  END IF;
  SELECT value INTO rules FROM public.kg_chart_settings WHERE key='unlock_rules';
  target := kg_u4b2b_test_private.f2d3c_rule(rules,p_lang,'answers',40,10,200);
  pct := kg_u4b2b_test_private.f2d3c_rule(rules,p_lang,'pct',85,50,100);
  IF l.unlocked<4 THEN
    -- Only atomically confirmed MCQ sets qualify. Recheck current question
    -- scope and exact answer IDs/counts/score; never count bare summaries or
    -- incomplete historical work. Do not delete or lower existing history.
    FOR s IN
      SELECT q.total_questions,q.correct_answers
      FROM public.kg_chart_quiz_sessions q
      JOIN kg_u4b2b_test_private.f2d3c_mcq_receipts r
        ON r.session_id=q.id AND r.user_id=q.user_id AND r.language_code=q.language_code
        AND r.difficulty=q.difficulty
      CROSS JOIN LATERAL (
        SELECT count(*) AS n,count(*) FILTER (WHERE a.is_correct) AS good,
          array_agg(a.id ORDER BY a.id) AS ids,
          bool_and(a.is_correct IS NOT NULL AND a.answered_at IS NOT NULL
            AND a.vocabulary_id IS NOT NULL AND a.sentence_id IS NULL
            AND public.kg_chart_u3b2_can_answer(q.id,a.vocabulary_id,a.sentence_id) IS TRUE
            AND public.kg_chart_u3b3b1_can_private_answer(q.id,a.vocabulary_id,a.sentence_id) IS TRUE) AS allowed
        FROM public.kg_chart_quiz_answers a WHERE a.session_id=q.id
      ) evidence
      WHERE q.user_id=auth.uid() AND q.language_code=p_lang AND q.difficulty=l.unlocked
        AND q.quiz_type IN ('native_to_image','image_to_native','devanagari_to_image',
          'english_to_native','listen_to_image','listen_to_native')
        AND q.completed_at IS NOT NULL AND q.total_questions BETWEEN 1 AND 500
        AND q.correct_answers BETWEEN 0 AND q.total_questions
        AND evidence.n=q.total_questions AND evidence.good=q.correct_answers
        AND evidence.ids=r.answer_ids AND evidence.allowed IS TRUE
      ORDER BY q.created_at DESC,q.id DESC
    LOOP
      total := total+s.total_questions;
      correct := correct+s.correct_answers;
      EXIT WHEN total>=target;
    END LOOP;
    IF total>=target AND correct*100>=pct*total THEN
      UPDATE public.kg_chart_user_levels SET unlocked=unlocked+1,
        f2_level_version=f2_level_version+1,updated_at=now()
        WHERE email=l.email AND language_code=l.language_code RETURNING * INTO l;
    END IF;
  END IF;
  RETURN kg_u4b2b_test_private.f2d3c_level_json(l) ||
    jsonb_build_object('evaluated_total',total,'evaluated_correct',correct,
      'required_answers',target,'required_pct',pct);
END $$;

REVOKE ALL ON FUNCTION public.kg_chart_f2_level_state(bigint,text),
  public.kg_chart_f2_select_difficulty(bigint,text,bigint,integer),
  public.kg_chart_f2_check_level_up(bigint,text,bigint),
  public.kg_chart_f2_save_recovery_quiz(bigint,jsonb),public.kg_chart_check_level_up(text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_level_state(bigint,text),
  public.kg_chart_f2_select_difficulty(bigint,text,bigint,integer),
  public.kg_chart_f2_check_level_up(bigint,text,bigint),
  public.kg_chart_f2_save_recovery_quiz(bigint,jsonb),public.kg_chart_check_level_up(text)
  TO authenticated;
COMMIT;
