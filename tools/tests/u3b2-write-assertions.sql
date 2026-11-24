-- U3B2 database contract: fictional IDs and rows, no network/cloud.
-- Requires U1 + U3A fake Auth + U3B1 fixture/SQL + U3B2 fixture/SQL.
\set ON_ERROR_STOP on

-- This helper exists only in synthetic CI, not the production U3B2 script.
-- Unauthorized writes must fail from RLS (SQLSTATE 42501), never succeed.
CREATE FUNCTION public.u3b2_test_expect_rls_denied(p_sql text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'U3B2_UNAUTHORIZED_WRITE_SUCCEEDED: %', p_sql;
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

DO $$
BEGIN
 IF (SELECT count(*) FROM pg_policies
     WHERE schemaname='public' AND permissive='RESTRICTIVE'
       AND policyname LIKE 'kg_u3b2_%'
       AND tablename IN (
         'kg_chart_quiz_sessions','kg_chart_quiz_answers',
         'kg_chart_user_ratings','kg_chart_topic_completions',
         'kg_chart_flags','kg_chart_user_levels')
 )<>10 THEN RAISE EXCEPTION 'Wrong number of restrictive U3B2 write policies'; END IF;

 IF has_function_privilege('anon','public.kg_chart_u3b2_can_answer(uuid,uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.kg_chart_u3b2_can_pronounce(text,text,uuid,uuid,text)','EXECUTE')
    OR has_function_privilege('anon','public.kg_chart_my_answers(text)','EXECUTE')
    OR has_function_privilege('anon','public.kg_chart_check_level_up(text)','EXECUTE')
 THEN RAISE EXCEPTION 'Anonymous role unexpectedly granted privilege'; END IF;
 IF (SELECT count(*) FROM public.kg_chart_access_profiles)<>0 THEN
  RAISE EXCEPTION 'U3B2 unexpectedly created user profiles'; END IF;
END $$;

-- Legacy mode must preserve current write behavior. No access draft means
-- no restrictions. Use a fictional arbitrary quiz type to catch unexpected
-- fallback changes. All changes rolled back.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
DECLARE v_session uuid;
BEGIN
  INSERT INTO public.kg_chart_quiz_sessions
    (user_id,language_code,topic_id,quiz_type)
  VALUES (auth.uid(),'ja','animals','legacy_unknown_type')
  RETURNING id INTO v_session;
  INSERT INTO public.kg_chart_quiz_answers
    (session_id,vocabulary_id,is_correct)
  VALUES (v_session,'10000000-0000-4000-8000-000000000003',true);
  INSERT INTO public.kg_chart_user_ratings
    (user_id,language_code,vocabulary_id,rating)
  VALUES (auth.uid(),'ja','10000000-0000-4000-8000-000000000003',4);
  INSERT INTO public.kg_chart_topic_completions
    (user_id,language_code,topic_id)
  VALUES (auth.uid(),'ja','animals');
  IF NOT public.kg_chart_u3b2_can_pronounce('my','anything',NULL,NULL,'word') THEN
    RAISE EXCEPTION 'Legacy pronunciation became restricted'; END IF;
  IF (SELECT count(*) FROM public.kg_chart_my_answers('ja'))<>1 THEN
    RAISE EXCEPTION 'Legacy history function changed'; END IF;
END $$;
ROLLBACK;

-- A deny-all restricted user must still see their *historical* quiz
-- sessions/answers/rating/completion without being able to create new ones.
BEGIN;
INSERT INTO public.kg_chart_access_profiles(email,mode,revision)
VALUES ('student1@example.invalid','restricted',7),
       ('student2@example.invalid','restricted',9);
INSERT INTO public.kg_chart_access_languages(email,language_code) VALUES
  ('student1@example.invalid','my');
INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id) VALUES
  ('student1@example.invalid','my','food'),
  ('student1@example.invalid','my','colours'),
  ('student1@example.invalid','my','friends_names');
INSERT INTO public.kg_chart_access_features(email,feature_key) VALUES
  ('student1@example.invalid','quiz.words'),
  ('student1@example.invalid','quiz.sentences'),
  ('student1@example.invalid','quiz.colours'),
  ('student1@example.invalid','quiz.say'),
  ('student1@example.invalid','chart');

SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.kg_chart_quiz_sessions
    WHERE user_id=auth.uid();
  IF n<>1 THEN RAISE EXCEPTION 'Historical quiz row lost: %',n; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_quiz_answers;
  IF n<>1 THEN RAISE EXCEPTION 'Historical answer row lost: %',n; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_user_ratings;
  IF n<>1 THEN RAISE EXCEPTION 'Historical rating row lost: %',n; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_topic_completions;
  IF n<>1 THEN RAISE EXCEPTION 'Historical completion row lost: %',n; END IF;
  IF (SELECT count(*) FROM public.kg_chart_my_answers('ja'))<>0 THEN
    RAISE EXCEPTION 'SECURITY DEFINER history leaked denied quiz content'; END IF;

  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,quiz_type) VALUES (%L,%L,%L)',
    auth.uid(),'my','native_to_image'));
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_user_ratings(user_id,language_code,vocabulary_id,rating) VALUES (%L,%L,%L,3)',
    auth.uid(),'ja','10000000-0000-4000-8000-000000000003'));
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_topic_completions(user_id,language_code,topic_id) VALUES (%L,%L,%L)',
    auth.uid(),'ja','animals'));
  PERFORM public.u3b2_test_expect_rls_denied(
    'INSERT INTO public.kg_chart_user_levels(email,language_code) VALUES (''student2@example.invalid'',''ja'')');

  IF public.kg_chart_check_level_up('ja') IS NOT NULL THEN
    RAISE EXCEPTION 'Forbidden level-up RPC created new progress'; END IF;
  IF EXISTS(SELECT 1 FROM public.kg_chart_user_levels
            WHERE email='student2@example.invalid') THEN
    RAISE EXCEPTION 'Forbidden level-up persisted rows'; END IF;
END $$;
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
DECLARE v_good_session uuid;v_bad_session uuid;n integer;
BEGIN
  -- Test actual quiz type -> feature mapping. Words allowed, typing/speak not.
  IF NOT public.kg_chart_u3b2_can_quiz_type('my','native_to_image')
     OR public.kg_chart_u3b2_can_quiz_type('my','typing_recall')
     OR public.kg_chart_u3b2_can_quiz_type('my','speak_lines')
     OR public.kg_chart_u3b2_can_quiz_type('my','unexpected_mode') THEN
    RAISE EXCEPTION 'Quiz feature map accepted an ungranted or unknown mode'; END IF;
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,topic_id,quiz_type) VALUES (%L,%L,%L,%L)',
    auth.uid(),'ja','animals','native_to_image'));
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,topic_id,quiz_type) VALUES (%L,%L,%L,%L)',
    auth.uid(),'my','friends_names','native_to_image'));
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,quiz_type) VALUES (%L,%L,%L)',
    auth.uid(),'my','typing_recall'));
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,quiz_type) VALUES (%L,%L,%L)',
    auth.uid(),'my','speak_lines'));
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,quiz_type) VALUES (%L,%L,%L)',
    auth.uid(),'my','made_up_quiz'));

  INSERT INTO public.kg_chart_quiz_sessions
    (user_id,language_code,topic_id,quiz_type,total_questions,correct_answers)
  VALUES (auth.uid(),'my','food','native_to_image',1,1)
  RETURNING id INTO v_good_session;
  INSERT INTO public.kg_chart_quiz_answers
    (session_id,vocabulary_id,is_correct,answered_at)
  VALUES (v_good_session,'10000000-0000-4000-8000-000000000001',true,now());

  -- New answers cannot substitute an unrelated or private target even
  -- when another permissive INSERT policy exists.
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_quiz_answers(session_id,vocabulary_id,is_correct) VALUES (%L,%L,true)',
    v_good_session,'10000000-0000-4000-8000-000000000003'));
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_quiz_answers(session_id,vocabulary_id,is_correct) VALUES (%L,%L,true)',
    v_good_session,'10000000-0000-4000-8000-000000000004'));
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_quiz_answers(session_id,is_correct) VALUES (%L,false)',
    v_good_session));
  IF (SELECT count(*) FROM public.kg_chart_my_answers('my'))<>1 THEN
    RAISE EXCEPTION 'Scoped answer-history RPC returned wrong records'; END IF;

  -- Text/quiz answers involving a sentence must match the same language.
  INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,quiz_type)
    VALUES (auth.uid(),'my','sentence_to_meaning')
    RETURNING id INTO v_bad_session;
  INSERT INTO public.kg_chart_quiz_answers(session_id,sentence_id,is_correct)
    VALUES (v_bad_session,'20000000-0000-4000-8000-000000000001',true);
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_quiz_answers(session_id,sentence_id,is_correct) VALUES (%L,%L,true)',
    v_bad_session,'20000000-0000-4000-8000-000000000002'));
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_quiz_answers(session_id,sentence_id,is_correct) VALUES (%L,%L,true)',
    v_bad_session,'20000000-0000-4000-8000-000000000003'));

  -- Scoped ratings and completions can be written; excluded rows cannot.
  INSERT INTO public.kg_chart_user_ratings(user_id,language_code,vocabulary_id,rating)
    VALUES (auth.uid(),'my','10000000-0000-4000-8000-000000000001',4);
  INSERT INTO public.kg_chart_topic_completions(user_id,language_code,topic_id)
    VALUES (auth.uid(),'my','food');
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_user_ratings(user_id,language_code,vocabulary_id,rating) VALUES (%L,%L,%L,3)',
    auth.uid(),'ja','10000000-0000-4000-8000-000000000003'));
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'INSERT INTO public.kg_chart_topic_completions(user_id,language_code,topic_id) VALUES (%L,%L,%L)',
    auth.uid(),'my','friends_names'));

  -- Updating an existing record to a forbidden language must fail at
  -- WITH CHECK even if the old row was authorized.
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'UPDATE public.kg_chart_user_ratings SET language_code=%L WHERE user_id=%L AND language_code=%L',
    'ja',auth.uid(),'my'));
  PERFORM public.u3b2_test_expect_rls_denied(format(
    'UPDATE public.kg_chart_topic_completions SET topic_id=%L WHERE user_id=%L AND topic_id=%L',
    'friends_names',auth.uid(),'food'));

  -- Learner can create/adjust own level only for an approved language.
  IF public.kg_chart_check_level_up('ja') IS NOT NULL
     OR public.kg_chart_check_level_up('my') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Privileged level-up function failed scope or legitimate access';END IF;
  IF EXISTS(SELECT 1 FROM public.kg_chart_user_levels
    WHERE email='student1@example.invalid' AND language_code='ja') THEN
    RAISE EXCEPTION 'Restricted level-up saved a forbidden language';END IF;
  IF (SELECT count(*) FROM public.kg_chart_user_levels
    WHERE email='student1@example.invalid' AND language_code='my')<>1 THEN
    RAISE EXCEPTION 'Allowed level-up did not keep the learner level';END IF;

  -- Flags remain insertable on authorized content, with no reporter-id
  -- privacy claim. Denied private names and foreign sessions are rejected.
  INSERT INTO public.kg_chart_flags(id,language_code,vocabulary_id,status)
    VALUES ('60000000-0000-4000-8000-000000000001','my',
            '10000000-0000-4000-8000-000000000001','open');
  PERFORM public.u3b2_test_expect_rls_denied(
    'INSERT INTO public.kg_chart_flags(id,language_code,vocabulary_id,status) VALUES '||
    '(''60000000-0000-4000-8000-000000000002'',''my'','||
    '''10000000-0000-4000-8000-000000000004'',''open'')');
  PERFORM public.u3b2_test_expect_rls_denied(
    'INSERT INTO public.kg_chart_flags(id,language_code,sentence_id,status) VALUES '||
    '(''60000000-0000-4000-8000-000000000003'',''my'','||
    '''20000000-0000-4000-8000-000000000003'',''open'')');

  -- User-owned validation for the Edge Function's service-role path.
  IF NOT public.kg_chart_u3b2_can_pronounce(
    'my','my-food','10000000-0000-4000-8000-000000000001',NULL,'word') THEN
    RAISE EXCEPTION 'Allowed pronunciation was denied'; END IF;
  IF public.kg_chart_u3b2_can_pronounce(
    'my','tampered','10000000-0000-4000-8000-000000000001',NULL,'word')
     OR public.kg_chart_u3b2_can_pronounce('my','my-food',NULL,NULL,'word')
     OR public.kg_chart_u3b2_can_pronounce(
       'my','my-private-friend','10000000-0000-4000-8000-000000000004',NULL,'word')
     OR public.kg_chart_u3b2_can_pronounce(
       'my','my-secret-line',NULL,'20000000-0000-4000-8000-000000000003','speak_lines')
  THEN RAISE EXCEPTION 'Pronunciation preflight exposed unauthorized content';END IF;
