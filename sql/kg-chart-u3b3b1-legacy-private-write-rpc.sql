-- KG Chart U3B3B1 — legacy write/RPC privacy closure.
-- REVIEW ONLY. DO NOT APPLY TO TECHNICAL SUPABASE WITHOUT A SEPARATE
-- EXPLICIT PRODUCTION RELEASE APPROVAL, VERIFIED BACKUP AND ROLLBACK PLAN.
--
-- Requires U1 -> U3B1 -> U3B2 -> U3B3A, in that order.
-- U2 still saves legacy-only drafts; this file DOES NOT publish restrictions.
-- Existing rows, offline outboxes, audio/image bucket and media URLs UNCHANGED.
-- All operations below are CREATE POLICY/FUNCTION only; no user data changes.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('kg_chart_u3b3b1_private_legacy_v1'));

-- Caller-identity-bound helper checks the existing U3B3A private rules even
-- for a legacy account. U3B1 language/topic grants remain an additional check
-- for explicitly restricted accounts; there is no shortcut past private rules.
CREATE OR REPLACE FUNCTION public.kg_chart_u3b3b1_can_private_session(
  p_lang text, p_topic text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
  SELECT public.kg_chart_u3b1_can_language(p_lang) IS TRUE
    AND (
      p_topic IS NULL OR
      (public.kg_chart_u3b1_can_topic(p_lang,p_topic) IS TRUE
        AND public.kg_chart_u3b3a_private_topic(p_lang,p_topic) IS TRUE)
    );
$fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b3b1_can_private_answer(
  p_session uuid, p_vocab uuid, p_sentence uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_language text;v_topic text;v_type text;v_word_topic text;v_group text;
BEGIN
  -- Do not authorize answers against another learner's session.
  SELECT s.language_code::text,s.topic_id::text,s.quiz_type::text
    INTO v_language,v_topic,v_type
  FROM public.kg_chart_quiz_sessions AS s
  WHERE s.id=p_session AND s.user_id=auth.uid();
  IF NOT FOUND OR public.kg_chart_u3b3b1_can_private_session(
      v_language,v_topic) IS DISTINCT FROM true
  THEN RETURN false; END IF;

  -- Preserve only the old *non-content* answer form for legacy accounts.
  -- Explicitly restricted accounts retain U3B2's stricter answer contract.
  IF p_vocab IS NULL AND p_sentence IS NULL THEN
    RETURN public.kg_chart_u3b2_is_legacy();
  END IF;
  IF p_vocab IS NOT NULL AND p_sentence IS NOT NULL THEN RETURN false; END IF;

  IF p_vocab IS NOT NULL THEN
    SELECT v.topic_id::text INTO v_word_topic
      FROM public.kg_chart_vocabulary AS v
      JOIN public.kg_chart_vocabulary_translations AS vt
        ON vt.vocabulary_id=v.id AND vt.language_code=v_language
      WHERE v.id=p_vocab;
    IF NOT FOUND OR v_word_topic IS NULL THEN RETURN false; END IF;
    RETURN (v_topic IS NULL OR v_topic=v_word_topic)
      AND public.kg_chart_u3b3a_private_vocabulary(
        v_language,p_vocab) IS TRUE
      AND public.kg_chart_u3b1_can_vocab_translation(
        v_language,p_vocab) IS TRUE;
  END IF;

  SELECT s.group_name INTO v_group
    FROM public.kg_chart_sentences AS s
    WHERE s.id=p_sentence AND s.language_code=v_language;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN public.kg_chart_u3b3a_private_sentence(
    v_language,v_group) IS TRUE
    AND public.kg_chart_u3b2_can_sentence(v_language,p_sentence) IS TRUE;
END $fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b3b1_can_private_rating(
  p_lang text,p_vocab uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
  SELECT public.kg_chart_u3b1_can_language(p_lang) IS TRUE
    AND EXISTS (
      SELECT 1 FROM public.kg_chart_vocabulary_translations AS vt
      WHERE vt.vocabulary_id=p_vocab AND vt.language_code=p_lang
    )
    AND public.kg_chart_u3b3a_private_vocabulary(p_lang,p_vocab) IS TRUE;
$fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b3b1_can_private_flag(
  p_lang text,p_vocab uuid,p_sentence uuid,p_colour uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_group text;v_colour uuid;v_noun uuid;v_row_lang text;
BEGIN
  IF public.kg_chart_u3b1_can_language(p_lang) IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF p_vocab IS NOT NULL AND
    public.kg_chart_u3b3b1_can_private_rating(p_lang,p_vocab)
    IS DISTINCT FROM true THEN RETURN false; END IF;
  IF p_sentence IS NOT NULL THEN
    SELECT s.language_code,s.group_name INTO v_row_lang,v_group
      FROM public.kg_chart_sentences AS s WHERE s.id=p_sentence;
    IF v_row_lang IS DISTINCT FROM p_lang OR
       public.kg_chart_u3b3a_private_sentence(p_lang,v_group)
       IS DISTINCT FROM true THEN RETURN false; END IF;
  END IF;
  IF p_colour IS NOT NULL THEN
    SELECT c.language_code,c.colour_id,c.noun_id
      INTO v_row_lang,v_colour,v_noun
    FROM public.kg_chart_colour_phrases AS c WHERE c.id=p_colour;
    IF v_row_lang IS DISTINCT FROM p_lang OR
       public.kg_chart_u3b3a_private_colour(p_lang,v_colour,v_noun)
       IS DISTINCT FROM true THEN RETURN false; END IF;
  END IF;
  RETURN true;
END $fn$;

-- Install ADDITIONAL RESTRICTIVE write predicates rather than editing U3B2
-- permissive rules. This closes the old legacy shortcut even when a broad
-- permissive policy is added later. UPDATE needs both USING and WITH CHECK.
DROP POLICY IF EXISTS kg_u3b3b1_private_insert ON public.kg_chart_quiz_sessions;
CREATE POLICY kg_u3b3b1_private_insert ON public.kg_chart_quiz_sessions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b3b1_can_private_session(
    language_code::text,topic_id::text));

DROP POLICY IF EXISTS kg_u3b3b1_private_insert ON public.kg_chart_quiz_answers;
CREATE POLICY kg_u3b3b1_private_insert ON public.kg_chart_quiz_answers
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b3b1_can_private_answer(
    session_id,vocabulary_id,sentence_id));

DROP POLICY IF EXISTS kg_u3b3b1_private_insert ON public.kg_chart_user_ratings;
CREATE POLICY kg_u3b3b1_private_insert ON public.kg_chart_user_ratings
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b3b1_can_private_rating(
    language_code::text,vocabulary_id));

DROP POLICY IF EXISTS kg_u3b3b1_private_update ON public.kg_chart_user_ratings;
CREATE POLICY kg_u3b3b1_private_update ON public.kg_chart_user_ratings
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.kg_chart_u3b3b1_can_private_rating(
    language_code::text,vocabulary_id))
  WITH CHECK (public.kg_chart_u3b3b1_can_private_rating(
    language_code::text,vocabulary_id));

