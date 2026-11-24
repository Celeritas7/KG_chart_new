-- U1 CI assertions. Run only against isolated fictional Postgres after
-- applying sql/kg-chart-u1-access-foundation.sql TWICE for idempotence.
\set ON_ERROR_STOP on

DO $$
DECLARE
  count_users integer;
  catalog_count integer;
  rows_count integer;
BEGIN
  SELECT count(*) INTO count_users FROM public.kg_chart_users;
  IF count_users <> 3 THEN RAISE EXCEPTION 'U1 changed existing learners'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kg_chart_users WHERE email='student1@example.invalid' AND role='operator')
     OR NOT EXISTS (SELECT 1 FROM public.kg_chart_users WHERE email='student2@example.invalid' AND role='operator')
     OR NOT EXISTS (SELECT 1 FROM public.kg_chart_users WHERE email='admin@example.invalid' AND role='admin')
  THEN RAISE EXCEPTION 'U1 modified existing roles'; END IF;

  SELECT count(*) INTO catalog_count FROM public.kg_chart_access_feature_catalog;
  IF catalog_count <> 10 THEN RAISE EXCEPTION 'U1 catalog not idempotent: %', catalog_count; END IF;
  SELECT
    (SELECT count(*) FROM public.kg_chart_access_profiles) +
    (SELECT count(*) FROM public.kg_chart_access_languages) +
    (SELECT count(*) FROM public.kg_chart_access_topics) +
    (SELECT count(*) FROM public.kg_chart_access_features)
    INTO rows_count;
  IF rows_count <> 0 THEN RAISE EXCEPTION 'U1 unexpectedly changed learner permissions'; END IF;
  IF EXISTS (
     SELECT 1 FROM pg_class c
     WHERE c.oid IN (
      'public.kg_chart_access_profiles'::regclass,
      'public.kg_chart_access_languages'::regclass,
      'public.kg_chart_access_topics'::regclass,
      'public.kg_chart_access_features'::regclass,
      'public.kg_chart_access_feature_catalog'::regclass
     ) AND NOT c.relrowsecurity
  ) THEN RAISE EXCEPTION 'U1 RLS missing'; END IF;

  IF has_table_privilege('anon', 'public.kg_chart_access_profiles', 'SELECT')
     OR has_table_privilege('anon', 'public.kg_chart_access_topics', 'SELECT')
     OR has_table_privilege('anon', 'public.kg_chart_access_features', 'SELECT')
     OR has_table_privilege('anon', 'public.kg_chart_access_feature_catalog', 'SELECT')
  THEN RAISE EXCEPTION 'U1 exposes a permissions table to anonymous users'; END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename LIKE 'kg_chart_access_%'
        AND policyname='kg_u1_admin_only') <> 5
  THEN RAISE EXCEPTION 'Missing admin-only RLS policy'; END IF;
END $$;

-- Non-admin authenticated user must be unable to read or change any policy.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin', 'no', true);
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.kg_chart_access_feature_catalog;
  IF n <> 0 THEN RAISE EXCEPTION 'Non-admin could read feature catalog'; END IF;
  SELECT count(*) INTO n FROM public.kg_chart_access_profiles;
  IF n <> 0 THEN RAISE EXCEPTION 'Non-admin could read permission profiles'; END IF;
  BEGIN
    INSERT INTO public.kg_chart_access_profiles(email,mode)
      VALUES ('student1@example.invalid','restricted');
    RAISE EXCEPTION 'Non-admin unexpectedly inserted permission profile';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- correct: RLS prevented insert
  END;
  BEGIN
    DELETE FROM public.kg_chart_access_feature_catalog WHERE feature_key='chart';
    IF FOUND THEN RAISE EXCEPTION 'Non-admin deleted feature catalog'; END IF;
  END;
END $$;
ROLLBACK;

-- A valid *admin-only future draft* must be representable, without changing
-- any live app code, and without being able to grant untranslated topics or
-- unknown feature keys. Roll back all synthetic writes when finished.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin', 'yes', true);
INSERT INTO public.kg_chart_access_profiles(email,mode)
  VALUES ('student1@example.invalid','legacy');
INSERT INTO public.kg_chart_access_languages(email,language_code)
  VALUES ('student1@example.invalid','my');
INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
  VALUES ('student1@example.invalid','my','food');
INSERT INTO public.kg_chart_access_features(email,feature_key)
  VALUES ('student1@example.invalid','chart'),('student1@example.invalid','quiz.words');

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.kg_chart_access_topics
    WHERE email='student1@example.invalid';
  IF n <> 1 THEN RAISE EXCEPTION 'Admin grant missing'; END IF;

  IF (SELECT mode FROM public.kg_chart_access_profiles
      WHERE email='student1@example.invalid') <> 'legacy'
  THEN RAISE EXCEPTION 'Creating a draft unexpectedly activates restricted access'; END IF;

  BEGIN
    INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
      VALUES ('student1@example.invalid','ja','animals');
    RAISE EXCEPTION 'Unselected language was accepted for topic grant';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  BEGIN
    INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
      VALUES ('student1@example.invalid','my','animals');
    RAISE EXCEPTION 'Topic without a translation in selected language was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  BEGIN
    INSERT INTO public.kg_chart_access_features(email,feature_key)
      VALUES ('student1@example.invalid','nonexistent.feature');
    RAISE EXCEPTION 'Unknown feature was granted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  BEGIN
    INSERT INTO public.kg_chart_access_profiles(email,mode)
      VALUES ('not-allowlisted@example.invalid','restricted');
    RAISE EXCEPTION 'Nonexistent KG allowlist user gained a profile';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
ROLLBACK;

-- Confirm the disposable database is back to a no-profile legacy baseline.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.kg_chart_access_profiles)
   OR EXISTS (SELECT 1 FROM public.kg_chart_access_languages)
   OR EXISTS (SELECT 1 FROM public.kg_chart_access_topics)
   OR EXISTS (SELECT 1 FROM public.kg_chart_access_features)
 THEN RAISE EXCEPTION 'U1 synthetic test leaked permission rows'; END IF;
END $$;

SELECT 'U1_ACCESS_FOUNDATION_PASS' AS result,
       (SELECT count(*) FROM public.kg_chart_users) AS legacy_users_preserved,
       (SELECT count(*) FROM public.kg_chart_access_feature_catalog) AS supported_features;
