-- KG Chart U3C2: synthetic PostgreSQL 17, with --network none.
-- Apply U1/U3A/U3B1/U3B2/U3B3A/U3B3B1 SQL, then U3C2 twice.
-- No production SQL, storage objects, user profiles, packs or migrations.
\set ON_ERROR_STOP on

CREATE FUNCTION public.u3c2_expect_rls_denied(p_stmt text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $fn$
BEGIN
  EXECUTE p_stmt;
  RAISE EXCEPTION 'U3C2_UNAUTHORIZED_WRITE_ACCEPTED';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $fn$;

DO $$
BEGIN
 IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename='kg_chart_sentence_group_topic_map'
       AND policyname='kg_u3c2_admin_only')<>1
 THEN RAISE EXCEPTION 'Missing admin-only mapping policy'; END IF;
 IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND policyname IN (
         'kg_u3c2_group_read','kg_u3c2_session_insert'
       ) AND permissive='RESTRICTIVE')<>2
 THEN RAISE EXCEPTION 'Missing source-level restrictive sentence policies';END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class
       WHERE oid='public.kg_chart_sentence_group_topic_map'::regclass)
 THEN RAISE EXCEPTION 'Mapping registry is not protected by RLS';END IF;
 IF has_table_privilege('anon','public.kg_chart_sentence_group_topic_map','SELECT')
   OR has_function_privilege('anon','public.kg_chart_u3c2_my_sentence_groups(text)','EXECUTE')
   OR has_function_privilege('anon','public.kg_chart_u3c2_can_sentence_group(text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Anonymous mapping exposure';END IF;
 IF (SELECT count(*) FROM public.kg_chart_sentence_group_topic_map)<>3
 THEN RAISE EXCEPTION 'Unexpected automatically generated group mapping';END IF;
 BEGIN
   INSERT INTO public.kg_chart_sentence_group_topic_map
    (language_code,group_name,topic_id,review_status)
   VALUES ('my','danger','food','verified');
   RAISE EXCEPTION 'U3C2_VERIFIED_WITHOUT_REVIEW_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   INSERT INTO public.kg_chart_sentence_group_topic_map
    (language_code,group_name,topic_id)
   VALUES ('my','bad-translation','animals');
   RAISE EXCEPTION 'U3C2_UNTRANSLATED_TOPIC_MAPPING_ACCEPTED';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;

-- Legacy mode must still see ordinary sentences even when they have no
-- mapping (no sudden loss of Marathi/Tamil/Burmese conversations).
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
DECLARE snapshot jsonb;n integer;
BEGIN
 IF public.kg_chart_u3c2_can_sentence_group('my','food') IS DISTINCT FROM true
    OR public.kg_chart_u3c2_can_sentence_group('my','unmapped_group') IS DISTINCT FROM true
    OR public.kg_chart_u3c2_can_sentence_group('my','private_conversation') IS NOT false THEN
  RAISE EXCEPTION 'Legacy private group/ordinary compatibility failed';END IF;
 SELECT public.kg_chart_u3c2_my_sentence_groups('my') INTO snapshot;
 IF snapshot->>'mode'<>'legacy' OR snapshot->'groups'<>'null'::jsonb
    OR snapshot::text LIKE '%example.invalid%' THEN
  RAISE EXCEPTION 'Legacy mapping endpoint exposed raw group registry: %',snapshot;END IF;
 SELECT count(*) INTO n FROM public.kg_chart_sentences
 WHERE language_code='my';
 IF n<>3 THEN RAISE EXCEPTION 'Legacy sentence read behavior changed: %',n;END IF;
 IF public.kg_chart_u3b2_can_sentence(
      'my','20000000-0000-4000-8000-000000000003') THEN
  RAISE EXCEPTION 'Legacy private sentence bypass';END IF;
 IF (SELECT count(*) FROM public.kg_chart_sentence_group_topic_map)<>0 THEN
  RAISE EXCEPTION 'Learner can list administrator mappings';END IF;
END $$;
ROLLBACK;

-- Restricted user A grants only my / Food and Sentences. A group with no
-- verified mapping is denied; guessed group names cannot override topic RLS.
BEGIN;
UPDATE public.kg_chart_access_profiles
 SET mode='restricted',revision=10 WHERE email='student1@example.invalid';
INSERT INTO public.kg_chart_access_languages(email,language_code)
 VALUES ('student1@example.invalid','my');
INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
 VALUES ('student1@example.invalid','my','food');
INSERT INTO public.kg_chart_access_features(email,feature_key)
 VALUES ('student1@example.invalid','quiz.sentences');

SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
DECLARE snapshot jsonb;n integer; sid uuid;
BEGIN
 IF public.kg_chart_u3c2_can_sentence_group('my','food') IS DISTINCT FROM true
    OR public.kg_chart_u3c2_can_sentence_group('my','unmapped_group')
    OR public.kg_chart_u3c2_can_sentence_group('my','private_conversation')
    OR public.kg_chart_u3c2_can_sentence_group('ja','animals') THEN
   RAISE EXCEPTION 'Restricted topic/group authorization mismatch'; END IF;
 SELECT public.kg_chart_u3c2_my_sentence_groups('my') INTO snapshot;
 IF snapshot->>'mode'<>'restricted'
    OR snapshot->>'server_enforced'<>'false'
    OR snapshot->'groups'<>'[{"group_name":"food","topic_id":"food"}]'::jsonb
    OR snapshot::text LIKE '%example.invalid%' THEN
   RAISE EXCEPTION 'Restricted caller-scoped mapping wrong: %',snapshot; END IF;
 IF (SELECT count(*) FROM public.kg_chart_sentences WHERE language_code='my')<>1 THEN
   RAISE EXCEPTION 'Direct RLS query exposed unmapped/private groups';END IF;
 IF public.kg_chart_u3b3b2_can_media(
      '81000000-0000-4000-8000-000000000003') THEN
   RAISE EXCEPTION 'Denied private sentence granted a signed-media asset'; END IF;
 IF public.kg_chart_u3b2_can_sentence(
      'my','20000000-0000-4000-8000-000000000001') IS DISTINCT FROM true
    OR public.kg_chart_u3b2_can_sentence(
      'my','20000000-0000-4000-8000-000000000003')
    OR public.kg_chart_u3b2_can_sentence(
      'my','87000000-0000-4000-8000-000000000001') THEN
   RAISE EXCEPTION 'Sentence-answer verification did not bind group';END IF;
 IF public.kg_chart_u3c2_can_sentence_session(
    'my',NULL,'sentence_to_meaning') IS DISTINCT FROM true
    OR public.kg_chart_u3c2_can_sentence_session('my',NULL,'speak_lines')
    OR public.kg_chart_u3c2_can_sentence_session('ja',NULL,'sentence_to_meaning') THEN
   RAISE EXCEPTION 'Sentence/speak feature selection mismatch';END IF;

 INSERT INTO public.kg_chart_quiz_sessions(
   user_id,language_code,quiz_type)
 VALUES(auth.uid(),'my','sentence_to_meaning') RETURNING id INTO sid;
 INSERT INTO public.kg_chart_quiz_answers(
   session_id,sentence_id,is_correct)
 VALUES(sid,'20000000-0000-4000-8000-000000000001',true);

 PERFORM public.u3c2_expect_rls_denied(format(
   'INSERT INTO public.kg_chart_quiz_answers(session_id,sentence_id,is_correct) VALUES (%L,%L,true)',
   sid,'20000000-0000-4000-8000-000000000003'));
 PERFORM public.u3c2_expect_rls_denied(format(
   'INSERT INTO public.kg_chart_quiz_answers(session_id,sentence_id,is_correct) VALUES (%L,%L,true)',
   sid,'87000000-0000-4000-8000-000000000001'));
 PERFORM public.u3c2_expect_rls_denied(format(
   'INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,quiz_type) VALUES (%L,%L,%L)',
   auth.uid(),'my','speak_lines'));
END $$;
ROLLBACK;

-- Restricted user B is allowed the private lesson by the fictional
-- private_lessons rule and has Speak, not generic Sentences.
BEGIN;
UPDATE public.kg_chart_access_profiles
 SET mode='restricted' WHERE email='student2@example.invalid';
INSERT INTO public.kg_chart_access_languages(email,language_code)
 VALUES ('student2@example.invalid','my');
INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
 VALUES ('student2@example.invalid','my','friends_names');
INSERT INTO public.kg_chart_access_features(email,feature_key)
 VALUES ('student2@example.invalid','quiz.speak');
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
DO $$
DECLARE snapshot jsonb;
BEGIN
 IF public.kg_chart_u3c2_can_sentence_group(
     'my','private_conversation') IS DISTINCT FROM true
    OR public.kg_chart_u3c2_can_sentence_group('my','food')
    OR public.kg_chart_u3c2_can_sentence_session(
      'my',NULL,'sentence_to_meaning')
    OR public.kg_chart_u3c2_can_sentence_session(
      'my',NULL,'speak_lines') IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Private group / Speak scope mismatch'; END IF;
 IF public.kg_chart_u3b3b2_can_media(
    '81000000-0000-4000-8000-000000000003') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Authorized private group no longer signs its sentence audio';END IF;
 SELECT public.kg_chart_u3c2_my_sentence_groups('my') INTO snapshot;
 IF snapshot->'groups'<>'[{"group_name":"private_conversation","topic_id":"friends_names"}]'::jsonb
 THEN RAISE EXCEPTION 'Private member group mapping wrong: %',snapshot;END IF;
END $$;
ROLLBACK;

-- A mapping authored but not verified must never authorize a group.
BEGIN;
UPDATE public.kg_chart_access_profiles
 SET mode='restricted' WHERE email='student1@example.invalid';
INSERT INTO public.kg_chart_access_languages(email,language_code)
 VALUES ('student1@example.invalid','ja');
INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
 VALUES ('student1@example.invalid','ja','animals');
INSERT INTO public.kg_chart_access_features(email,feature_key)
 VALUES ('student1@example.invalid','quiz.sentences');
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
BEGIN
 IF public.kg_chart_u3c2_can_sentence_group('ja','animals')
   OR public.kg_chart_u3c2_can_sentence_session(
     'ja',NULL,'sentence_to_meaning') THEN
   RAISE EXCEPTION 'Draft mapping mistakenly treated as verified'; END IF;
END $$;
ROLLBACK;

-- If a sentence's group is edited, previous topic grants cannot authorize
-- it until a new reviewed mapping is explicitly added for that group.
BEGIN;
UPDATE public.kg_chart_sentences SET group_name='unmapped_group'
 WHERE id='20000000-0000-4000-8000-000000000001';
UPDATE public.kg_chart_access_profiles
 SET mode='restricted' WHERE email='student1@example.invalid';
INSERT INTO public.kg_chart_access_languages(email,language_code)
 VALUES ('student1@example.invalid','my');
INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
 VALUES ('student1@example.invalid','my','food');
INSERT INTO public.kg_chart_access_features(email,feature_key)
 VALUES ('student1@example.invalid','quiz.sentences');
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
BEGIN
 IF public.kg_chart_u3b2_can_sentence(
   'my','20000000-0000-4000-8000-000000000001') THEN
  RAISE EXCEPTION 'Changed sentence group still authorized via stale mapping';END IF;
END $$;
ROLLBACK;

-- Existing admins retain complete reviewer visibility.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','yes',true);
SELECT set_config('kg_u3_test.uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.kg_chart_sentence_group_topic_map;
 IF n<>3 THEN RAISE EXCEPTION 'Admin lost mapping review rows'; END IF;
 IF public.kg_chart_u3c2_can_sentence_group('my','unmapped_group')
   IS DISTINCT FROM true THEN RAISE EXCEPTION 'Admin legacy sentence access changed';END IF;
END $$;
ROLLBACK;

-- Denied identity and missing session cannot enumerate mapping RPC.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
DO $$
BEGIN
 BEGIN
  PERFORM public.kg_chart_u3c2_my_sentence_groups('my');
  RAISE EXCEPTION 'U3C2_UNAPPROVED_MAPPING_RPC_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;

DO $$
BEGIN
 IF (SELECT count(*) FROM public.kg_chart_users)<>4
    OR (SELECT count(*) FROM public.kg_chart_access_profiles
         WHERE mode='restricted')<>0
    OR (SELECT count(*) FROM public.kg_chart_sentence_group_topic_map)<>3
    OR (SELECT count(*) FROM public.kg_chart_quiz_sessions)<>2
    OR (SELECT count(*) FROM public.kg_chart_quiz_answers)<>2 THEN
  RAISE EXCEPTION 'U3C2 changed preserved synthetic learner state';END IF;
END $$;
SELECT 'U3C2_GROUP_TOPIC_AUTH_PASS' AS result,
  (SELECT count(*) FROM public.kg_chart_users) AS users_preserved,
  (SELECT count(*) FROM public.kg_chart_sentence_group_topic_map) AS fictional_group_mappings;
