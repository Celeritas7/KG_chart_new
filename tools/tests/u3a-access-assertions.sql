-- U3A synthetic source-of-truth tests, isolated Docker PostgreSQL only.
-- Apply U1 fixture, U1 SQL, U3A fixture, then U3A SQL TWICE first.
\set ON_ERROR_STOP on

-- Verify execute scope, read-only function signature and unchanged user rows.
DO $$
BEGIN
  IF has_function_privilege('anon',
     'public.kg_chart_u3_my_access_snapshot()', 'EXECUTE') THEN
    RAISE EXCEPTION 'U3A accidentally permits anonymous permission reads';
  END IF;
  IF NOT has_function_privilege('authenticated',
     'public.kg_chart_u3_my_access_snapshot()', 'EXECUTE') THEN
    RAISE EXCEPTION 'U3A approved caller cannot get own snapshot';
  END IF;
  IF (SELECT pronargs FROM pg_proc
      WHERE oid='public.kg_chart_u3_my_access_snapshot()'::regprocedure)<>0 THEN
    RAISE EXCEPTION 'U3A snapshot must not accept caller-provided email or id';
  END IF;
  IF (SELECT count(*) FROM public.kg_chart_users)<>4 THEN
    RAISE EXCEPTION 'U3A modified the existing fictional KG Chart users';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kg_chart_access_profiles) THEN
    RAISE EXCEPTION 'U3A created or published any access profile';
  END IF;
END $$;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin', 'no', true);
SELECT set_config('kg_u3_test.uid', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
DO $$
DECLARE snapshot jsonb;
BEGIN
  SELECT public.kg_chart_u3_my_access_snapshot() INTO snapshot;
  IF snapshot->>'mode' <> 'legacy' OR snapshot->>'revision' <> '0'
     OR snapshot->'languages' <> 'null'::jsonb
     OR snapshot->'features' <> 'null'::jsonb
     OR snapshot->'topics' <> 'null'::jsonb
     OR snapshot->>'server_enforced' <> 'false' THEN
    RAISE EXCEPTION 'No profile must preserve legacy behavior: %', snapshot;
  END IF;
END $$;
SELECT set_config('kg_u3_test.uid', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', true);
DO $$
DECLARE snapshot jsonb;
BEGIN
  SELECT public.kg_chart_u3_my_access_snapshot() INTO snapshot;
  IF snapshot->>'mode' <> 'legacy' THEN
    RAISE EXCEPTION 'Reviewer must remain legacy until separately approved';
  END IF;
END $$;
SELECT set_config('kg_u3_test.uid', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.kg_chart_u3_my_access_snapshot();
    RAISE EXCEPTION 'U3A_UNAPPROVED_AUTH_BYPASS';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('kg_u3_test.uid', 'ffffffff-ffff-4fff-8fff-ffffffffffff', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.kg_chart_u3_my_access_snapshot();
    RAISE EXCEPTION 'U3A_UNCONFIRMED_AUTH_BYPASS';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('kg_u1_test.admin','yes',true);
SELECT set_config('kg_u3_test.uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
DO $$
DECLARE snapshot jsonb;
BEGIN
  SELECT public.kg_chart_u3_my_access_snapshot() INTO snapshot;
  IF snapshot->>'mode'<>'legacy' OR snapshot->>'server_enforced'<>'false' THEN
    RAISE EXCEPTION 'Admin legacy recovery path broken';
  END IF;
END $$;
ROLLBACK;

-- Draft-only profile returns legacy even when populated with grants.
BEGIN;
INSERT INTO public.kg_chart_access_profiles(email,mode,revision)
  VALUES ('student1@example.invalid','legacy',3);
INSERT INTO public.kg_chart_access_languages(email,language_code)
  VALUES ('student1@example.invalid','my');
INSERT INTO public.kg_chart_access_features(email,feature_key)
  VALUES ('student1@example.invalid','chart');
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
DECLARE snapshot jsonb;
BEGIN
  SELECT public.kg_chart_u3_my_access_snapshot() INTO snapshot;
  IF snapshot->>'mode'<>'legacy'
     OR snapshot->>'revision'<>'3'
     OR snapshot->'languages'<>'null'::jsonb THEN
    RAISE EXCEPTION 'U2 legacy draft must NOT be treated as restricted: %',snapshot;
  END IF;
END $$;
ROLLBACK;

-- Restricted selections are intentionally PROPOSED and NOT YET ENFORCED.
BEGIN;
INSERT INTO public.kg_chart_access_profiles(email,mode,revision) VALUES
  ('student1@example.invalid','restricted',7),
  ('student2@example.invalid','restricted',4);
INSERT INTO public.kg_chart_access_languages(email,language_code) VALUES
  ('student1@example.invalid','my'),
  ('student1@example.invalid','ja');
INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id) VALUES
  ('student1@example.invalid','my','food'),
  ('student1@example.invalid','my','friends_names'),
  ('student1@example.invalid','ja','animals');
INSERT INTO public.kg_chart_access_features(email,feature_key) VALUES
  ('student1@example.invalid','chart'),
  ('student1@example.invalid','quiz.words'),
  ('student1@example.invalid','offline.pack');
UPDATE public.kg_chart_access_feature_catalog
  SET is_active=false WHERE feature_key='offline.pack';
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
DECLARE snapshot jsonb;
BEGIN
  SELECT public.kg_chart_u3_my_access_snapshot() INTO snapshot;
  IF snapshot->>'mode'<>'restricted' OR snapshot->>'revision'<>'7'
    OR snapshot->'languages'<>'["my"]'::jsonb
    OR snapshot->'topics'<>'[{"language_code":"my","topic_id":"food"}]'::jsonb
    OR snapshot->'features'<>'["chart","quiz.words"]'::jsonb
    OR snapshot->>'server_enforced'<>'false' THEN
    RAISE EXCEPTION 'U3A filtered restricted snapshot was wrong: %', snapshot;
  END IF;
  IF snapshot::text LIKE '%student1@example.invalid%'
     OR snapshot::text LIKE '%student2@example.invalid%' THEN
    RAISE EXCEPTION 'U3A leaked an actual user identifier in snapshot';
  END IF;
END $$;
SELECT set_config('kg_u3_test.uid','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
DO $$
DECLARE snapshot jsonb;
BEGIN
  SELECT public.kg_chart_u3_my_access_snapshot() INTO snapshot;
  IF snapshot->>'mode'<>'restricted' OR snapshot->>'revision'<>'4'
      OR snapshot->'languages'<>'[]'::jsonb
      OR snapshot->'topics'<>'[]'::jsonb
      OR snapshot->'features'<>'[]'::jsonb THEN
    RAISE EXCEPTION 'U3A empty restricted grants must remain empty: %', snapshot;
  END IF;
END $$;
ROLLBACK;

-- Without an auth.uid(), no validated identity may be inferred.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','',true);
DO $$
BEGIN
  BEGIN
    PERFORM public.kg_chart_u3_my_access_snapshot();
    RAISE EXCEPTION 'U3A_ANONYMOUS_SESSION_BYPASS';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.kg_chart_access_profiles)
    OR (SELECT count(*) FROM public.kg_chart_users)<>4 THEN
    RAISE EXCEPTION 'U3A changed legacy user state or left draft data behind';
  END IF;
END $$;
SELECT 'U3A_SNAPSHOT_CONTRACT_PASS' AS result,
       (SELECT count(*) FROM public.kg_chart_users) AS synthetic_users_unchanged,
       (SELECT count(*) FROM public.kg_chart_access_profiles) AS published_profiles;
