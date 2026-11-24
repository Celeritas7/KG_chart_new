-- KG Chart U3A: read-only authenticated permission snapshot.
-- PREPARATION ONLY: the learner UI, existing source-table RLS, and old PWAs
-- do NOT use this endpoint yet. It is not an authorization enforcement rollout.
-- Requires separately approved/applied U1 permission tables. No U2 dependency.
--
-- Security:
-- * no user email / user ID parameter; identity comes ONLY from auth.uid()
-- * existing kg_chart_is_allowed() must authorize the verified session
-- * SECURITY DEFINER is limited to a vetted, read-only result. It is needed
--   because U1 raw permission tables intentionally have admin-only RLS.
-- * fixed search_path, schema-qualified relations, no dynamic SQL,
--   no user-supplied object names, no sensitive output, no user data writes.
-- * PUBLIC and anon cannot execute the function; authenticated only.
-- * never report permissions as SERVER ENFORCED until U3B is complete.
-- * restricted = explicit allowlists (including empty); legacy = no override.
--
-- DO NOT execute this SQL against production without separate owner approval.
BEGIN;

CREATE OR REPLACE FUNCTION public.kg_chart_u3_my_access_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid;
  v_email text;
  v_role text;
  v_mode text;
  v_revision bigint;
  v_languages jsonb;
  v_topics jsonb;
  v_features jsonb;
BEGIN
  v_uid := auth.uid();

  -- The current signed-in user must exist, be approved and have an allowed
  -- session. Never accept an arbitrary email, JWT user_metadata, or caller id.
  IF v_uid IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'KG Chart account access is not approved'
      USING ERRCODE = '42501';
  END IF;

  -- Do not expose admin or reviewer details via the new snapshot contract.
  -- Existing administrators are deliberately left in legacy mode.
  IF public.kg_chart_is_admin() THEN
    RETURN pg_catalog.jsonb_build_object(
      'contract', 1, 'mode', 'legacy', 'revision', 0,
      'languages', NULL, 'topics', NULL, 'features', NULL,
      'server_enforced', false
    );
  END IF;

  SELECT pg_catalog.lower(u.email), k.role
    INTO v_email, v_role
    FROM auth.users AS u
    JOIN public.kg_chart_users AS k ON k.email = pg_catalog.lower(u.email)
    WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;

  IF v_email IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'KG Chart account access is not approved'
      USING ERRCODE = '42501';
  END IF;

  -- Reviewers retain the existing reviewer experience; U2 only drafts
  -- policies for the operator role, not reviewers.
  IF v_role <> 'operator' THEN
    RETURN pg_catalog.jsonb_build_object(
      'contract', 1, 'mode', 'legacy', 'revision', 0,
      'languages', NULL, 'topics', NULL, 'features', NULL,
      'server_enforced', false
    );
  END IF;

  SELECT p.mode, p.revision INTO v_mode, v_revision
    FROM public.kg_chart_access_profiles AS p
    WHERE p.email = v_email;

  IF v_mode IS NULL OR v_mode = 'legacy' THEN
    RETURN pg_catalog.jsonb_build_object(
      'contract', 1, 'mode', 'legacy',
      'revision', coalesce(v_revision, 0),
      'languages', NULL, 'topics', NULL, 'features', NULL,
      'server_enforced', false
    );
  END IF;

  IF v_mode <> 'restricted' THEN
    RAISE EXCEPTION 'Invalid KG Chart permission mode'
      USING ERRCODE = '42501';
  END IF;

  -- This is a prospective permission selection, NOT yet an enforced one.
  -- A restricted policy with no rows MUST return empty arrays.
  SELECT coalesce(pg_catalog.jsonb_agg(l.code ORDER BY l.sort_order, l.code),
                             '[]'::jsonb)
    INTO v_languages
    FROM public.kg_chart_access_languages AS al
    JOIN public.kg_chart_languages AS l ON l.code = al.language_code
    WHERE al.email = v_email AND l.is_active IS TRUE;

  SELECT coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('language_code', at.language_code, 'topic_id', at.topic_id)
        ORDER BY l.sort_order, t.sort_order, at.topic_id
      ), '[]'::jsonb)
    INTO v_topics
    FROM public.kg_chart_access_topics AS at
    JOIN public.kg_chart_access_languages AS al
      ON al.email = at.email AND al.language_code = at.language_code
    JOIN public.kg_chart_languages AS l
      ON l.code = at.language_code AND l.is_active IS TRUE
    JOIN public.kg_chart_topic_translations AS tt
      ON tt.topic_id = at.topic_id AND tt.language_code = at.language_code
    JOIN public.kg_chart_topics AS t
      ON t.id = at.topic_id AND t.is_hidden IS DISTINCT FROM true
    WHERE at.email = v_email
      -- An existing private lesson remains private even when granted by U2.
      AND NOT EXISTS (
        SELECT 1
        FROM public.kg_chart_settings AS setting
        CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
          CASE WHEN pg_catalog.jsonb_typeof(setting.value) = 'array'
               THEN setting.value ELSE '[]'::jsonb END
        ) AS rule(record)
        WHERE setting.key = 'private_lessons'
          AND rule.record->>'topic_id' = at.topic_id
          AND (rule.record->>'language_code' IS NULL
               OR rule.record->>'language_code' = at.language_code)
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements_text(
              CASE WHEN pg_catalog.jsonb_typeof(rule.record->'emails') = 'array'
                   THEN rule.record->'emails' ELSE '[]'::jsonb END
            ) AS allowed(email)
            WHERE pg_catalog.lower(allowed.email) = v_email
          )
      );

  SELECT coalesce(pg_catalog.jsonb_agg(f.feature_key ORDER BY f.sort_order, f.feature_key),
                             '[]'::jsonb)
    INTO v_features
    FROM public.kg_chart_access_features AS af
    JOIN public.kg_chart_access_feature_catalog AS f
      ON f.feature_key = af.feature_key
    WHERE af.email = v_email AND f.is_active IS TRUE;

  RETURN pg_catalog.jsonb_build_object(
    'contract', 1, 'mode', 'restricted', 'revision', v_revision,
    'languages', v_languages, 'topics', v_topics, 'features', v_features,
    'server_enforced', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.kg_chart_u3_my_access_snapshot()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kg_chart_u3_my_access_snapshot()
  TO authenticated;

COMMIT;
