-- U3B3B1 synthetic privacy test, PostgreSQL 17 --network none.
-- Run full U1/U3A/U3B1/U3B2/U3B3A fixtures and SQL first, then this.
\set ON_ERROR_STOP on

CREATE FUNCTION public.u3b3b1_expect_denied(p_sql text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $fn$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'U3B3B1_UNAUTHORIZED_INSERT_ACCEPTED: %',p_sql;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $fn$;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public'
        AND policyname LIKE 'kg_u3b3b1_private_%'
        AND permissive='RESTRICTIVE')<>7
  THEN RAISE EXCEPTION 'Missing U3B3B1 restrictive write policies'; END IF;
  IF has_function_privilege(
    'anon','public.kg_chart_u3b3b1_can_private_answer(uuid,uuid,uuid)','EXECUTE')
     OR has_function_privilege(
    'anon','public.kg_chart_u3b2_can_pronounce(text,text,uuid,uuid,text)','EXECUTE')
     OR has_function_privilege('anon','public.kg_chart_my_answers(text)','EXECUTE')
  THEN RAISE EXCEPTION 'Private auth helper callable by anon'; END IF;
  IF (SELECT count(*) FROM public.kg_chart_quiz_sessions)<>4
    OR (SELECT count(*) FROM public.kg_chart_quiz_answers)<>4
  THEN RAISE EXCEPTION 'Historic quiz fixtures missing before test';END IF;
END $$;

-- Legacy A: private friends name and conversation belong to another user.
-- Even with legacy mode, direct NEW writes and SECURITY DEFINER readback
-- cannot bypass these private lesson rules. Own historical rows stay stored.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
DECLARE n integer; v_session uuid;
BEGIN
  SELECT count(*) INTO n FROM public.kg_chart_quiz_sessions
    WHERE user_id=auth.uid() AND topic_id='friends_names';
  IF n<>1 THEN RAISE EXCEPTION 'Existing private quiz bytes unexpectedly deleted';END IF;
  SELECT count(*) INTO n FROM public.kg_chart_user_ratings
    WHERE user_id=auth.uid() AND vocabulary_id='10000000-0000-4000-8000-000000000004';
  IF n<>1 THEN RAISE EXCEPTION 'Existing private rating bytes unexpectedly deleted';END IF;
  SELECT count(*) INTO n FROM public.kg_chart_my_answers('my');
  IF n<>1 THEN RAISE EXCEPTION 'SECURITY DEFINER history leaked private word: %',n;END IF;
  IF EXISTS (SELECT 1 FROM public.kg_chart_my_answers('my')
             WHERE vocabulary_id='10000000-0000-4000-8000-000000000004') THEN
    RAISE EXCEPTION 'Private vocabulary identifier leaked from own historic quiz';
  END IF;

  PERFORM public.u3b3b1_expect_denied(format(
    'INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,topic_id,quiz_type) VALUES (%L,%L,%L,%L)',
    auth.uid(),'my','friends_names','native_to_image'));
  PERFORM public.u3b3b1_expect_denied(format(
    'INSERT INTO public.kg_chart_quiz_answers(session_id,vocabulary_id,is_correct) VALUES (%L,%L,true)',
    '71000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004'));

  -- A NULL-topic Word Quiz remains possible for legitimate public words,
  -- but a private target cannot be submitted in that allowed session.
  INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,quiz_type)
    VALUES (auth.uid(),'my','native_to_image') RETURNING id INTO v_session;
  INSERT INTO public.kg_chart_quiz_answers(session_id,vocabulary_id,is_correct)
    VALUES (v_session,'10000000-0000-4000-8000-000000000001',true);
  PERFORM public.u3b3b1_expect_denied(format(
    'INSERT INTO public.kg_chart_quiz_answers(session_id,vocabulary_id,is_correct) VALUES (%L,%L,true)',
    v_session,'10000000-0000-4000-8000-000000000004'));

  PERFORM public.u3b3b1_expect_denied(format(
    'INSERT INTO public.kg_chart_user_ratings(user_id,language_code,vocabulary_id,rating) VALUES (%L,%L,%L,3)',
    auth.uid(),'my','10000000-0000-4000-8000-000000000004'));
  PERFORM public.u3b3b1_expect_denied(format(
    'INSERT INTO public.kg_chart_topic_completions(user_id,language_code,topic_id) VALUES (%L,%L,%L)',
    auth.uid(),'my','friends_names'));
  PERFORM public.u3b3b1_expect_denied(format(
    'INSERT INTO public.kg_chart_flags(id,language_code,vocabulary_id,status) VALUES (%L,%L,%L,%L)',
    '75000000-0000-4000-8000-000000000001',
    'my','10000000-0000-4000-8000-000000000004','open'));
  PERFORM public.u3b3b1_expect_denied(format(
    'INSERT INTO public.kg_chart_flags(id,language_code,sentence_id,status) VALUES (%L,%L,%L,%L)',
    '75000000-0000-4000-8000-000000000002',
    'my','20000000-0000-4000-8000-000000000003','open'));

  IF public.kg_chart_u3b2_can_pronounce(
    'my','my-private-friend',
    '10000000-0000-4000-8000-000000000004',NULL,'word')
     OR public.kg_chart_u3b2_can_pronounce(
    'my','my-secret-line',NULL,
    '20000000-0000-4000-8000-000000000003','speak_lines')
     OR public.kg_chart_u3b2_can_pronounce('my','anything',NULL,NULL,'word')
     OR public.kg_chart_u3b2_can_pronounce(
       'my','wrong-text','10000000-0000-4000-8000-000000000001',NULL,'word')
  THEN RAISE EXCEPTION 'Legacy privileged pronunciation bypass still exists';END IF;

  IF public.kg_chart_u3b2_can_pronounce(
    'my','my-food','10000000-0000-4000-8000-000000000001',NULL,'word')
    IS DISTINCT FROM true
     OR public.kg_chart_u3b2_can_pronounce(
       'my','my-sentence',NULL,
       '20000000-0000-4000-8000-000000000001','speak_lines')
       IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Ordinary legacy pronunciation stopped working';END IF;
