-- U3B3B2: fictional PRIVATE media registry and authorization assertions.
-- No Storage objects or networks. U1/U3A/U3B1/U3B2/U3B3A/U3B3B1
-- source fixtures + U3B3B2 SQL and fixture must be loaded before this.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF (SELECT count(*) FROM public.kg_chart_private_media_assets)<>8 THEN
    RAISE EXCEPTION 'Expected eight fictional registry rows'; END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename='kg_chart_private_media_assets'
        AND policyname='kg_u3b3b2_admin_only')<>1 THEN
    RAISE EXCEPTION 'Registry admin-only RLS policy missing'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE
    oid='public.kg_chart_private_media_assets'::regclass) THEN
    RAISE EXCEPTION 'Registry RLS disabled'; END IF;
  IF has_table_privilege('anon','public.kg_chart_private_media_assets','SELECT')
     OR has_function_privilege('anon',
       'public.kg_chart_u3b3b2_can_media(uuid)','EXECUTE')
     OR has_function_privilege('anon',
       'public.kg_chart_u3b3b2_my_media_asset(text,uuid,text,text,text)',
       'EXECUTE')
  THEN RAISE EXCEPTION 'Anonymous private-media metadata exposure'; END IF;

  BEGIN
    INSERT INTO public.kg_chart_private_media_assets
      (source_type,source_id,language_code,voice,mime_type,
       expected_native_text,classification,state)
    VALUES ('word_audio','10000000-0000-4000-8000-000000000004',
      'ja','m','audio/mpeg','some text','private_exclusive','verified');
    RAISE EXCEPTION 'U3B3B2_UNVERIFIED_SIGNING_ROW_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- A normal authorized legacy learner is deliberately excluded from the
-- friends_names private lesson; knowing an asset UUID cannot bypass access.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$
DECLARE n integer;asset uuid;
BEGIN
  SELECT count(*) INTO n FROM public.kg_chart_private_media_assets;
  IF n<>0 THEN RAISE EXCEPTION 'Non-admin can list private registry'; END IF;

  IF public.kg_chart_u3b3b2_can_media(
      '81000000-0000-4000-8000-000000000001')
      OR public.kg_chart_u3b3b2_can_media(
      '81000000-0000-4000-8000-000000000002')
      OR public.kg_chart_u3b3b2_can_media(
      '81000000-0000-4000-8000-000000000003')
      OR public.kg_chart_u3b3b2_can_media(
      '81000000-0000-4000-8000-000000000004')
  THEN RAISE EXCEPTION 'Unapproved private lesson accessed through guessed asset UUID'; END IF;
  IF public.kg_chart_u3b3b2_can_media(
      '81000000-0000-4000-8000-000000000005')
      OR public.kg_chart_u3b3b2_can_media(
      '81000000-0000-4000-8000-000000000006')
  THEN RAISE EXCEPTION 'Shared/staged or stale asset treated as verified'; END IF;
  asset:=public.kg_chart_u3b3b2_my_media_asset(
    'word_audio','10000000-0000-4000-8000-000000000004',
    NULL,'my','m');
  IF asset IS NOT NULL THEN RAISE EXCEPTION 'Resource lookup exposed private ID'; END IF;
  IF public.kg_chart_u3b3b2_my_media_asset(
      'topic_audio',NULL,'friends_names','my','f') IS NOT NULL
  THEN RAISE EXCEPTION 'Denied topic lookup revealed asset'; END IF;
END $$;
ROLLBACK;

-- Student2 is explicitly allowed the private lesson by fictional settings.
-- The source-bound lookup permits each of 5 legitimate resource types only
-- if the object was classified/verified and real source text still matches.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
DO $$
DECLARE asset uuid;expected uuid;
BEGIN
  FOR expected IN SELECT unnest(ARRAY[
    '81000000-0000-4000-8000-000000000001'::uuid,
    '81000000-0000-4000-8000-000000000002'::uuid,
    '81000000-0000-4000-8000-000000000003'::uuid,
    '81000000-0000-4000-8000-000000000004'::uuid,
    '81000000-0000-4000-8000-000000000007'::uuid,
    '81000000-0000-4000-8000-000000000008'::uuid
  ]) LOOP
    IF public.kg_chart_u3b3b2_can_media(expected) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Permitted source not resolved: %',expected; END IF;
  END LOOP;

  asset:=public.kg_chart_u3b3b2_my_media_asset(
    'word_audio','10000000-0000-4000-8000-000000000004',
    NULL,'my','m');
  IF asset IS DISTINCT FROM '81000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'Authorized word->asset mapping failed';END IF;
  asset:=public.kg_chart_u3b3b2_my_media_asset(
    'topic_audio',NULL,'friends_names','my','f');
  IF asset IS DISTINCT FROM '81000000-0000-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'Authorized topic->asset mapping failed';END IF;
  asset:=public.kg_chart_u3b3b2_my_media_asset(
    'word_image','10000000-0000-4000-8000-000000000004',
    NULL,'my',NULL);
  IF asset IS DISTINCT FROM '81000000-0000-4000-8000-000000000004' THEN
    RAISE EXCEPTION 'Authorized private picture mapping failed';END IF;
  asset:=public.kg_chart_u3b3b2_my_media_asset(
    'word_audio','10000000-0000-4000-8000-000000000004',
    NULL,'my','f');
  IF asset IS NOT NULL THEN
    RAISE EXCEPTION 'Unstaged female voice unexpectedly authorized';END IF;
  asset:=public.kg_chart_u3b3b2_my_media_asset(
    'topic_audio',NULL,'friends_names','ja','f');
  IF asset IS NOT NULL THEN
    RAISE EXCEPTION 'Cross-language topic access unexpectedly authorized';END IF;
