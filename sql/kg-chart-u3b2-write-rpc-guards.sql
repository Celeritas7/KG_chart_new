-- KG Chart U3B2: reviewed write checks and privileged RPC guards.
-- PROPOSAL ONLY. Never automatically apply to Technical Supabase.
-- Requires U1 and U3B1 schemas (and U3A for the staged release path).
-- U2 still stores legacy-only drafts: NO publication/activation in this file.
-- Existing rows and archived progress remain READABLE and UNCHANGED.
-- New restricted writes are denied when language/topic/mode/feature is absent.
-- All tests run on fictional accounts in network-disabled PostgreSQL.

BEGIN;
SELECT pg_advisory_xact_lock(hashtext('kg_chart_u3b2_write_guards_v1'));

-- 1. Existing approved legacy users retain their current data semantics.
--    No email argument: identity is bound to the verified auth.uid() and
--    existing kg_chart_is_allowed(). Definer only looks up protected U1 modes.
CREATE OR REPLACE FUNCTION public.kg_chart_u3b2_is_legacy()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_mode text;
BEGIN
  IF auth.uid() IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF public.kg_chart_is_admin() THEN RETURN true; END IF;
  SELECT p.mode INTO v_mode FROM auth.users AS u
    JOIN public.kg_chart_users AS k ON k.email=lower(u.email)
    LEFT JOIN public.kg_chart_access_profiles AS p ON p.email=k.email
    WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
  RETURN v_mode IS NULL OR v_mode='legacy';
END $fn$;

-- Exact production quiz session identifiers, not the six screen labels.
-- Unknown identifiers fail closed for restricted learners but keep old
-- legacy behavior until U3C updates all installed app versions.
CREATE OR REPLACE FUNCTION public.kg_chart_u3b2_can_quiz_type(
  p_lang text,p_type text
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_feature text;
BEGIN
  IF public.kg_chart_u3b1_can_language(p_lang) IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF public.kg_chart_u3b2_is_legacy() THEN RETURN true; END IF;
  v_feature := CASE
    WHEN p_type = ANY(ARRAY[
      'native_to_image','image_to_native','devanagari_to_image',
      'english_to_native','listen_to_image','listen_to_native',
      'word_builder','type_word']) THEN 'quiz.words'
    WHEN p_type = ANY(ARRAY[
      'sentence_to_meaning','meaning_to_sentence','build_sentence'])
      THEN 'quiz.sentences'
    WHEN p_type = ANY(ARRAY['typing_copy','typing_recall'])
      THEN 'quiz.typing'
    WHEN p_type = ANY(ARRAY['speak_lines','speak_paragraph'])
      THEN 'quiz.speak'
    WHEN p_type = 'colour_phrase' THEN 'quiz.colours'
    ELSE NULL
  END;
  RETURN v_feature IS NOT NULL
    AND public.kg_chart_u3b1_can_feature(v_feature) IS TRUE;
END $fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b2_can_quiz_session(
  p_lang text,p_topic text,p_type text
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
BEGIN
  IF public.kg_chart_u3b2_can_quiz_type(p_lang,p_type) IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF public.kg_chart_u3b2_is_legacy() THEN RETURN true; END IF;
  IF p_topic IS NOT NULL THEN
    RETURN public.kg_chart_u3b1_can_topic(p_lang,p_topic);
  END IF;
  -- 'All topics' word sessions are allowed ONLY when at least one actual
  -- word topic is granted; never interpret NULL as "all permissions".
  IF p_type = ANY(ARRAY[
    'native_to_image','image_to_native','devanagari_to_image',
    'english_to_native','listen_to_image','listen_to_native',
    'word_builder','type_word','typing_copy','typing_recall']) THEN
    RETURN EXISTS (
      SELECT 1 FROM public.kg_chart_access_topics AS at
      JOIN auth.users AS u ON lower(u.email)=at.email
      WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL
        AND at.language_code=p_lang
        AND public.kg_chart_u3b1_can_topic(p_lang,at.topic_id::text)
    );
  END IF;
  RETURN true;
END $fn$;

-- Spoken and typed sentence IDs have language, but no topic_id.
-- Preserve private sentence-group exclusions even for new writes.
CREATE OR REPLACE FUNCTION public.kg_chart_u3b2_can_sentence(
  p_lang text,p_sentence uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_group text;v_email text;v_lang text;
BEGIN
  IF p_sentence IS NULL OR
     public.kg_chart_u3b1_can_language(p_lang) IS DISTINCT FROM true
  THEN RETURN false; END IF;
  SELECT s.group_name,s.language_code INTO v_group,v_lang
  FROM public.kg_chart_sentences AS s WHERE s.id=p_sentence;
  IF v_lang IS DISTINCT FROM p_lang THEN RETURN false; END IF;
  IF public.kg_chart_u3b2_is_legacy() THEN RETURN true; END IF;
  IF NOT (
    public.kg_chart_u3b1_can_feature('quiz.sentences') OR
    public.kg_chart_u3b1_can_feature('quiz.speak') OR
    public.kg_chart_u3b1_can_feature('quiz.typing') OR
    public.kg_chart_u3b1_can_feature('quiz.say')
  ) THEN RETURN false; END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users AS u
  WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM public.kg_chart_settings AS s
    WHERE s.key='private_lessons'
      AND jsonb_typeof(s.value)<>'array'
  ) THEN RETURN false; END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM public.kg_chart_settings AS s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.value)='array' THEN s.value
      ELSE '[]'::jsonb END
    ) AS rule(value)
    WHERE s.key='private_lessons'
      AND (rule.value->>'language_code' IS NULL
        OR rule.value->>'language_code'=p_lang)
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(rule.value->'sentence_groups')='array'
            THEN rule.value->'sentence_groups' ELSE '[]'::jsonb END
        ) AS grp(value)
        WHERE grp.value=v_group
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(rule.value->'emails')='array'
            THEN rule.value->'emails' ELSE '[]'::jsonb END
        ) AS member(value)
        WHERE lower(member.value)=v_email
      )
  );
