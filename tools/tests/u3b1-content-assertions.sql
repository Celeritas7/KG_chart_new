-- U3B1: real PostgreSQL row-level security tests with invented learners.
-- Requires U1 + U3A fictional fixtures, U3B1 content fixture,
-- then U3B1 RLS SQL twice. All simulated writes are rolled back.
\set ON_ERROR_STOP on

DO $$
DECLARE expected text[];
BEGIN
  expected := ARRAY[
    'kg_chart_languages','kg_chart_topics','kg_chart_topic_translations',
    'kg_chart_vocabulary','kg_chart_vocabulary_translations',
    'kg_chart_sentences','kg_chart_colour_phrases','kg_chart_settings',
    'kg_chart_flags'];
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename = ANY(expected)
        AND policyname='kg_u3b1_read' AND permissive='RESTRICTIVE'
        AND cmd='SELECT')<>9
  THEN RAISE EXCEPTION 'U3B1 did not create all 9 restrictive SELECT policies'; END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename=ANY(expected)
        AND policyname='allowed_read' AND permissive='PERMISSIVE'
        AND cmd='SELECT')<>9
  THEN RAISE EXCEPTION 'U3B1 changed existing permissive policies'; END IF;
  IF has_function_privilege('anon','public.kg_chart_u3b1_can_language(text)','EXECUTE')
    OR has_function_privilege('anon','public.kg_chart_u3b1_can_topic(text,text)','EXECUTE')
    OR has_function_privilege('anon','public.kg_chart_u3b1_can_setting(text)','EXECUTE')
  THEN RAISE EXCEPTION 'U3B1 helper callable by anonymous role'; END IF;
  IF (SELECT count(*) FROM public.kg_chart_access_profiles)<>0
  THEN RAISE EXCEPTION 'U3B1 created restricted users automatically'; END IF;
END $$;

-- Legacy must preserve old visibility, including the current RLS's weak
-- client-only private-topic filtering (documented as an unresolved privacy
-- issue, NOT claimed private by U3B1).
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
DECLARE lang_count int; topic_count int; word_count int; settings_count int;
BEGIN
  SELECT count(*) INTO lang_count FROM public.kg_chart_languages;
  SELECT count(*) INTO topic_count FROM public.kg_chart_topics;
  SELECT count(*) INTO word_count FROM public.kg_chart_vocabulary;
  SELECT count(*) INTO settings_count FROM public.kg_chart_settings;
  IF lang_count<>3 OR topic_count<>4 OR word_count<>4 OR settings_count<>3 THEN
    RAISE EXCEPTION 'Legacy learner changed: languages %, topics %, words %, settings %',
      lang_count,topic_count,word_count,settings_count;
  END IF;
  IF NOT public.kg_chart_u3b1_can_language('ja')
     OR NOT public.kg_chart_u3b1_can_topic('my','friends_names') THEN
    RAISE EXCEPTION 'Legacy app access was unexpectedly denied'; END IF;
END $$;
ROLLBACK;

-- RLS must defend against an OTHER permissive policy whose USING is true.
-- The policy is created only in this fictional test DB.
CREATE POLICY synthetic_permissive_bypass ON public.kg_chart_topic_translations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY synthetic_permissive_bypass ON public.kg_chart_vocabulary
  FOR SELECT TO authenticated USING (true);

-- A restricted learner may read only a subset of languages/topics/words and
-- safe setting keys. No U3C UI is involved in this test: direct SQL read.
BEGIN;
INSERT INTO public.kg_chart_access_profiles(email,mode,revision)
VALUES ('student1@example.invalid','restricted',3),
       ('student2@example.invalid','restricted',4);
INSERT INTO public.kg_chart_access_languages(email,language_code) VALUES
 ('student1@example.invalid','my'),
 ('student1@example.invalid','th');
INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id) VALUES
 ('student1@example.invalid','my','food'),
 ('student1@example.invalid','my','colours'),
 ('student1@example.invalid','my','friends_names'),
 ('student1@example.invalid','th','food');
INSERT INTO public.kg_chart_access_features(email,feature_key) VALUES
 ('student1@example.invalid','chart'),
 ('student1@example.invalid','quiz.sentences'),
 ('student1@example.invalid','quiz.colours');

SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM public.kg_chart_languages;
  IF c<>1 THEN RAISE EXCEPTION 'Restricted language leak: %',c; END IF;
  IF EXISTS(SELECT 1 FROM public.kg_chart_languages WHERE code IN ('ja','th'))
  THEN RAISE EXCEPTION 'Restricted language bypass';END IF;

  SELECT count(*) INTO c FROM public.kg_chart_topics;
  IF c<>2 THEN RAISE EXCEPTION 'Restricted parent topic leak: %',c; END IF;
  SELECT count(*) INTO c FROM public.kg_chart_topic_translations;
  IF c<>2 THEN RAISE EXCEPTION 'RLS leaked topic translation via permissive policy: %',c; END IF;
  IF EXISTS(SELECT 1 FROM public.kg_chart_topic_translations WHERE
      topic_id='friends_names' OR language_code<>'my')
  THEN RAISE EXCEPTION 'Private friend or other language topic leaked';END IF;

  SELECT count(*) INTO c FROM public.kg_chart_vocabulary;
  IF c<>2 THEN RAISE EXCEPTION 'Vocab parent leaked via permissive policy: %',c; END IF;
  SELECT count(*) INTO c FROM public.kg_chart_vocabulary_translations;
  IF c<>2 THEN RAISE EXCEPTION 'Vocab translation leak: %',c; END IF;
  IF EXISTS(SELECT 1 FROM public.kg_chart_vocabulary_translations
    WHERE language_code<>'my' OR native_text LIKE '%private%')
  THEN RAISE EXCEPTION 'Wrong language or private name translation leak';END IF;
  SELECT count(*) INTO c FROM public.kg_chart_vocabulary v
   LEFT JOIN public.kg_chart_vocabulary_translations vt ON vt.vocabulary_id=v.id;
  IF c<>2 THEN RAISE EXCEPTION 'Nested vocabulary join leaked translations: %',c;END IF;

  SELECT count(*) INTO c FROM public.kg_chart_sentences;
  IF c<>1 THEN RAISE EXCEPTION 'Sentence scope not enforced: %',c;END IF;
  SELECT count(*) INTO c FROM public.kg_chart_colour_phrases;
  IF c<>1 THEN RAISE EXCEPTION 'Colour phrase grant not enforced: %',c;END IF;
  SELECT count(*) INTO c FROM public.kg_chart_settings;
  IF c<>2 THEN RAISE EXCEPTION 'Settings leak for restricted learner: %',c;END IF;
  IF EXISTS(SELECT 1 FROM public.kg_chart_settings WHERE key='private_lessons')
  THEN RAISE EXCEPTION 'Private lesson email list leaked';END IF;
  SELECT count(*) INTO c FROM public.kg_chart_flags;
  IF c<>0 THEN RAISE EXCEPTION 'Other users flag notes leaked: %',c;END IF;
  IF public.kg_chart_u3b1_can_feature('quiz.words')
     OR public.kg_chart_u3b1_can_language('ja')
     OR public.kg_chart_u3b1_can_topic('my','friends_names') THEN
    RAISE EXCEPTION 'Restricted helper exposed disallowed content'; END IF;
  IF NOT public.kg_chart_u3b1_can_feature('chart') THEN
    RAISE EXCEPTION 'Restricted helper denied selected feature'; END IF;
END $$;

-- The OTHER restricted learner has an empty policy and sees no content.
SELECT set_config('kg_u3_test.uid','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
DO $$
DECLARE c int;
BEGIN
  SELECT (
    (SELECT count(*) FROM public.kg_chart_languages)+
    (SELECT count(*) FROM public.kg_chart_topics)+
    (SELECT count(*) FROM public.kg_chart_vocabulary)+
    (SELECT count(*) FROM public.kg_chart_topic_translations)+
    (SELECT count(*) FROM public.kg_chart_vocabulary_translations)+
    (SELECT count(*) FROM public.kg_chart_sentences)+
    (SELECT count(*) FROM public.kg_chart_colour_phrases)+
    (SELECT count(*) FROM public.kg_chart_settings)+
    (SELECT count(*) FROM public.kg_chart_flags)
  ) INTO c;
  IF c<>0 THEN RAISE EXCEPTION 'Empty restricted grants are not fail-closed: %',c; END IF;
END $$;

-- Existing administrator access still works; those are NOT U3B1
-- restrictions, and the private lessons remain visible to the admin.
SELECT set_config('kg_u1_test.admin','yes',true);
SELECT set_config('kg_u3_test.uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM public.kg_chart_topic_translations;
  IF c<>6 THEN RAISE EXCEPTION 'Admin lost topics: %',c; END IF;
  SELECT count(*) INTO c FROM public.kg_chart_flags;
  IF c<>1 THEN RAISE EXCEPTION 'Admin lost review flags: %',c; END IF;
END $$;
ROLLBACK;

-- A malformed existing private-lessons setting must deny restricted topics,
-- never accidentally make personal names accessible.
BEGIN;
INSERT INTO public.kg_chart_access_profiles(email,mode,revision)
VALUES ('student1@example.invalid','restricted',1);
INSERT INTO public.kg_chart_access_languages(email,language_code)
VALUES ('student1@example.invalid','my');
INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
VALUES ('student1@example.invalid','my','food');
UPDATE public.kg_chart_settings SET value='{}'::jsonb WHERE key='private_lessons';
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.kg_chart_topics)
  THEN RAISE EXCEPTION 'Malformed private lesson setting leaked content'; END IF;
END $$;
ROLLBACK;

-- An unapproved or missing Auth user cannot invoke the helper to get data.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.kg_chart_languages)
    OR public.kg_chart_u3b1_can_language('my') THEN
   RAISE EXCEPTION 'Unapproved user read content'; END IF;
END $$;
SELECT set_config('kg_u3_test.uid','',true);
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.kg_chart_vocabulary)
    OR public.kg_chart_u3b1_can_feature('chart') THEN
   RAISE EXCEPTION 'Unsigned user read content'; END IF;
END $$;
ROLLBACK;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.kg_chart_access_profiles)
    OR (SELECT count(*) FROM public.kg_chart_users)<>4 THEN
    RAISE EXCEPTION 'U3B1 tests changed fictional user roles or profiles'; END IF;
END $$;
SELECT 'U3B1_RESTRICTIVE_RLS_PASS' AS result,
 (SELECT count(*) FROM public.kg_chart_users) AS preserved_users,
 (SELECT count(*) FROM public.kg_chart_access_profiles) AS restricted_profiles_activated;
