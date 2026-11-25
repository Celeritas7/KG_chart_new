-- U4B2: combined installed-source RLS test on disposable PostgreSQL ONLY.
\set ON_ERROR_STOP on
BEGIN;
UPDATE public.kg_chart_access_profiles SET mode='restricted',revision=20
 WHERE email='student1@example.invalid';
INSERT INTO public.kg_chart_access_languages(email,language_code)
 VALUES ('student1@example.invalid','my');
INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
 VALUES ('student1@example.invalid','my','food');
INSERT INTO public.kg_chart_access_features(email,feature_key)
 VALUES ('student1@example.invalid','chart'),('student1@example.invalid','quiz.words');
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
DECLARE s jsonb; sid uuid;
BEGIN
 s:=public.kg_chart_u3_my_access_snapshot();
 IF s->>'mode' IS DISTINCT FROM 'restricted'
    OR s->>'server_enforced' IS DISTINCT FROM 'false'
    OR s->'languages' IS DISTINCT FROM '["my"]'::jsonb
    OR s->'topics' IS DISTINCT FROM '[{"language_code":"my","topic_id":"food"}]'::jsonb
 THEN RAISE EXCEPTION 'U4B2 snapshot mismatch'; END IF;
 IF (SELECT count(*) FROM public.kg_chart_vocabulary)<>1
 OR (SELECT count(*) FROM public.kg_chart_vocabulary_translations)<>1
 OR EXISTS(SELECT 1 FROM public.kg_chart_languages WHERE code<>'my')
 OR EXISTS(SELECT 1 FROM public.kg_chart_sentences)
 OR EXISTS(SELECT 1 FROM public.kg_chart_quiz_sessions WHERE user_id<>auth.uid())
 OR EXISTS(SELECT 1 FROM public.kg_chart_private_media_assets)
 OR public.kg_chart_u3b3b2_can_media('81000000-0000-4000-8000-000000000001') IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'U4B2 unauthorized read'; END IF;
 INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,topic_id,quiz_type)
 VALUES(auth.uid(),'my','food','native_to_image') RETURNING id INTO sid;
 INSERT INTO public.kg_chart_quiz_answers(session_id,vocabulary_id,is_correct)
 VALUES(sid,'10000000-0000-4000-8000-000000000001',true);
 BEGIN
 INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,topic_id,quiz_type)
 VALUES(auth.uid(),'ja','animals','native_to_image');
 RAISE EXCEPTION 'Denied language write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
 INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,topic_id,quiz_type)
 VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','my','food','native_to_image');
 RAISE EXCEPTION 'Cross-owner write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
 INSERT INTO public.kg_chart_quiz_answers(session_id,vocabulary_id,is_correct)
 VALUES(sid,'10000000-0000-4000-8000-000000000004',true);
 RAISE EXCEPTION 'Private answer accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- A new statement after revocation in the same transaction; this is NOT
-- a concurrency/atomic-revision test or proof about real JWTs.
DELETE FROM public.kg_chart_access_topics WHERE email='student1@example.invalid';
UPDATE public.kg_chart_access_profiles SET revision=21 WHERE email='student1@example.invalid';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.kg_chart_vocabulary)
 OR EXISTS(SELECT 1 FROM public.kg_chart_vocabulary_translations)
 OR public.kg_chart_u3b1_can_topic('my','food') IS DISTINCT FROM false
 OR (public.kg_chart_u3_my_access_snapshot()->>'revision') IS DISTINCT FROM '21'
 THEN RAISE EXCEPTION 'Revoked grant remains readable'; END IF;
 BEGIN
 INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,topic_id,quiz_type)
 VALUES(auth.uid(),'my','food','native_to_image');
 RAISE EXCEPTION 'Revoked write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF NOT EXISTS(SELECT 1 FROM public.kg_chart_quiz_sessions WHERE user_id=auth.uid() AND topic_id='food')
 THEN RAISE EXCEPTION 'Historical progress lost'; END IF;
END $$;
ROLLBACK;
SELECT 'U4B2_SYNTHETIC_DATABASE_PASS' AS result;
