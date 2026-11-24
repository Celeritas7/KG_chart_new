-- KG Chart U3C2A: verified sentence group -> learning topic authorization.
-- REVIEW-ONLY: do not run against Technical Supabase without separate
-- user-approved backup, ordered U1..U3B3B2 installation and release plan.
-- No production data, groups or restricted user profiles are inserted.
-- Existing legacy users, saved quiz records and offline outboxes are preserved.
-- Requires U1, U3B1, U3B2, U3B3A and U3B3B1.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('kg_chart_u3c2_sentence_group_contract'));

CREATE TABLE IF NOT EXISTS public.kg_chart_sentence_group_topic_map (
  language_code varchar NOT NULL,
  group_name text NOT NULL CHECK (btrim(group_name)<>'' AND group_name=btrim(group_name)),
  topic_id varchar NOT NULL,
  review_status text NOT NULL DEFAULT 'draft'
    CHECK (review_status IN ('draft','verified','disabled')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  evidence_sha256 text CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (language_code,group_name),
  CONSTRAINT kg_u3c2_existing_translation_fk
    FOREIGN KEY (topic_id,language_code)
    REFERENCES public.kg_chart_topic_translations(topic_id,language_code)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT kg_u3c2_verified_evidence CHECK(
    review_status<>'verified' OR (
      reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND evidence_sha256 IS NOT NULL))
);

ALTER TABLE public.kg_chart_sentence_group_topic_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kg_chart_sentence_group_topic_map
  FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.kg_chart_sentence_group_topic_map
  TO authenticated,service_role;

DROP POLICY IF EXISTS kg_u3c2_admin_only ON public.kg_chart_sentence_group_topic_map;
CREATE POLICY kg_u3c2_admin_only ON public.kg_chart_sentence_group_topic_map
  FOR ALL TO authenticated
  USING ((SELECT public.kg_chart_is_admin()))
  WITH CHECK ((SELECT public.kg_chart_is_admin()));

-- A boolean, identity-bound predicate. Legacy users keep their old
-- non-private sentence groups. Restricted users require a real, current,
-- reviewed mapping AND a granted/translated topic. Missing mapping = deny.
CREATE OR REPLACE FUNCTION public.kg_chart_u3c2_can_sentence_group(
  p_language text,p_group text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_topic varchar;
BEGIN
  IF p_language IS NULL OR p_group IS NULL OR btrim(p_group)=''
    OR auth.uid() IS NULL
    OR public.kg_chart_u3b1_can_language(p_language) IS DISTINCT FROM true
  THEN RETURN false; END IF;

  -- The old, separate private_lessons rule applies to BOTH modes.
  IF public.kg_chart_u3b3a_private_sentence(p_language,p_group)
       IS DISTINCT FROM true THEN RETURN false; END IF;
  IF public.kg_chart_is_admin() THEN RETURN true; END IF;
  IF public.kg_chart_u3b2_is_legacy() THEN RETURN true; END IF;

  SELECT m.topic_id INTO v_topic
  FROM public.kg_chart_sentence_group_topic_map m
  WHERE m.language_code=p_language AND m.group_name=p_group
    AND m.review_status='verified'
    AND m.reviewed_by IS NOT NULL
    AND m.reviewed_at IS NOT NULL
    AND m.evidence_sha256 IS NOT NULL;

  IF v_topic IS NULL THEN RETURN false; END IF;
  RETURN public.kg_chart_u3b1_can_topic(p_language,v_topic::text) IS TRUE
    AND public.kg_chart_u3b3a_private_topic(p_language,v_topic::text) IS TRUE;
END $fn$;

-- U3B2's stored answer and U3B3B1 pronunciation predicates call this
-- function already. Replacing the same signature closes the formerly
-- missing topic-grant check for restricted sentence and speaking records.
CREATE OR REPLACE FUNCTION public.kg_chart_u3b2_can_sentence(
  p_lang text,p_sentence uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_group text;v_lang text;
BEGIN
  IF p_sentence IS NULL OR p_lang IS NULL OR auth.uid() IS NULL
  THEN RETURN false; END IF;
  SELECT s.group_name,s.language_code INTO v_group,v_lang
    FROM public.kg_chart_sentences s WHERE s.id=p_sentence;
  IF NOT FOUND OR v_lang IS DISTINCT FROM p_lang THEN RETURN false; END IF;
  IF public.kg_chart_u3c2_can_sentence_group(p_lang,v_group)
    IS DISTINCT FROM true THEN RETURN false; END IF;
  IF public.kg_chart_u3b2_is_legacy() THEN RETURN true; END IF;
  RETURN public.kg_chart_u3b1_can_feature('quiz.sentences') IS TRUE
      OR public.kg_chart_u3b1_can_feature('quiz.speak') IS TRUE;
END $fn$;

-- New sentence/speak sessions without a topic_id must NOT imply universal
-- group access. Verify an actual mapped, currently permitted group exists.
CREATE OR REPLACE FUNCTION public.kg_chart_u3c2_can_sentence_session(
  p_lang text,p_topic text,p_type text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_feature text;
BEGIN
  IF auth.uid() IS NULL
    OR public.kg_chart_is_allowed() IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF p_type NOT IN (
      'sentence_to_meaning','meaning_to_sentence','build_sentence',
      'speak_lines','speak_paragraph')
    THEN RETURN true; END IF;
  IF public.kg_chart_u3b1_can_language(p_lang)
     IS DISTINCT FROM true THEN RETURN false; END IF;
  IF p_topic IS NOT NULL AND public.kg_chart_u3b1_can_topic(p_lang,p_topic)
    IS DISTINCT FROM true THEN RETURN false; END IF;
  IF public.kg_chart_u3b2_is_legacy() THEN RETURN true; END IF;

  v_feature := CASE
    WHEN p_type IN ('speak_lines','speak_paragraph') THEN 'quiz.speak'
    ELSE 'quiz.sentences'
  END;
  IF public.kg_chart_u3b1_can_feature(v_feature)
     IS DISTINCT FROM true THEN RETURN false; END IF;

  RETURN EXISTS(
    SELECT 1 FROM public.kg_chart_sentence_group_topic_map m
    WHERE m.language_code=p_lang AND m.review_status='verified'
      AND m.reviewed_by IS NOT NULL AND m.reviewed_at IS NOT NULL
      AND m.evidence_sha256 IS NOT NULL
      AND (p_topic IS NULL OR m.topic_id=p_topic)
      AND public.kg_chart_u3c2_can_sentence_group(p_lang,m.group_name)
  );
END $fn$;

-- Allow the signed-in client to retrieve only its verified group names
-- without exposing the admin registry or unrelated learner assignments.
-- This is NOT a permission token; U3C1 already requires a server-enforced
-- snapshot, and table/RPC RLS must separately authorize every row.
CREATE OR REPLACE FUNCTION public.kg_chart_u3c2_my_sentence_groups(
  p_language text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_groups jsonb;
BEGIN
  IF p_language IS NULL OR p_language !~ '^[a-z]{2,3}$'
    THEN RAISE EXCEPTION 'Invalid language scope' USING ERRCODE='22023'; END IF;
  IF auth.uid() IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true
    THEN RAISE EXCEPTION 'Approved session required' USING ERRCODE='42501'; END IF;
  IF public.kg_chart_u3b1_can_language(p_language) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('contract',1,'mode','restricted','groups','[]'::jsonb,
       'language_code',p_language,'server_enforced',false);
  END IF;

  IF public.kg_chart_is_admin() OR public.kg_chart_u3b2_is_legacy() THEN
    RETURN jsonb_build_object('contract',1,'mode','legacy',
       'groups',NULL,'language_code',p_language,'server_enforced',false);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'group_name',m.group_name,'topic_id',m.topic_id)
      ORDER BY m.group_name),'[]'::jsonb)
  INTO v_groups
  FROM public.kg_chart_sentence_group_topic_map m
  WHERE m.language_code=p_language AND m.review_status='verified'
    AND m.reviewed_by IS NOT NULL AND m.reviewed_at IS NOT NULL
    AND m.evidence_sha256 IS NOT NULL
    AND public.kg_chart_u3c2_can_sentence_group(
      p_language,m.group_name
    ) IS TRUE
    AND EXISTS(
      SELECT 1 FROM public.kg_chart_sentences s
      WHERE s.language_code=p_language AND s.group_name=m.group_name
    );
  RETURN jsonb_build_object('contract',1,'mode','restricted',
      'groups',v_groups,'language_code',p_language,'server_enforced',false);
END $fn$;

-- RESTRICTIVE read AND existing U3B1, U3B3A policies.
DROP POLICY IF EXISTS kg_u3c2_group_read ON public.kg_chart_sentences;
CREATE POLICY kg_u3c2_group_read ON public.kg_chart_sentences
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3c2_can_sentence_group(
    language_code,group_name));

-- RESTRICTIVE insert AND existing U3B2/U3B3B1 session policies.
DROP POLICY IF EXISTS kg_u3c2_session_insert ON public.kg_chart_quiz_sessions;
CREATE POLICY kg_u3c2_session_insert ON public.kg_chart_quiz_sessions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3c2_can_sentence_session(
    language_code::text,topic_id::text,quiz_type::text));

REVOKE ALL ON FUNCTION public.kg_chart_u3c2_can_sentence_group(text,text)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3c2_can_sentence_session(text,text,text)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3c2_my_sentence_groups(text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3c2_can_sentence_group(text,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3c2_can_sentence_session(text,text,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3c2_my_sentence_groups(text)
  TO authenticated;

-- No current sentence group is mapped/activated automatically.
-- Do not publish a restricted learner or enable U3C1_SCOPED_UI_ENABLED
-- until the complete source mapping, offline delivery and release gating
-- have separately passed review.
COMMIT;