END $$;
ROLLBACK;

-- Explicitly restricted profile with grants only for word/topic but NOT
-- sentence/colour feature cannot sign sentence or colour media.
BEGIN;
UPDATE public.kg_chart_access_profiles
  SET mode='restricted',revision=15
  WHERE email='student2@example.invalid';
INSERT INTO public.kg_chart_access_languages(email,language_code)
VALUES ('student2@example.invalid','my');
INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
VALUES ('student2@example.invalid','my','friends_names');
INSERT INTO public.kg_chart_access_features(email,feature_key)
VALUES ('student2@example.invalid','quiz.words'),
       ('student2@example.invalid','chart');
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
DO $$
BEGIN
  IF NOT public.kg_chart_u3b3b2_can_media(
      '81000000-0000-4000-8000-000000000001')
     OR public.kg_chart_u3b3b2_can_media(
      '81000000-0000-4000-8000-000000000003')
     OR public.kg_chart_u3b3b2_can_media(
      '81000000-0000-4000-8000-000000000007') THEN
    RAISE EXCEPTION 'Restricted feature/sentence scope mismatch'; END IF;
END $$;
ROLLBACK;

-- A revoked/edited underlying word invalidates otherwise valid registry
-- metadata even if the signed asset key still exists in private storage.
BEGIN;
UPDATE public.kg_chart_vocabulary_translations
  SET native_text='edited-private-text'
  WHERE vocabulary_id='10000000-0000-4000-8000-000000000004'
    AND language_code='my';
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
DO $$
BEGIN
  IF public.kg_chart_u3b3b2_can_media(
       '81000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Stale audio allowed after word text edit'; END IF;
END $$;
ROLLBACK;

-- Forged image source title/path cannot be used after an edit.
BEGIN;
UPDATE public.kg_chart_vocabulary SET image_filename='changed.jpg'
  WHERE id='10000000-0000-4000-8000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
DO $$
BEGIN
  IF public.kg_chart_u3b3b2_can_media(
       '81000000-0000-4000-8000-000000000004') THEN
    RAISE EXCEPTION 'Old private picture still authorized after replacement'; END IF;
END $$;
ROLLBACK;

-- Admin can inspect asset registry and see legitimate verified media.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','yes',true);
SELECT set_config('kg_u3_test.uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.kg_chart_private_media_assets;
  IF n<>8 THEN RAISE EXCEPTION 'Administrator cannot review the registry';END IF;
  IF NOT public.kg_chart_u3b3b2_can_media(
       '81000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Administrator lost verified private media';END IF;
END $$;
ROLLBACK;

-- Unapproved and missing sessions cannot enumerate or authorize any asset.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
SELECT set_config('kg_u3_test.uid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
DO $$
BEGIN
  IF public.kg_chart_u3b3b2_can_media(
    '81000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Unapproved account signed media';END IF;
END $$;
SELECT set_config('kg_u3_test.uid','',true);
DO $$
BEGIN
  IF public.kg_chart_u3b3b2_can_media(
    '81000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Anonymous current session signed media';END IF;
END $$;
ROLLBACK;

-- All fictional policy changes rolled back and no real Storage action occurs.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.kg_chart_private_media_assets)<>8
     OR (SELECT count(*) FROM public.kg_chart_users)<>4
     OR (SELECT count(*) FROM public.kg_chart_access_profiles)<>2
     OR EXISTS (SELECT 1 FROM public.kg_chart_access_profiles
                WHERE mode='restricted') THEN
    RAISE EXCEPTION 'U3B3B2 synthetic policies changed account state';END IF;
END $$;
SELECT 'U3B3B2_PRIVATE_DELIVERY_CONTRACT_PASS' AS result,
  (SELECT count(*) FROM public.kg_chart_users) AS fictional_users_unchanged,
  (SELECT count(*) FROM public.kg_chart_private_media_assets) AS synthetic_registry_rows;
