-- KG Chart U3B1: database READ enforcement for a future restricted learner.
-- REVIEW-ONLY: NEVER APPLY THIS SCRIPT to production Technical Supabase
-- without a backup, separate approval and the later U3B2/U3C/U3D gates.
--
-- Requires U1 access tables. This script modifies existing SELECT policies
-- only by adding RESTRICTIVE conditions; it does not drop permissive policies.
-- A user without a profile or with mode='legacy' keeps existing read behavior.
-- A profile in restricted mode is allowed only its language+topic+feature grants.
-- U2 cannot publish restricted mode. This PR adds NO publish action.
-- Old apps/PWAs do not understand restricted mode: DO NOT activate live users.
-- All database assertions use invented users on network-disabled PostgreSQL.

BEGIN;
SELECT pg_advisory_xact_lock(hashtext('kg_chart_u3b1_read_enforcement_v1'));

-- In a restrictive RLS policy, an additional PERMISSIVE policy would be ORed
-- with old allowed_read and therefore would NOT protect content. These are
-- deliberately AS RESTRICTIVE and are tested against old permissive policies.

CREATE OR REPLACE FUNCTION public.kg_chart_u3b1_can_language(p_lang text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE v_email text; v_mode text;
BEGIN
  IF auth.uid() IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF public.kg_chart_is_admin() THEN RETURN true; END IF;
  SELECT lower(u.email) INTO v_email
  FROM auth.users AS u
  JOIN public.kg_chart_users AS k ON k.email = lower(u.email)
  WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN false; END IF;
  SELECT p.mode INTO v_mode FROM public.kg_chart_access_profiles AS p
  WHERE p.email = v_email;
  IF v_mode IS NULL OR v_mode = 'legacy' THEN RETURN true; END IF;
  IF v_mode <> 'restricted' OR p_lang IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.kg_chart_access_languages AS grant_row
    JOIN public.kg_chart_languages AS l ON l.code = grant_row.language_code
    WHERE grant_row.email = v_email AND grant_row.language_code = p_lang
      AND l.is_active IS TRUE
  );
END $fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b1_can_feature(p_feature text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE v_email text; v_mode text;
BEGIN
  IF auth.uid() IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF public.kg_chart_is_admin() THEN RETURN true; END IF;
  SELECT lower(u.email) INTO v_email
  FROM auth.users AS u JOIN public.kg_chart_users AS k ON k.email=lower(u.email)
  WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN false; END IF;
  SELECT p.mode INTO v_mode FROM public.kg_chart_access_profiles AS p
  WHERE p.email=v_email;
  IF v_mode IS NULL OR v_mode='legacy' THEN RETURN true; END IF;
  IF v_mode <> 'restricted' OR p_feature IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.kg_chart_access_features AS af
    JOIN public.kg_chart_access_feature_catalog AS cat
      ON cat.feature_key=af.feature_key
    WHERE af.email=v_email AND af.feature_key=p_feature
      AND cat.is_active IS TRUE
  );
END $fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b1_can_topic(
  p_lang text, p_topic text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE v_email text; v_mode text;
BEGIN
  IF public.kg_chart_u3b1_can_language(p_lang) IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF public.kg_chart_is_admin() THEN RETURN true; END IF;
  SELECT lower(u.email) INTO v_email
  FROM auth.users AS u JOIN public.kg_chart_users AS k ON k.email=lower(u.email)
  WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN false; END IF;
  SELECT p.mode INTO v_mode FROM public.kg_chart_access_profiles AS p
  WHERE p.email=v_email;
  IF v_mode IS NULL OR v_mode='legacy' THEN RETURN true; END IF;
  IF v_mode <> 'restricted' OR p_topic IS NULL THEN RETURN false; END IF;

  -- Bad private_lessons data must not accidentally expose private content.
  IF EXISTS (
    SELECT 1 FROM public.kg_chart_settings s
    WHERE s.key='private_lessons' AND jsonb_typeof(s.value)<>'array'
  ) THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.kg_chart_access_topics AS grant_row
    JOIN public.kg_chart_topic_translations AS tt
      ON tt.topic_id=grant_row.topic_id
      AND tt.language_code=grant_row.language_code
    JOIN public.kg_chart_topics AS t ON t.id=grant_row.topic_id
    WHERE grant_row.email=v_email
      AND grant_row.language_code=p_lang
      AND grant_row.topic_id=p_topic
      AND t.is_hidden IS DISTINCT FROM true
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.kg_chart_settings AS s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.value)='array' THEN s.value ELSE '[]'::jsonb END
    ) AS rule(value)
    WHERE s.key='private_lessons'
      AND rule.value->>'topic_id'=p_topic
      AND (rule.value->>'language_code' IS NULL
           OR rule.value->>'language_code'=p_lang)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(rule.value->'emails')='array'
          THEN rule.value->'emails' ELSE '[]'::jsonb END
        ) AS member(email)
        WHERE lower(member.email)=v_email
      )
  );