END $fn$;

-- Answer insert must refer to its own session. New records are checked
-- against the question content, not the user's answer_text/distractor,
-- which is not a trustworthy authorisation source.
CREATE OR REPLACE FUNCTION public.kg_chart_u3b2_can_answer(
  p_session uuid,p_vocab uuid,p_sentence uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_session record;v_topic text;
BEGIN
  SELECT s.language_code,s.topic_id,s.quiz_type
  INTO v_session
  FROM public.kg_chart_quiz_sessions AS s
  WHERE s.id=p_session AND s.user_id=auth.uid();
  IF NOT FOUND OR
    public.kg_chart_u3b2_can_quiz_session(
      v_session.language_code::text,v_session.topic_id::text,v_session.quiz_type::text
    ) IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF public.kg_chart_u3b2_is_legacy() THEN RETURN true; END IF;
  IF (p_vocab IS NULL AND p_sentence IS NULL) OR
     (p_vocab IS NOT NULL AND p_sentence IS NOT NULL)
  THEN RETURN false; END IF;
  IF p_vocab IS NOT NULL THEN
    IF v_session.quiz_type NOT IN (
      'native_to_image','image_to_native','devanagari_to_image',
      'english_to_native','listen_to_image','listen_to_native',
      'word_builder','type_word','typing_copy','typing_recall'
    ) THEN RETURN false; END IF;
    SELECT v.topic_id INTO v_topic FROM public.kg_chart_vocabulary AS v
    WHERE v.id=p_vocab;
    RETURN public.kg_chart_u3b1_can_vocab_translation(
      v_session.language_code::text,p_vocab
    ) AND (
      v_session.topic_id IS NULL OR v_session.topic_id=v_topic
    );
  END IF;
  IF v_session.quiz_type NOT IN (
    'sentence_to_meaning','meaning_to_sentence','build_sentence',
    'speak_lines','speak_paragraph','typing_copy','typing_recall'
  ) THEN RETURN false; END IF;
  RETURN public.kg_chart_u3b2_can_sentence(
    v_session.language_code::text,p_sentence
  );
END $fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b2_can_rating(
  p_lang text,p_vocab uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
  SELECT public.kg_chart_u3b1_can_language(p_lang)
    AND (public.kg_chart_u3b2_is_legacy()
      OR (public.kg_chart_u3b1_can_vocab_translation(p_lang,p_vocab)
        AND (
          public.kg_chart_u3b1_can_feature('chart')
          OR public.kg_chart_u3b1_can_feature('cards')
          OR public.kg_chart_u3b1_can_feature('quiz.words')
          OR public.kg_chart_u3b1_can_feature('quiz.typing')
        )));
$fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b2_can_completion(
  p_lang text,p_topic text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
  SELECT public.kg_chart_u3b1_can_language(p_lang)
    AND (public.kg_chart_u3b2_is_legacy()
      OR (public.kg_chart_u3b1_can_topic(p_lang,p_topic)
        AND (public.kg_chart_u3b1_can_feature('chart')
          OR public.kg_chart_u3b1_can_feature('quiz.words'))));
$fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b2_can_flag(
  p_lang text,p_vocab uuid,p_sentence uuid,p_colour uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
BEGIN
  IF public.kg_chart_u3b1_can_language(p_lang) IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF public.kg_chart_u3b2_is_legacy() THEN RETURN true; END IF;
  IF ((p_vocab IS NOT NULL)::int + (p_sentence IS NOT NULL)::int
    + (p_colour IS NOT NULL)::int) <> 1 THEN RETURN false; END IF;
  IF p_vocab IS NOT NULL THEN
    RETURN public.kg_chart_u3b1_can_vocab_translation(p_lang,p_vocab)
       AND (public.kg_chart_u3b1_can_feature('chart')
          OR public.kg_chart_u3b1_can_feature('cards')
          OR public.kg_chart_u3b1_can_feature('quiz.words')
          OR public.kg_chart_u3b1_can_feature('quiz.typing'));
  END IF;
  IF p_sentence IS NOT NULL THEN
    RETURN public.kg_chart_u3b2_can_sentence(p_lang,p_sentence)
       AND (public.kg_chart_u3b1_can_feature('quiz.sentences')
          OR public.kg_chart_u3b1_can_feature('quiz.speak')
          OR public.kg_chart_u3b1_can_feature('quiz.typing'));
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.kg_chart_colour_phrases AS p
    WHERE p.id=p_colour AND p.language_code=p_lang
      AND public.kg_chart_u3b1_can_colour_phrase(
        p_lang,p.colour_id,p.noun_id)
  );
END $fn$;

-- Edge Function runs admin storage writes, so its *authenticated* preflight
-- MUST call this function before Azure or service_role inserts.
CREATE OR REPLACE FUNCTION public.kg_chart_u3b2_can_pronounce(
  p_lang text,p_text text,p_vocabulary_id uuid,p_sentence_id uuid,p_source text
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_text text;
BEGIN
  IF public.kg_chart_u3b1_can_language(p_lang) IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF public.kg_chart_u3b2_is_legacy() THEN RETURN true; END IF;
  IF coalesce(btrim(p_text),'')='' OR
    (p_vocabulary_id IS NULL AND p_sentence_id IS NULL) OR
    (p_vocabulary_id IS NOT NULL AND p_sentence_id IS NOT NULL)
  THEN RETURN false; END IF;
  IF p_source='speak_lines' THEN
    IF p_sentence_id IS NULL
      OR public.kg_chart_u3b1_can_feature('quiz.speak') IS DISTINCT FROM true
    THEN RETURN false; END IF;
  ELSIF p_source='word' THEN
    IF public.kg_chart_u3b1_can_feature('quiz.say') IS DISTINCT FROM true
    THEN RETURN false; END IF;
  ELSE RETURN false;
  END IF;
  IF p_vocabulary_id IS NOT NULL THEN
    IF public.kg_chart_u3b1_can_vocab_translation(p_lang,p_vocabulary_id)
      IS DISTINCT FROM true THEN RETURN false; END IF;
    SELECT t.native_text INTO v_text
    FROM public.kg_chart_vocabulary_translations t
    WHERE t.vocabulary_id=p_vocabulary_id AND t.language_code=p_lang;
  ELSE
    IF public.kg_chart_u3b2_can_sentence(p_lang,p_sentence_id)
      IS DISTINCT FROM true THEN RETURN false; END IF;
    SELECT s.native_text INTO v_text
    FROM public.kg_chart_sentences s
    WHERE s.id=p_sentence_id AND s.language_code=p_lang;
  END IF;
  RETURN v_text IS NOT NULL AND btrim(v_text)=btrim(p_text);
END $fn$;

-- All helpers are caller-identity bound. Do not expose helper functions to
-- anon, PUBLIC or a client-supplied identity. Existing auth and data policies
-- still remain necessary.
REVOKE ALL ON FUNCTION public.kg_chart_u3b2_is_legacy() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b2_can_quiz_type(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b2_can_quiz_session(text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b2_can_sentence(text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b2_can_answer(uuid,uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b2_can_rating(text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b2_can_completion(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b2_can_flag(text,uuid,uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b2_can_pronounce(text,text,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b2_is_legacy() TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b2_can_quiz_type(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b2_can_quiz_session(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b2_can_sentence(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b2_can_answer(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b2_can_rating(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b2_can_completion(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b2_can_flag(text,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b2_can_pronounce(text,text,uuid,uuid,text) TO authenticated;

-- 2. Restrictive WRITE checks combine with existing permissive policies.
--    The current SELECT/history policies are NOT changed. Denied future writes
--    stay in the offline outbox for later reconciliation (U3D to implement).
DROP POLICY IF EXISTS kg_u3b2_write ON public.kg_chart_quiz_sessions;
CREATE POLICY kg_u3b2_write ON public.kg_chart_quiz_sessions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b2_can_quiz_session(
    language_code::text,topic_id::text,quiz_type::text));

DROP POLICY IF EXISTS kg_u3b2_write ON public.kg_chart_quiz_answers;
CREATE POLICY kg_u3b2_write ON public.kg_chart_quiz_answers
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b2_can_answer(
    session_id,vocabulary_id,sentence_id));

DROP POLICY IF EXISTS kg_u3b2_insert ON public.kg_chart_user_ratings;
CREATE POLICY kg_u3b2_insert ON public.kg_chart_user_ratings
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b2_can_rating(
    language_code::text,vocabulary_id));

DROP POLICY IF EXISTS kg_u3b2_update ON public.kg_chart_user_ratings;
CREATE POLICY kg_u3b2_update ON public.kg_chart_user_ratings
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.kg_chart_u3b2_can_rating(language_code::text,vocabulary_id))
  WITH CHECK (public.kg_chart_u3b2_can_rating(
    language_code::text,vocabulary_id));

DROP POLICY IF EXISTS kg_u3b2_delete ON public.kg_chart_user_ratings;
CREATE POLICY kg_u3b2_delete ON public.kg_chart_user_ratings
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.kg_chart_u3b2_can_rating(language_code::text,vocabulary_id));

DROP POLICY IF EXISTS kg_u3b2_insert ON public.kg_chart_topic_completions;
CREATE POLICY kg_u3b2_insert ON public.kg_chart_topic_completions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b2_can_completion(
    language_code,topic_id));

DROP POLICY IF EXISTS kg_u3b2_update ON public.kg_chart_topic_completions;
CREATE POLICY kg_u3b2_update ON public.kg_chart_topic_completions
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.kg_chart_u3b2_can_completion(language_code,topic_id))
  WITH CHECK (public.kg_chart_u3b2_can_completion(language_code,topic_id));

DROP POLICY IF EXISTS kg_u3b2_insert ON public.kg_chart_flags;
CREATE POLICY kg_u3b2_insert ON public.kg_chart_flags
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b2_can_flag(
    language_code::text,vocabulary_id,sentence_id,colour_phrase_id));

DROP POLICY IF EXISTS kg_u3b2_insert ON public.kg_chart_user_levels;
CREATE POLICY kg_u3b2_insert ON public.kg_chart_user_levels
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b1_can_language(language_code::text));

DROP POLICY IF EXISTS kg_u3b2_update ON public.kg_chart_user_levels;
CREATE POLICY kg_u3b2_update ON public.kg_chart_user_levels
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.kg_chart_u3b1_can_language(language_code::text))
  WITH CHECK (public.kg_chart_u3b1_can_language(language_code::text));

-- 3. Guard existing privileged history / level-up RPCs. They bypass normal
--    table RLS because they are SECURITY DEFINER. Preserve old signatures.
CREATE OR REPLACE FUNCTION public.kg_chart_my_answers(p_lang text)
RETURNS TABLE(vocabulary_id text,quiz_type text,is_correct boolean,answered_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
  SELECT a.vocabulary_id::text,s.quiz_type,a.is_correct,
         coalesce(a.answered_at,s.completed_at,s.created_at)
  FROM public.kg_chart_quiz_answers AS a
  JOIN public.kg_chart_quiz_sessions AS s ON s.id=a.session_id
  WHERE s.user_id=auth.uid()
    AND s.language_code=p_lang
    AND a.vocabulary_id IS NOT NULL
    AND public.kg_chart_is_allowed()
    AND public.kg_chart_u3b2_can_answer(s.id,a.vocabulary_id,a.sentence_id)
  ORDER BY 4,a.id;
$fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_check_level_up(p_lang text)
RETURNS smallint LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE
  v_email text;
  v_unlocked smallint;
  v_total int := 0;
  v_correct int := 0;
  v_rules jsonb;
  v_answers int;
  v_pct int;
  s record;
BEGIN
  -- Verified Auth identity, not an untrusted caller email or stale JWT claim.
  IF auth.uid() IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true
     OR public.kg_chart_u3b2_can_quiz_session(
       p_lang,NULL,'native_to_image') IS DISTINCT FROM true
  THEN RETURN NULL; END IF;

  SELECT lower(u.email) INTO v_email
  FROM auth.users AS u WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN NULL; END IF;
  SELECT value INTO v_rules FROM public.kg_chart_settings WHERE key='unlock_rules';
  v_answers := public.kg_chart_rule_int(v_rules,p_lang,'answers',40,10,200);
  v_pct := public.kg_chart_rule_int(v_rules,p_lang,'pct',85,50,100);
  PERFORM set_config('kg.level_up','on',true);
  INSERT INTO public.kg_chart_user_levels(email,language_code)
  VALUES(v_email,p_lang) ON CONFLICT DO NOTHING;
  SELECT unlocked INTO v_unlocked FROM public.kg_chart_user_levels
  WHERE email=v_email AND language_code=p_lang FOR UPDATE;
  IF v_unlocked>=4 THEN RETURN v_unlocked; END IF;
  FOR s IN
    SELECT total_questions,correct_answers
    FROM public.kg_chart_quiz_sessions
    WHERE user_id=auth.uid() AND language_code=p_lang
      AND coalesce(difficulty,1)=v_unlocked
      AND quiz_type IN (
        'native_to_image','image_to_native','devanagari_to_image',
        'english_to_native','listen_to_image','listen_to_native')
    ORDER BY created_at DESC
  LOOP
    v_total := v_total+coalesce(s.total_questions,0);
    v_correct := v_correct+coalesce(s.correct_answers,0);
    EXIT WHEN v_total>=v_answers;
  END LOOP;
  IF v_total>=v_answers AND v_correct*100>=v_pct*v_total THEN
    UPDATE public.kg_chart_user_levels
    SET unlocked=unlocked+1,updated_at=now()
    WHERE email=v_email AND language_code=p_lang;
    RETURN v_unlocked+1;
  END IF;
  RETURN v_unlocked;
END $fn$;

-- Do not broaden RPC EXECUTE for anonymous accounts while replacing bodies.
REVOKE ALL ON FUNCTION public.kg_chart_my_answers(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_check_level_up(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kg_chart_my_answers(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_check_level_up(text) TO authenticated;

-- NOT INCLUDED: publication, old PWA compatibility, Storage/private media,
-- Edge deployment, old queued write reconciliation or direct historical reads.
-- Never activate restricted profiles before U3B3/U3C/U3D/U4 approvals.
COMMIT;