END $$;

-- Another user's existing session is never a valid target for new answers.
SELECT set_config('kg_u3_test.uid','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
DO $$
BEGIN
  PERFORM public.u3b2_test_expect_rls_denied(
    'INSERT INTO public.kg_chart_quiz_answers(session_id,vocabulary_id) VALUES '||
    '(''50000000-0000-4000-8000-000000000001'','||
    '''10000000-0000-4000-8000-000000000003'')');
  IF public.kg_chart_u3b2_can_pronounce(
    'ja','ja-animal','10000000-0000-4000-8000-000000000003',NULL,'word') THEN
    RAISE EXCEPTION 'Deny-all learner called privileged pronunciation checker'; END IF;
END $$;

-- Unapproved caller must not gain rights through direct helpers.
SELECT set_config('kg_u3_test.uid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
DO $$
BEGIN
 IF public.kg_chart_u3b2_can_quiz_session('my',NULL,'native_to_image')
   OR public.kg_chart_u3b2_can_pronounce('my','anything',NULL,NULL,'word') THEN
   RAISE EXCEPTION 'Unapproved user bypassed write helpers';END IF;
END $$;
ROLLBACK;

DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.kg_chart_access_profiles)
   OR (SELECT count(*) FROM public.kg_chart_users)<>4
   OR (SELECT count(*) FROM public.kg_chart_quiz_sessions)<>1
   OR (SELECT count(*) FROM public.kg_chart_quiz_answers)<>1
 THEN RAISE EXCEPTION 'U3B2 synthetic tests modified preserved user state';END IF;
END $$;

SELECT 'U3B2_WRITE_AND_RPC_PASS' AS result,
  (SELECT count(*) FROM public.kg_chart_users) AS fictional_users_preserved,
  (SELECT count(*) FROM public.kg_chart_access_profiles) AS activated_profiles;
