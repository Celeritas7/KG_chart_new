-- KG Chart U2: synthetic PostgreSQL-only draft/edit tests. No production data.
-- Requires u1 fixture + U1 SQL + u2 fixture + U2 SQL applied twice.
\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',true);
DO $$
BEGIN
  BEGIN
    PERFORM public.kg_chart_u2_save_access_draft(
      'student1@example.invalid', ARRAY['my'], '[{"language_code":"my","topic_id":"food"}]'::jsonb,
      ARRAY['chart'], 0);
    RAISE EXCEPTION 'U2_UNAUTHORIZED_SAVE_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.kg_chart_access_profiles) THEN
    RAISE EXCEPTION 'Unprivileged user can read another learner profile';
  END IF;
  IF EXISTS(SELECT 1 FROM public.kg_chart_access_draft_audit) THEN
    RAISE EXCEPTION 'Unprivileged user can read audit trail';
  END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('kg_u1_test.admin','yes',true);
DO $$
DECLARE result jsonb;
BEGIN
  SELECT public.kg_chart_u2_save_access_draft(
    'student1@example.invalid',
    ARRAY['my'],
    '[{"language_code":"my","topic_id":"food"}]'::jsonb,
    ARRAY['chart','quiz.words'],
    0
  ) INTO result;
  IF result->>'mode' <> 'legacy'
     OR result->>'applied_to_learners' <> 'false'
     OR (result->>'revision')::bigint <> 1 THEN
    RAISE EXCEPTION 'U2 first draft activated restrictions: %',result;
  END IF;
  IF (SELECT count(*) FROM public.kg_chart_access_languages WHERE email='student1@example.invalid')<>1
     OR (SELECT count(*) FROM public.kg_chart_access_topics WHERE email='student1@example.invalid')<>1
     OR (SELECT count(*) FROM public.kg_chart_access_features WHERE email='student1@example.invalid')<>2
  THEN RAISE EXCEPTION 'U2 did not save complete first draft'; END IF;

  -- Compare-and-swap fails closed: a stale window must not overwrite a draft.
  BEGIN
    PERFORM public.kg_chart_u2_save_access_draft(
      'student1@example.invalid', ARRAY['ja'],
      '[{"language_code":"ja","topic_id":"animals"}]'::jsonb,
      ARRAY['chart'], 0);
    RAISE EXCEPTION 'U2_STALE_REVISION_ACCEPTED';
  EXCEPTION WHEN serialization_failure THEN NULL; END;

  -- Invalid input never changes any of the committed draft rows/revision.
  BEGIN
    PERFORM public.kg_chart_u2_save_access_draft(
      'student1@example.invalid', ARRAY['my'],
      '[{"language_code":"my","topic_id":"animals"}]'::jsonb,
      ARRAY['chart'], 1);
    RAISE EXCEPTION 'U2_UNTRANSLATED_TOPIC_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='U2_UNTRANSLATED_TOPIC_ACCEPTED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.kg_chart_u2_save_access_draft(
      'student1@example.invalid', ARRAY['my'],
      '[{"language_code":"my","topic_id":"food"}]'::jsonb,
      ARRAY['nonexistent.feature'], 1);
    RAISE EXCEPTION 'U2_UNKNOWN_FEATURE_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='U2_UNKNOWN_FEATURE_ACCEPTED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.kg_chart_u2_save_access_draft(
      'not-allowlisted@example.invalid', ARRAY['my'],'[]'::jsonb,ARRAY['chart'],0);
    RAISE EXCEPTION 'U2_UNKNOWN_USER_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='U2_UNKNOWN_USER_ACCEPTED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.kg_chart_u2_save_access_draft(
      'admin@example.invalid', ARRAY['my'],'[]'::jsonb,ARRAY['chart'],0);
    RAISE EXCEPTION 'U2_ADMIN_PROFILE_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='U2_ADMIN_PROFILE_ACCEPTED' THEN RAISE; END IF;
  END;
  IF (SELECT revision FROM public.kg_chart_access_profiles
      WHERE email='student1@example.invalid')<>1 THEN
    RAISE EXCEPTION 'Failed draft input corrupted revision'; END IF;

  SELECT public.kg_chart_u2_save_access_draft(
    'student1@example.invalid', ARRAY['ja'],
    '[{"language_code":"ja","topic_id":"animals"}]'::jsonb,
    ARRAY['quiz.typing'],1
  ) INTO result;
  IF (result->>'revision')::bigint<>2 OR result->>'mode'<>'legacy'
    OR result->>'applied_to_learners'<>'false' THEN
    RAISE EXCEPTION 'Second draft is not legacy revision 2';
  END IF;
  IF (SELECT count(*) FROM public.kg_chart_access_languages
      WHERE email='student1@example.invalid' AND language_code='ja')<>1
     OR (SELECT count(*) FROM public.kg_chart_access_topics
      WHERE email='student1@example.invalid' AND topic_id='animals')<>1
     OR (SELECT count(*) FROM public.kg_chart_access_features
      WHERE email='student1@example.invalid' AND feature_key='quiz.typing')<>1
     OR EXISTS (SELECT 1 FROM public.kg_chart_access_languages
      WHERE email='student1@example.invalid' AND language_code='my')
  THEN RAISE EXCEPTION 'Atomic replacement left obsolete draft grants'; END IF;

  IF (SELECT count(*) FROM public.kg_chart_access_draft_audit
      WHERE email='student1@example.invalid')<>2 THEN
    RAISE EXCEPTION 'U2 audit does not record two revisions'; END IF;

  -- U2 refuses any unexpectedly active restricted profile.
  UPDATE public.kg_chart_access_profiles SET mode='restricted'
    WHERE email='student1@example.invalid';
  BEGIN
    PERFORM public.kg_chart_u2_save_access_draft(
      'student1@example.invalid', ARRAY['my'],'[]'::jsonb,ARRAY['chart'],2);
    RAISE EXCEPTION 'U2_RESTRICTED_PROFILE_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='U2_RESTRICTED_PROFILE_ACCEPTED' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;

-- The full synthetic admin test was transactional and rolled back.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.kg_chart_access_profiles)
     OR EXISTS(SELECT 1 FROM public.kg_chart_access_draft_audit) THEN
   RAISE EXCEPTION 'Synthetic U2 test left permission changes behind';
 END IF;
 IF (SELECT count(*) FROM public.kg_chart_users) <> 3
     OR (SELECT count(*) FROM public.kg_chart_access_feature_catalog) <> 10
 THEN RAISE EXCEPTION 'U2 changed legacy user records or feature registry'; END IF;
END $$;

SELECT 'U2_ADMIN_DRAFT_PASS' AS result,
  (SELECT count(*) FROM public.kg_chart_users) AS synthetic_users_preserved,
  (SELECT count(*) FROM public.kg_chart_access_profiles) AS live_draft_rows;
