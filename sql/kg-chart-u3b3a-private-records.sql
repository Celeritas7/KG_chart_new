-- KG Chart U3B3A — private lesson metadata, content rows and flag ownership.
-- MANUAL REVIEW ONLY. Do not apply to Technical Supabase before separately
-- approved SQL order, backup, old-client migration, and an offline rollback.
-- Requires U1, U3A, U3B1 and U3B2. No restricted users are activated here.
-- The PUBLIC vocabulary-assets bucket is NOT made private by this file.
--
-- The current legacy KG Chart app reads private_lessons directly. Deploying
-- these policies without the updated client and offline pack reader can break
-- legacy clients. This source file is not an auto-applied migration.

BEGIN;
SELECT pg_advisory_xact_lock(hashtext('kg_chart_u3b3a_private_records_v1'));

-- Verified identity only. This is intentionally callable only for one's own
-- current session; no caller-supplied email and no raw allowlist of people.
-- The RPC returns ONLY hidden topic IDs and sentence group names.
CREATE OR REPLACE FUNCTION public.kg_chart_my_private_lesson_visibility(
  p_language text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE
  v_email text;
  v_rules jsonb;
  v_rule jsonb;
  v_member jsonb;
  v_groups jsonb;
  v_group text;
  v_topics jsonb := '[]'::jsonb;
  v_hidden_groups jsonb := '[]'::jsonb;
  v_authorized boolean := false;
BEGIN
  IF auth.uid() IS NULL
      OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Verified KG Chart account required'
      USING ERRCODE = '42501';
  END IF;
  IF p_language IS NULL OR p_language !~ '^[a-z]{2,3}$' THEN
    RAISE EXCEPTION 'Invalid language' USING ERRCODE='22023';
  END IF;
  IF public.kg_chart_is_admin() THEN
    RETURN jsonb_build_object('contract',1,'topics','[]'::jsonb,'groups','[]'::jsonb);
  END IF;
  SELECT lower(u.email) INTO v_email
    FROM auth.users AS u
    JOIN public.kg_chart_users AS k ON k.email=lower(u.email)
    WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Verified KG Chart account required'
      USING ERRCODE='42501';
  END IF;

  SELECT s.value INTO v_rules FROM public.kg_chart_settings AS s
    WHERE s.key='private_lessons';
  IF v_rules IS NULL THEN
    RETURN jsonb_build_object('contract',1,'topics','[]'::jsonb,'groups','[]'::jsonb);
  END IF;
  IF jsonb_typeof(v_rules)<>'array' THEN
    RAISE EXCEPTION 'Private lessons configuration is unavailable'
      USING ERRCODE='22023';
  END IF;

  FOR v_rule IN SELECT elem.value FROM jsonb_array_elements(v_rules) AS elem(value)
  LOOP
    IF jsonb_typeof(v_rule)<>'object'
       OR (v_rule ? 'emails' AND jsonb_typeof(v_rule->'emails')<>'array')
       OR (v_rule ? 'sentence_groups' AND jsonb_typeof(v_rule->'sentence_groups')<>'array')
    THEN
      RAISE EXCEPTION 'Invalid private lesson configuration'
        USING ERRCODE='22023';
    END IF;
    IF coalesce(v_rule->>'language_code',p_language) <> p_language THEN
      CONTINUE;
    END IF;
    v_authorized := false;
    FOR v_member IN
      SELECT member.value
        FROM jsonb_array_elements(
          coalesce(v_rule->'emails','[]'::jsonb)
        ) AS member(value)
    LOOP
      IF jsonb_typeof(v_member)<>'string' THEN
        RAISE EXCEPTION 'Invalid private lesson membership'
          USING ERRCODE='22023';
      END IF;
      IF lower(v_member #>> '{}')=v_email THEN v_authorized:=true; END IF;
    END LOOP;
    IF v_authorized THEN CONTINUE; END IF;

    IF nullif(btrim(v_rule->>'topic_id'),'') IS NOT NULL
      AND NOT (v_topics @> jsonb_build_array(v_rule->>'topic_id')) THEN
      v_topics := v_topics || jsonb_build_array(v_rule->>'topic_id');
    END IF;
    v_groups:=coalesce(v_rule->'sentence_groups','[]'::jsonb);
    FOR v_group IN SELECT value FROM jsonb_array_elements_text(v_groups)
    LOOP
      IF nullif(btrim(v_group),'') IS NOT NULL
         AND NOT (v_hidden_groups @> jsonb_build_array(v_group)) THEN
        v_hidden_groups := v_hidden_groups || jsonb_build_array(v_group);
      END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object(
    'contract',1,'topics',v_topics,'groups',v_hidden_groups
  );
END $fn$;

REVOKE ALL ON FUNCTION public.kg_chart_my_private_lesson_visibility(text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kg_chart_my_private_lesson_visibility(text)
  TO authenticated;

-- For source-table RLS, deny private content for all non-admin users
-- (including legacy users), not just future restricted profiles.
-- Definer predicates read the protected settings internally, not through the
-- caller's settings SELECT policy. No dynamic SQL and no user ID parameter.
CREATE OR REPLACE FUNCTION public.kg_chart_u3b3a_private_topic(
  p_lang text,p_topic text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE
  v_view jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR public.kg_chart_is_allowed() IS DISTINCT FROM true
     OR p_topic IS NULL OR p_lang IS NULL THEN
    RETURN false;
  END IF;
  IF public.kg_chart_is_admin() THEN RETURN true; END IF;
  -- A malformed configuration causes an ERROR, not a silent allow.
  v_view:=public.kg_chart_my_private_lesson_visibility(p_lang);
  RETURN NOT ((v_view->'topics') @> jsonb_build_array(p_topic));
END $fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b3a_private_topic_any(
  p_topic text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
BEGIN
  IF auth.uid() IS NULL
     OR public.kg_chart_is_allowed() IS DISTINCT FROM true
     OR p_topic IS NULL THEN RETURN false; END IF;
  IF public.kg_chart_is_admin() THEN RETURN true; END IF;
  -- Preserve legacy admin-authored topics without translations until review.
  IF NOT EXISTS (
    SELECT 1 FROM public.kg_chart_topic_translations AS tt
    WHERE tt.topic_id=p_topic
  ) THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.kg_chart_topic_translations AS tt
    WHERE tt.topic_id=p_topic
      AND public.kg_chart_u3b3a_private_topic(tt.language_code,p_topic)
  );
END $fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b3a_private_vocabulary(
  p_lang text,p_vocab uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_topic text;
BEGIN
  IF p_vocab IS NULL THEN RETURN false; END IF;
  SELECT v.topic_id INTO v_topic
    FROM public.kg_chart_vocabulary AS v WHERE v.id=p_vocab;
  RETURN public.kg_chart_u3b3a_private_topic(p_lang,v_topic);
END $fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b3a_private_sentence(
  p_lang text,p_group text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_view jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR public.kg_chart_is_allowed() IS DISTINCT FROM true
     OR p_lang IS NULL THEN RETURN false; END IF;
  IF public.kg_chart_is_admin() THEN RETURN true; END IF;
  v_view:=public.kg_chart_my_private_lesson_visibility(p_lang);
  RETURN p_group IS NULL
    OR NOT ((v_view->'groups') @> jsonb_build_array(p_group));
END $fn$;

CREATE OR REPLACE FUNCTION public.kg_chart_u3b3a_private_colour(
  p_lang text,p_colour uuid,p_noun uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
SELECT public.kg_chart_u3b3a_private_vocabulary(p_lang,p_colour)
  AND public.kg_chart_u3b3a_private_vocabulary(p_lang,p_noun);
$fn$;

-- Restrict source READs even if an additional permissive policy is added.
DROP POLICY IF EXISTS kg_u3b3a_private_read ON public.kg_chart_topics;
CREATE POLICY kg_u3b3a_private_read ON public.kg_chart_topics
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b3a_private_topic_any(id::text));

DROP POLICY IF EXISTS kg_u3b3a_private_read ON public.kg_chart_topic_translations;
CREATE POLICY kg_u3b3a_private_read ON public.kg_chart_topic_translations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b3a_private_topic(language_code::text,topic_id::text));

DROP POLICY IF EXISTS kg_u3b3a_private_read ON public.kg_chart_vocabulary;
CREATE POLICY kg_u3b3a_private_read ON public.kg_chart_vocabulary
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b3a_private_topic_any(topic_id::text));

DROP POLICY IF EXISTS kg_u3b3a_private_read ON public.kg_chart_vocabulary_translations;
CREATE POLICY kg_u3b3a_private_read ON public.kg_chart_vocabulary_translations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b3a_private_vocabulary(language_code::text,vocabulary_id));

DROP POLICY IF EXISTS kg_u3b3a_private_read ON public.kg_chart_sentences;
CREATE POLICY kg_u3b3a_private_read ON public.kg_chart_sentences
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b3a_private_sentence(language_code,group_name));

DROP POLICY IF EXISTS kg_u3b3a_private_read ON public.kg_chart_colour_phrases;
CREATE POLICY kg_u3b3a_private_read ON public.kg_chart_colour_phrases
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.kg_chart_u3b3a_private_colour(language_code::text,colour_id,noun_id));

-- Protect raw private email lists for ALL approved learners, including legacy.
-- Admin users continue reading settings via existing settings_admin policy.
DROP POLICY IF EXISTS kg_u3b3a_private_read ON public.kg_chart_settings;
CREATE POLICY kg_u3b3a_private_read ON public.kg_chart_settings
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (key <> 'private_lessons' OR public.kg_chart_is_admin());

-- Flag reporter ownership: old rows have no verifiable author and remain
-- admin-only. Do not assign them to arbitrary users or delete them.
ALTER TABLE public.kg_chart_flags
  ADD COLUMN IF NOT EXISTS reporter_id uuid REFERENCES auth.users(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS kg_chart_flags_reporter_id_created_at
  ON public.kg_chart_flags(reporter_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.kg_chart_u3b3a_stamp_flag_reporter()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    -- Trusted SQL Editor/service-role historical imports remain unowned and
    -- visible only to admins. Anonymous API inserts are still denied.
    IF current_user = ANY(ARRAY['postgres','service_role']) THEN
      NEW.reporter_id:=NULL; RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Authenticated KG Chart account required'
      USING ERRCODE='42501';
  END IF;
  IF public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'KG Chart account not approved'
      USING ERRCODE='42501';
  END IF;
  -- Never trust caller-provided reporter_id, including on batch imports.
  NEW.reporter_id:=auth.uid();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS kg_chart_u3b3a_stamp_reporter
  ON public.kg_chart_flags;
CREATE TRIGGER kg_chart_u3b3a_stamp_reporter
  BEFORE INSERT ON public.kg_chart_flags
  FOR EACH ROW EXECUTE FUNCTION public.kg_chart_u3b3a_stamp_flag_reporter();

-- IMPORTANT: U3B1 already has a restrictive flags policy. Replace that
-- specific policy, otherwise restricted reporters could not see their own
-- flags. All approved learners see ONLY their own new reports, admins all.
DROP POLICY IF EXISTS kg_u3b1_read ON public.kg_chart_flags;
CREATE POLICY kg_u3b1_read ON public.kg_chart_flags
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.kg_chart_is_admin() OR
    (reporter_id IS NOT NULL AND reporter_id=auth.uid())
  );

-- Revoke all default public EXECUTE on the supporting helpers.
REVOKE ALL ON FUNCTION public.kg_chart_u3b3a_private_topic(text,text)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b3a_private_topic_any(text)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b3a_private_vocabulary(text,uuid)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b3a_private_sentence(text,text)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.kg_chart_u3b3a_private_colour(text,uuid,uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b3a_private_topic(text,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b3a_private_topic_any(text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b3a_private_vocabulary(text,uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b3a_private_sentence(text,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3b3a_private_colour(text,uuid,uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.kg_chart_u3b3a_stamp_flag_reporter()
  FROM PUBLIC,anon;

-- U3B3A intentionally does NOT secure publicly accessible Storage media,
-- service-worker cached media, or previously exported packs; U3B3B/U3D
-- require a separate URL/Storage compatibility rollout and approval.
COMMIT;
