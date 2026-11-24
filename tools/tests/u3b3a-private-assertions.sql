-- U3B3A RLS privacy contract against fictional PostgreSQL 17 data.
-- Sources: U1/U3A/U3B1/U3B2 fictitious fixtures, U3B3A SQL and fixture.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND policyname='kg_u3b3a_private_read'
      AND cmd='SELECT' AND permissive='RESTRICTIVE')<>7 THEN
    RAISE EXCEPTION 'Expected seven privacy RESTRICTIVE policies'; END IF;
  IF (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='kg_chart_flags'
      AND policyname='kg_u3b1_read'
      AND permissive='RESTRICTIVE')<>1 THEN
    RAISE EXCEPTION 'Flag owner read restriction missing'; END IF;
  IF has_function_privilege('anon','public.kg_chart_my_private_lesson_visibility(text)','EXECUTE')
      OR has_function_privilege('anon','public.kg_chart_u3b3a_private_topic(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Private visibility function exposed anonymously'; END IF;
  IF (SELECT count(*) FROM public.kg_chart_flags
      WHERE reporter_id IS NULL)<>1 THEN
    RAISE EXCEPTION 'Historical unowned flag was modified'; END IF;
END $$;

-- Existing legacy learner A is NOT authorized for Friends' names.
-- Verify raw settings are denied even under a deliberately broad extra
-- PERMISSIVE policy, and direct SQL still filters private content.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
DECLARE
  v jsonb;
  n integer;
BEGIN
  SELECT public.kg_chart_my_private_lesson_visibility('my') INTO v;
  IF v->>'contract'<>'1'
      OR NOT (v->'topics' @> '["friends_names"]'::jsonb)
      OR NOT (v->'groups' @> '["private_conversation"]'::jsonb)
      OR v::text LIKE '%example.invalid%' OR v ? 'emails' THEN
    RAISE EXCEPTION 'Private visibility leaked user identity: %',v; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_settings
    WHERE key='private_lessons';
  IF n<>0 THEN RAISE EXCEPTION 'Raw email allowlist exposed through direct SELECT'; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_topics;
  IF n<>3 THEN RAISE EXCEPTION 'Legacy private topic parent leaked: %',n; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_topic_translations
    WHERE topic_id='friends_names' AND language_code='my';
  IF n<>0 THEN RAISE EXCEPTION 'Private topic translation leaked'; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_vocabulary
    WHERE topic_id='friends_names';
  IF n<>0 THEN RAISE EXCEPTION 'Private vocabulary parent leaked'; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_vocabulary_translations
    WHERE native_text LIKE '%private%';
  IF n<>0 THEN RAISE EXCEPTION 'Private vocabulary translation leaked'; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_sentences
    WHERE group_name='private_conversation';
  IF n<>0 THEN RAISE EXCEPTION 'Private conversation leaked'; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_flags;
  IF n<>0 THEN RAISE EXCEPTION 'Historical unowned or foreign flags leaked'; END IF;

  -- Spoofed reporter_id must always be replaced by the server trigger.
  INSERT INTO public.kg_chart_flags(
    id,language_code,vocabulary_id,status,reporter_id,notes
  ) VALUES (
    '70000000-0000-4000-8000-000000000001','my',
    '10000000-0000-4000-8000-000000000001','open',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','synthetic issue'
  );
  SELECT count(*) INTO n FROM public.kg_chart_flags
   WHERE id='70000000-0000-4000-8000-000000000001'
     AND reporter_id=auth.uid();
  IF n<>1 THEN RAISE EXCEPTION 'Reporter was not verified and stamped'; END IF;
END $$;
-- Learner B cannot see A's new report; can see private topic assigned to B.
SELECT set_config('kg_u3_test.uid','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
DO $$
DECLARE v jsonb;n integer;
BEGIN
  SELECT public.kg_chart_my_private_lesson_visibility('my') INTO v;
  IF v->'topics'<>'[]'::jsonb OR v->'groups'<>'[]'::jsonb THEN
    RAISE EXCEPTION 'Approved private-lesson account was hidden: %',v; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_topics WHERE id='friends_names';
  IF n<>1 THEN RAISE EXCEPTION 'Private names not visible to approved member'; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_sentences WHERE group_name='private_conversation';
  IF n<>1 THEN RAISE EXCEPTION 'Private conversation denied to approved member'; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_flags;
  IF n<>0 THEN RAISE EXCEPTION 'A different account can view learner A flag'; END IF;
END $$;

SELECT set_config('kg_u1_test.admin','yes',true);
SELECT set_config('kg_u3_test.uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
DO $$
DECLARE n integer;v jsonb;
BEGIN
  SELECT count(*) INTO n FROM public.kg_chart_settings WHERE key='private_lessons';
  IF n<>1 THEN RAISE EXCEPTION 'Administrator lost raw privacy configuration'; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_flags;
  IF n<>2 THEN RAISE EXCEPTION 'Administrator lost historical/new reports: %',n; END IF;
  SELECT public.kg_chart_my_private_lesson_visibility('my') INTO v;
  IF v->'topics'<>'[]'::jsonb OR v->'groups'<>'[]'::jsonb THEN
    RAISE EXCEPTION 'Admin should not hide lesson content'; END IF;
END $$;
ROLLBACK;

-- Also enforce the privacy check for a FUTURE restricted account with
-- a grant for the private topic. U3B1 grants cannot override privacy.
BEGIN;
UPDATE public.kg_chart_access_profiles SET mode='restricted',revision=11
  WHERE email='student1@example.invalid';
INSERT INTO public.kg_chart_access_languages(email,language_code)
VALUES ('student1@example.invalid','my');
INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
VALUES ('student1@example.invalid','my','food'),
       ('student1@example.invalid','my','friends_names');
INSERT INTO public.kg_chart_access_features(email,feature_key)
VALUES ('student1@example.invalid','chart'),('student1@example.invalid','quiz.words'),
       ('student1@example.invalid','quiz.sentences');
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.kg_chart_topics;
  IF n<>1 THEN RAISE EXCEPTION 'Restricted grant bypassed privacy: %',n; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_vocabulary
    WHERE topic_id='friends_names';
  IF n<>0 THEN RAISE EXCEPTION 'Restricted private vocab leaked'; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_sentences
    WHERE group_name='private_conversation';
  IF n<>0 THEN RAISE EXCEPTION 'Restricted private sentence leaked'; END IF;
END $$;
ROLLBACK;

-- Invalid private settings must fail closed, not silently expose records.
BEGIN;
UPDATE public.kg_chart_settings SET value='{}'::jsonb
 WHERE key='private_lessons';
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
BEGIN
  BEGIN
    PERFORM public.kg_chart_my_private_lesson_visibility('my');
    RAISE EXCEPTION 'U3B3A_INVALID_SETTINGS_WERE_ACCEPTED';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
ROLLBACK;

-- Unapproved account must not obtain privacy metadata.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
DO $$
BEGIN
  BEGIN
    PERFORM public.kg_chart_my_private_lesson_visibility('my');
    RAISE EXCEPTION 'U3B3A_UNAPPROVED_ACCOUNT_WAS_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.kg_chart_users)<>4 OR
    (SELECT count(*) FROM public.kg_chart_flags WHERE reporter_id IS NULL)<>1 OR
    (SELECT count(*) FROM public.kg_chart_access_profiles
      WHERE mode='restricted')<>0 THEN
    RAISE EXCEPTION 'U3B3A tests modified existing synthetic user data'; END IF;
END $$;

SELECT 'U3B3A_PRIVATE_RECORDS_PASS' AS result,
  (SELECT count(*) FROM public.kg_chart_users) AS synthetic_users_unchanged,
  (SELECT count(*) FROM public.kg_chart_flags WHERE reporter_id IS NULL) AS old_flags_preserved;