END $fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b1_can_topic_any(p_topic text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE v_email text; v_mode text;
BEGIN
  IF auth.uid() IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF public.kg_chart_is_admin() THEN RETURN true; END IF;
  SELECT lower(u.email) INTO v_email
  FROM auth.users AS u JOIN public.kg_chart_users AS k ON k.email=lower(u.email)
  WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN false; END IF;
  SELECT p.mode INTO v_mode FROM public.kg_chart_access_profiles AS p
  WHERE p.email=v_email;
  IF v_mode IS NULL OR v_mode='legacy' THEN RETURN true; END IF;
  IF v_mode <> 'restricted' OR p_topic IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.kg_chart_access_topics AS grant_row
    WHERE grant_row.email=v_email AND grant_row.topic_id=p_topic
      AND public.kg_chart_u3b1_can_topic(
        grant_row.language_code::text,grant_row.topic_id::text
      )
  );
END $fn$;

-- The parent vocabulary row is intentionally language-neutral; only return
-- it if at least one permitted translated topic exists.
CREATE OR REPLACE FUNCTION public.kg_chart_u3b1_can_vocab_translation(
  p_lang text,p_vocab uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE v_topic text;
BEGIN
  IF p_vocab IS NULL THEN RETURN false; END IF;
  SELECT v.topic_id INTO v_topic
  FROM public.kg_chart_vocabulary AS v WHERE v.id=p_vocab;
  RETURN public.kg_chart_u3b1_can_topic(p_lang,v_topic);
END $fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b1_can_sentences(p_lang text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
  SELECT public.kg_chart_u3b1_can_language(p_lang)
     AND (public.kg_chart_u3b1_can_feature('quiz.sentences')
          OR public.kg_chart_u3b1_can_feature('quiz.speak'));
$fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b1_can_colour_phrase(
  p_lang text,p_colour uuid,p_noun uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
  SELECT public.kg_chart_u3b1_can_language(p_lang)
    AND public.kg_chart_u3b1_can_feature('quiz.colours')
    AND public.kg_chart_u3b1_can_vocab_translation(p_lang,p_colour)
    AND public.kg_chart_u3b1_can_vocab_translation(p_lang,p_noun);
$fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b1_can_setting(p_key text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE v_email text; v_mode text;
BEGIN
  IF auth.uid() IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF public.kg_chart_is_admin() THEN RETURN true; END IF;
  SELECT lower(u.email) INTO v_email
  FROM auth.users AS u JOIN public.kg_chart_users AS k ON k.email=lower(u.email)
  WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN false; END IF;
  SELECT p.mode INTO v_mode FROM public.kg_chart_access_profiles AS p
  WHERE p.email=v_email;
  IF v_mode IS NULL OR v_mode='legacy' THEN RETURN true; END IF;
  IF v_mode <> 'restricted' THEN RETURN false; END IF;
  -- Private lesson emails and other user-level configuration cannot be
  -- disclosed to restricted learners through raw kg_chart_settings.
  RETURN p_key = ANY(ARRAY[
    'unlock_rules','pronunciation_daily_limit','catalyst_daily_limit',
    'admin_bypass_lock'
  ]);
END $fn$;

-- Restricted learners cannot enumerate other people's flag reports. The
-- current flag schema has no reporter/owner column; review and secure flag
-- writes in U3B2. Admin and legacy behavior is unchanged by this PR.
CREATE OR REPLACE FUNCTION public.kg_chart_u3b1_can_read_flags()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE v_email text; v_mode text;
BEGIN
  IF auth.uid() IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true
  THEN RETURN false; END IF;
  IF public.kg_chart_is_admin() THEN RETURN true; END IF;
  SELECT lower(u.email) INTO v_email
  FROM auth.users AS u JOIN public.kg_chart_users AS k ON k.email=lower(u.email)
  WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN false; END IF;
  SELECT p.mode INTO v_mode FROM public.kg_chart_access_profiles AS p
  WHERE p.email=v_email;
  RETURN v_mode IS NULL OR v_mode='legacy';
END $fn$;

-- All helpers are scoped to the authenticated caller's own session.
-- Deliberately no email-parameter or service-role API key in client code.
REVOKE ALL ON FUNCTION public.kg_chart_u3b1_can_language(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b1_can_feature(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b1_can_topic(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b1_can_topic_any(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b1_can_vocab_translation(text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b1_can_sentences(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b1_can_colour_phrase(text,uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b1_can_setting(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b1_can_read_flags() FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.kg_chart_u3b1_can_language(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b1_can_feature(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b1_can_topic(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b1_can_topic_any(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b1_can_vocab_translation(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b1_can_sentences(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b1_can_colour_phrase(text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b1_can_setting(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b1_can_read_flags() TO authenticated;

-- IMPORTANT: RLS policies on existing content tables are RESTRICTIVE.
-- Thus the old approved-user read policy remains necessary but is not enough
-- to bypass new per-learner restrictions. Admins retain full access.
DROP POLICY IF EXISTS kg_u3b1_read ON public.kg_chart_languages;
CREATE POLICY kg_u3b1_read ON public.kg_chart_languages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b1_can_language(code::text));

DROP POLICY IF EXISTS kg_u3b1_read ON public.kg_chart_topics;
CREATE POLICY kg_u3b1_read ON public.kg_chart_topics
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b1_can_topic_any(id::text));

DROP POLICY IF EXISTS kg_u3b1_read ON public.kg_chart_topic_translations;
CREATE POLICY kg_u3b1_read ON public.kg_chart_topic_translations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b1_can_topic(language_code::text,topic_id::text));

DROP POLICY IF EXISTS kg_u3b1_read ON public.kg_chart_vocabulary;
CREATE POLICY kg_u3b1_read ON public.kg_chart_vocabulary
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b1_can_topic_any(topic_id::text));

DROP POLICY IF EXISTS kg_u3b1_read ON public.kg_chart_vocabulary_translations;
CREATE POLICY kg_u3b1_read ON public.kg_chart_vocabulary_translations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b1_can_vocab_translation(language_code::text,vocabulary_id));

DROP POLICY IF EXISTS kg_u3b1_read ON public.kg_chart_sentences;
CREATE POLICY kg_u3b1_read ON public.kg_chart_sentences
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b1_can_sentences(language_code));

DROP POLICY IF EXISTS kg_u3b1_read ON public.kg_chart_colour_phrases;
CREATE POLICY kg_u3b1_read ON public.kg_chart_colour_phrases
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b1_can_colour_phrase(language_code::text,colour_id,noun_id));

DROP POLICY IF EXISTS kg_u3b1_read ON public.kg_chart_settings;
CREATE POLICY kg_u3b1_read ON public.kg_chart_settings
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b1_can_setting(key));

DROP POLICY IF EXISTS kg_u3b1_read ON public.kg_chart_flags;
CREATE POLICY kg_u3b1_read ON public.kg_chart_flags
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b1_can_read_flags());

-- U3B1 does NOT make private Storage assets private and does NOT change
-- INSERT/UPDATE/DELETE, SECURITY DEFINER RPCs, quiz writes, Edge Functions,
-- old PWA offline packs, or permission publishing. U3B2/U3C/U3D must do so
-- before ANY restricted learner can be activated. No U3B1 CLI auto-deploy.
COMMIT;