END $$;

-- Another learner's old quiz session is never a writable foreign session.
SELECT set_config('kg_u3_test.uid','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.kg_chart_my_answers('my')
    WHERE vocabulary_id='10000000-0000-4000-8000-000000000004';
  IF n<>1 THEN RAISE EXCEPTION 'Authorized private lesson member lost own history';END IF;
  IF public.kg_chart_u3b2_can_pronounce(
    'my','my-private-friend',
    '10000000-0000-4000-8000-000000000004',NULL,'word')
    IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Approved member cannot pronounce an authorized private word';END IF;
  PERFORM public.u3b3b1_expect_denied(format(
    'INSERT INTO public.kg_chart_quiz_answers(session_id,vocabulary_id) VALUES (%L,%L)',
    '71000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004'));
END $$;

-- Administrator is still allowed a full review path.
SELECT set_config('kg_u1_test.admin','yes',true);
SELECT set_config('kg_u3_test.uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
DO $$
BEGIN
  IF public.kg_chart_u3b2_can_pronounce(
    'my','my-private-friend',
    '10000000-0000-4000-8000-000000000004',NULL,'word')
    IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Admin lost private-content review ability';END IF;
END $$;
ROLLBACK;

-- An explicitly restricted learner with no grants must still be denied.
BEGIN;
UPDATE public.kg_chart_access_profiles
  SET mode='restricted' WHERE email='student1@example.invalid';
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
BEGIN
  IF public.kg_chart_u3b2_can_pronounce(
       'my','my-food',
       '10000000-0000-4000-8000-000000000001',NULL,'word')
     OR public.kg_chart_u3b3b1_can_private_session('my',NULL) THEN
    RAISE EXCEPTION 'Restricted empty grants bypassed privacy';END IF;
END $$;
ROLLBACK;

-- Unapproved user is denied in all helper entrypoints.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
DO $$
BEGIN
 IF public.kg_chart_u3b2_can_pronounce(
      'my','my-food','10000000-0000-4000-8000-000000000001',NULL,'word')
    OR public.kg_chart_u3b3b1_can_private_session('my','food')
 THEN RAISE EXCEPTION 'Unapproved caller bypassed private checks'; END IF;
END $$;
ROLLBACK;

-- Nothing may mutate or claim removal of preexisting private rows.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.kg_chart_quiz_sessions)<>4
    OR (SELECT count(*) FROM public.kg_chart_quiz_answers)<>4
    OR (SELECT count(*) FROM public.kg_chart_users)<>4
    OR (SELECT count(*) FROM public.kg_chart_access_profiles)<>2 THEN
    RAISE EXCEPTION 'Synthetic historical records or access profiles changed';END IF;
  IF (SELECT count(*) FROM public.kg_chart_flags WHERE reporter_id IS NULL)<>1 THEN
    RAISE EXCEPTION 'Historic flag ownership was silently fabricated';END IF;
END $$;
SELECT 'U3B3B1_LEGACY_PRIVATE_RPCS_PASS' AS result,
 (SELECT count(*) FROM public.kg_chart_quiz_answers) AS historic_answers_preserved,
 (SELECT count(*) FROM public.kg_chart_users) AS test_users_preserved;