DROP POLICY IF EXISTS kg_u3b3b1_private_insert ON public.kg_chart_topic_completions;
CREATE POLICY kg_u3b3b1_private_insert ON public.kg_chart_topic_completions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b3b1_can_private_session(
    language_code,topic_id));

DROP POLICY IF EXISTS kg_u3b3b1_private_update ON public.kg_chart_topic_completions;
CREATE POLICY kg_u3b3b1_private_update ON public.kg_chart_topic_completions
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.kg_chart_u3b3b1_can_private_session(
    language_code,topic_id))
  WITH CHECK (public.kg_chart_u3b3b1_can_private_session(
    language_code,topic_id));

DROP POLICY IF EXISTS kg_u3b3b1_private_insert ON public.kg_chart_flags;
CREATE POLICY kg_u3b3b1_private_insert ON public.kg_chart_flags
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b3b1_can_private_flag(
    language_code::text,vocabulary_id,sentence_id,colour_phrase_id));

-- Override the existing privileged history endpoint with the SAME return
-- columns and signature. It must not leak private IDs even for legacy users.
-- Historical rows are not deleted and remain accessible to admin via RLS.
CREATE OR REPLACE FUNCTION public.kg_chart_my_answers(p_lang text)
RETURNS TABLE(vocabulary_id text,quiz_type text,is_correct boolean,answered_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
  SELECT a.vocabulary_id::text,s.quiz_type,a.is_correct,
         coalesce(a.answered_at,s.completed_at,s.created_at)
    FROM public.kg_chart_quiz_answers AS a
    JOIN public.kg_chart_quiz_sessions AS s ON s.id=a.session_id
  WHERE s.user_id=auth.uid() AND s.language_code=p_lang
    AND a.vocabulary_id IS NOT NULL
    AND public.kg_chart_is_allowed() IS TRUE
    AND public.kg_chart_u3b2_can_answer(
      s.id,a.vocabulary_id,a.sentence_id) IS TRUE
    AND public.kg_chart_u3b3b1_can_private_answer(
      s.id,a.vocabulary_id,a.sentence_id) IS TRUE
  ORDER BY 4,a.id;
$fn$;

-- The existing kg-pronounce Edge Function calls this RPC before Azure and
-- before any service-role write. Do not bypass this privacy validation for
-- legacy users. Require a real resource ID, a matching native text, and
-- correct source type even for legacy. Feature restrictions still apply to
-- explicitly restricted users.
CREATE OR REPLACE FUNCTION public.kg_chart_u3b2_can_pronounce(
  p_lang text,p_text text,p_vocabulary_id uuid,p_sentence_id uuid,p_source text
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_text text;v_group text;v_row_lang text;
BEGIN
  IF public.kg_chart_u3b1_can_language(p_lang) IS DISTINCT FROM true
      OR nullif(btrim(p_text),'') IS NULL
      OR ((p_vocabulary_id IS NULL)::int + (p_sentence_id IS NULL)::int) <> 1
  THEN RETURN false; END IF;

  IF p_source='word' THEN
    IF p_vocabulary_id IS NULL THEN RETURN false; END IF;
    IF public.kg_chart_u3b2_is_legacy() IS DISTINCT FROM true
       AND public.kg_chart_u3b1_can_feature('quiz.say') IS DISTINCT FROM true
    THEN RETURN false; END IF;

    SELECT vt.native_text INTO v_text
      FROM public.kg_chart_vocabulary_translations AS vt
    WHERE vt.language_code=p_lang AND vt.vocabulary_id=p_vocabulary_id;
    IF v_text IS NULL OR
       public.kg_chart_u3b3b1_can_private_rating(
         p_lang,p_vocabulary_id) IS DISTINCT FROM true
       OR public.kg_chart_u3b1_can_vocab_translation(
         p_lang,p_vocabulary_id) IS DISTINCT FROM true
    THEN RETURN false; END IF;

  ELSIF p_source='speak_lines' THEN
    IF p_sentence_id IS NULL THEN RETURN false; END IF;
    IF public.kg_chart_u3b2_is_legacy() IS DISTINCT FROM true
      AND public.kg_chart_u3b1_can_feature('quiz.speak') IS DISTINCT FROM true
    THEN RETURN false; END IF;

    SELECT s.native_text,s.group_name,s.language_code
      INTO v_text,v_group,v_row_lang FROM public.kg_chart_sentences AS s
      WHERE s.id=p_sentence_id;
    IF v_text IS NULL OR v_row_lang IS DISTINCT FROM p_lang
       OR public.kg_chart_u3b2_can_sentence(
         p_lang,p_sentence_id) IS DISTINCT FROM true
       OR public.kg_chart_u3b3a_private_sentence(
         p_lang,v_group) IS DISTINCT FROM true
    THEN RETURN false; END IF;
  ELSE
    RETURN false;
  END IF;

  RETURN btrim(v_text)=btrim(p_text);
END $fn$;

-- The old U3B2 my_answers/Edge RPC grants are preserved. No new endpoint
-- accepts an arbitrary email or user ID. The helper functions return booleans
-- only and never expose private lesson rule lists.
REVOKE ALL ON FUNCTION public.kg_chart_u3b3b1_can_private_session(text,text)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b3b1_can_private_answer(uuid,uuid,uuid)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b3b1_can_private_rating(text,uuid)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b3b1_can_private_flag(text,uuid,uuid,uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b3b1_can_private_session(text,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b3b1_can_private_answer(uuid,uuid,uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b3b1_can_private_rating(text,uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b3b1_can_private_flag(text,uuid,uuid,uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.kg_chart_my_answers(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b2_can_pronounce(text,text,uuid,uuid,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kg_chart_my_answers(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b2_can_pronounce(text,text,uuid,uuid,text)
  TO authenticated;

-- U3B3B1 is a SQL proposal only. No private bucket, no object moves,
-- no public media URL invalidation, no offline pack deletion and no
-- restriction publishing. U3B3B2 private media delivery still required.
COMMIT;
