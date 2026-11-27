-- F2D3E2: isolated admin learning-path controls and targeted publication.
-- Disposable fixture only; no production migration, grant or activation.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;

-- Model the actual admin/learner fields. Historical reset rows may have
-- NULL email (global reset); this candidate never creates a global reset.
CREATE TABLE public.kg_chart_topic_unlocks (
  email text NOT NULL,
  language_code text NOT NULL,
  topic_id text NOT NULL,
  PRIMARY KEY(email,language_code,topic_id)
);
CREATE TABLE public.kg_chart_progress_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  language_code text NOT NULL,
  reset_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.kg_chart_topic_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kg_chart_progress_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kg_chart_topic_unlocks,public.kg_chart_progress_resets
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.kg_chart_topic_unlocks,public.kg_chart_progress_resets TO authenticated;

CREATE FUNCTION public.kg_chart_f2_verified_path_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT auth.uid() IS NOT NULL AND public.kg_chart_is_admin() IS TRUE AND EXISTS (
    SELECT 1 FROM auth.users u JOIN public.kg_chart_users k ON k.email=lower(u.email)
    WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL AND k.role='admin');
$$;
REVOKE ALL ON FUNCTION public.kg_chart_f2_verified_path_admin() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_verified_path_admin() TO authenticated;

-- Raw historical reads for approved legacy callers and verified admins.
-- Restricted callers use the concrete-language RPC below, not an ambiguous
-- wildcard row. RESTRICTIVE predicates defeat a broader added read policy.
CREATE POLICY f2d3e2_unlock_read ON public.kg_chart_topic_unlocks FOR SELECT TO authenticated
  USING(public.kg_chart_f2_verified_path_admin() OR
    (public.kg_chart_u3b2_is_legacy() IS TRUE AND email=lower(auth.jwt()->>'email')));
CREATE POLICY f2d3e2_unlock_scope ON public.kg_chart_topic_unlocks AS RESTRICTIVE FOR SELECT TO authenticated
  USING(public.kg_chart_f2_verified_path_admin() OR
    (public.kg_chart_u3b2_is_legacy() IS TRUE AND email=lower(auth.jwt()->>'email')));
CREATE POLICY f2d3e2_reset_read ON public.kg_chart_progress_resets FOR SELECT TO authenticated
  USING(public.kg_chart_f2_verified_path_admin() OR
    (public.kg_chart_u3b2_is_legacy() IS TRUE AND (email IS NULL OR email=lower(auth.jwt()->>'email'))));
CREATE POLICY f2d3e2_reset_scope ON public.kg_chart_progress_resets AS RESTRICTIVE FOR SELECT TO authenticated
  USING(public.kg_chart_f2_verified_path_admin() OR
    (public.kg_chart_u3b2_is_legacy() IS TRUE AND (email IS NULL OR email=lower(auth.jwt()->>'email'))));

-- The old level table's raw writes remain own-row legacy writes. An admin
-- cannot bypass version/audit by adding a permissive other-owner policy.
-- The restricted write predicates from F2D3C are retained.
CREATE POLICY f2d3e2_own_level_insert ON public.kg_chart_user_levels
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(email=lower(auth.jwt()->>'email'));
CREATE POLICY f2d3e2_own_level_update ON public.kg_chart_user_levels
  AS RESTRICTIVE FOR UPDATE TO authenticated USING(email=lower(auth.jwt()->>'email'))
  WITH CHECK(email=lower(auth.jwt()->>'email'));
CREATE POLICY f2d3e2_own_level_delete ON public.kg_chart_user_levels
  AS RESTRICTIVE FOR DELETE TO authenticated USING(email=lower(auth.jwt()->>'email'));
CREATE POLICY f2d3e2_admin_level_read ON public.kg_chart_user_levels FOR SELECT TO authenticated
  USING(public.kg_chart_f2_verified_path_admin());
CREATE POLICY f2d3e2_level_read_scope ON public.kg_chart_user_levels AS RESTRICTIVE FOR SELECT TO authenticated
  USING(public.kg_chart_f2_verified_path_admin() OR
    (email=lower(auth.jwt()->>'email') AND public.kg_chart_is_allowed() IS TRUE AND
      (public.kg_chart_u3b2_is_legacy() IS TRUE OR
       public.kg_chart_u3b2_can_quiz_session(language_code,NULL,'native_to_image') IS TRUE)));

-- Bypass remains admin-only learning-path presentation, NOT a content grant.
-- Block raw API writes to that key, including rename into/out of the key.
CREATE POLICY f2d3e2_bypass_insert ON public.kg_chart_settings AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK(key<>'admin_bypass_lock');
CREATE POLICY f2d3e2_bypass_update ON public.kg_chart_settings AS RESTRICTIVE FOR UPDATE TO authenticated
  USING(key<>'admin_bypass_lock') WITH CHECK(key<>'admin_bypass_lock');
CREATE POLICY f2d3e2_bypass_delete ON public.kg_chart_settings AS RESTRICTIVE FOR DELETE TO authenticated
  USING(key<>'admin_bypass_lock');

-- An administrative downward override must not immediately be undone by
-- old MCQ evidence. Old receipt timestamps are UNKNOWN, never backfilled.
-- Subsequent exact recovery retries do not change their receipt time.
ALTER TABLE public.kg_chart_user_levels ADD COLUMN f2_admin_cutoff_at timestamptz;
ALTER TABLE kg_u4b2b_test_private.f2d3c_mcq_receipts ADD COLUMN confirmed_at timestamptz;
ALTER TABLE kg_u4b2b_test_private.f2d3c_mcq_receipts ALTER COLUMN confirmed_at SET DEFAULT clock_timestamp();
CREATE OR REPLACE FUNCTION public.kg_chart_f2_check_level_up(
  p_expected_revision bigint,p_lang text,p_expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  l public.kg_chart_user_levels%ROWTYPE;
  rules jsonb;
  target integer;
  pct integer;
  total bigint := 0;
  correct bigint := 0;
  s record;
BEGIN
  l := kg_u4b2b_test_private.f2d3c_lock_level(p_expected_revision,p_lang);
  IF p_expected_version IS DISTINCT FROM l.f2_level_version THEN
    RAISE EXCEPTION 'F2D3C stale level version' USING ERRCODE='40001';
  END IF;
  SELECT value INTO rules FROM public.kg_chart_settings WHERE key='unlock_rules';
  target := kg_u4b2b_test_private.f2d3c_rule(rules,p_lang,'answers',40,10,200);
  pct := kg_u4b2b_test_private.f2d3c_rule(rules,p_lang,'pct',85,50,100);
  IF l.unlocked<4 THEN
    -- Only atomically confirmed MCQ sets qualify. Recheck current question
    -- scope and exact answer IDs/counts/score; never count bare summaries or
    -- incomplete historical work. Do not delete or lower existing history.
    FOR s IN
      SELECT q.total_questions,q.correct_answers
      FROM public.kg_chart_quiz_sessions q
      JOIN kg_u4b2b_test_private.f2d3c_mcq_receipts r
        ON r.session_id=q.id AND r.user_id=q.user_id AND r.language_code=q.language_code
        AND r.difficulty=q.difficulty
      CROSS JOIN LATERAL (
        SELECT count(*) AS n,count(*) FILTER (WHERE a.is_correct) AS good,
          array_agg(a.id ORDER BY a.id) AS ids,
          bool_and(a.is_correct IS NOT NULL AND a.answered_at IS NOT NULL
            AND a.vocabulary_id IS NOT NULL AND a.sentence_id IS NULL
            AND public.kg_chart_u3b2_can_answer(q.id,a.vocabulary_id,a.sentence_id) IS TRUE
            AND public.kg_chart_u3b3b1_can_private_answer(q.id,a.vocabulary_id,a.sentence_id) IS TRUE) AS allowed
        FROM public.kg_chart_quiz_answers a WHERE a.session_id=q.id
      ) evidence
      WHERE q.user_id=auth.uid() AND q.language_code=p_lang AND q.difficulty=l.unlocked
        AND q.quiz_type IN ('native_to_image','image_to_native','devanagari_to_image',
          'english_to_native','listen_to_image','listen_to_native')
        AND q.completed_at IS NOT NULL AND q.total_questions BETWEEN 1 AND 500
        AND (l.f2_admin_cutoff_at IS NULL OR (r.confirmed_at>l.f2_admin_cutoff_at
          AND q.created_at>l.f2_admin_cutoff_at AND q.completed_at>l.f2_admin_cutoff_at))
        AND q.correct_answers BETWEEN 0 AND q.total_questions
        AND evidence.n=q.total_questions AND evidence.good=q.correct_answers
        AND evidence.ids=r.answer_ids AND evidence.allowed IS TRUE
      ORDER BY q.created_at DESC,q.id DESC
    LOOP
      total := total+s.total_questions;
      correct := correct+s.correct_answers;
      EXIT WHEN total>=target;
    END LOOP;
    IF total>=target AND correct*100>=pct*total THEN
      UPDATE public.kg_chart_user_levels SET unlocked=unlocked+1,
        f2_level_version=f2_level_version+1,updated_at=now()
        WHERE email=l.email AND language_code=l.language_code RETURNING * INTO l;
    END IF;
  END IF;
  RETURN kg_u4b2b_test_private.f2d3c_level_json(l) ||
    jsonb_build_object('evaluated_total',total,'evaluated_correct',correct,
      'required_answers',target,'required_pct',pct);
END $$;

REVOKE ALL ON FUNCTION public.kg_chart_f2_check_level_up(bigint,text,bigint)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_check_level_up(bigint,text,bigint) TO authenticated;

-- Private event receipt is also the targeted administrative audit.
-- No learning history or private content text; no fabricated old events.
CREATE TABLE kg_u4b2b_test_private.f2d3e2_admin_events (
  event_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN ('manual_unlock','path_reset','level_override','admin_bypass')),
  request_hash bytea NOT NULL CHECK(octet_length(request_hash)=32),
  results jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE kg_u4b2b_test_private.f2d3e2_bypass_version (
  singleton boolean PRIMARY KEY CHECK(singleton),
  version bigint NOT NULL CHECK(version>=0)
);
INSERT INTO kg_u4b2b_test_private.f2d3e2_bypass_version VALUES(true,0);
ALTER TABLE kg_u4b2b_test_private.f2d3e2_admin_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_u4b2b_test_private.f2d3e2_bypass_version ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kg_u4b2b_test_private.f2d3e2_admin_events,
  kg_u4b2b_test_private.f2d3e2_bypass_version FROM PUBLIC,anon,authenticated,service_role;

-- Admin target validation cannot call the learner-scoped predicates as
-- if auth.uid were the target. Check actual grants/catalog/private rules
-- directly; learner reads still use the authoritative caller predicates.
CREATE FUNCTION kg_u4b2b_test_private.f2d3e2_target_topic(p_email text,p_lang text,p_topic text)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE rules jsonb; entry jsonb;
BEGIN
  SELECT value INTO rules FROM public.kg_chart_settings WHERE key='private_lessons';
  rules:=coalesce(rules,'[]'::jsonb);
  IF jsonb_typeof(rules) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(rules) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object'
       OR (entry ? 'emails' AND jsonb_typeof(entry->'emails') IS DISTINCT FROM 'array')
       OR (entry ? 'sentence_groups' AND jsonb_typeof(entry->'sentence_groups') IS DISTINCT FROM 'array') THEN
      RETURN false;
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(entry->'emails','[]'::jsonb)) x
      WHERE jsonb_typeof(x) IS DISTINCT FROM 'string') THEN RETURN false; END IF;
  END LOOP;
  RETURN EXISTS (
    SELECT 1 FROM public.kg_chart_access_topics g
    JOIN public.kg_chart_access_languages al ON al.email=g.email AND al.language_code=g.language_code
    JOIN public.kg_chart_languages l ON l.code=g.language_code AND l.is_active IS TRUE
    JOIN public.kg_chart_topics t ON t.id=g.topic_id AND t.is_hidden IS DISTINCT FROM true
    JOIN public.kg_chart_topic_translations tt ON tt.topic_id=g.topic_id AND tt.language_code=g.language_code
    WHERE g.email=p_email AND g.topic_id=p_topic AND (p_lang='*' OR g.language_code=p_lang)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(rules) rule
        WHERE rule->>'topic_id'=g.topic_id
          AND (rule->>'language_code' IS NULL OR rule->>'language_code'=g.language_code)
          AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(rule->'emails','[]'::jsonb)) member
            WHERE lower(member)=p_email)
      )
  );
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d3e2_target_topic(text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.kg_chart_f2_my_path_controls(p_expected_revision bigint,p_lang text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); email_id text; mode_id text; rev bigint; topics jsonb; cutoff timestamptz;
BEGIN
  IF uid IS NULL OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3E2 unverified learner' USING ERRCODE='42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision<1 THEN
    RAISE EXCEPTION 'F2D3E2 revision required' USING ERRCODE='40001';
  END IF;
  PERFORM kg_u4b2b_test_private.f2d_lock_shared();
  SELECT lower(u.email) INTO email_id FROM auth.users u
    JOIN public.kg_chart_users k ON k.email=lower(u.email)
    WHERE u.id=uid AND u.email_confirmed_at IS NOT NULL AND k.role='operator';
  IF email_id IS NULL THEN RAISE EXCEPTION 'F2D3E2 unverified operator' USING ERRCODE='42501'; END IF;
  SELECT mode,revision INTO mode_id,rev FROM public.kg_chart_access_profiles WHERE email=email_id FOR SHARE;
  IF NOT FOUND OR mode_id IS DISTINCT FROM 'restricted' THEN
    RAISE EXCEPTION 'F2D3E2 existing restricted profile required' USING ERRCODE='42501';
  END IF;
  IF rev IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'F2D3E2 stale permission revision' USING ERRCODE='40001';
  END IF;
  IF p_lang IS NULL OR p_lang !~ '^[a-z]{2,3}$' OR
     public.kg_chart_u3b1_can_language(p_lang) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3E2 denied path language' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(jsonb_agg(x.topic_id ORDER BY x.topic_id),'[]'::jsonb) INTO topics FROM (
    SELECT DISTINCT u.topic_id FROM public.kg_chart_topic_unlocks u
      WHERE u.email=email_id AND u.language_code IN (p_lang,'*')
        AND public.kg_chart_u3b1_can_topic(p_lang,u.topic_id) IS TRUE
        AND public.kg_chart_u3b3a_private_topic(p_lang,u.topic_id) IS TRUE
  ) x;
  SELECT max(reset_at) INTO cutoff FROM public.kg_chart_progress_resets
    WHERE (email=email_id OR email IS NULL) AND language_code IN (p_lang,'*');
  RETURN jsonb_build_object('owner_id',uid,'permission_revision',rev,
    'language_code',p_lang,'unlocks',topics,'reset_at',cutoff,'bypass',false);
END $$;

CREATE FUNCTION public.kg_chart_f2_admin_bypass_state()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v jsonb; n bigint;
BEGIN
  IF public.kg_chart_f2_verified_path_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3E2 admin required' USING ERRCODE='42501';
  END IF;
  PERFORM kg_u4b2b_test_private.f2d_lock_shared();
  SELECT value INTO v FROM public.kg_chart_settings WHERE key='admin_bypass_lock';
  v:=coalesce(v,'false'::jsonb);
  IF jsonb_typeof(v) IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'F2D3E2 historical bypass needs reconciliation' USING ERRCODE='22023';
  END IF;
  SELECT version INTO n FROM kg_u4b2b_test_private.f2d3e2_bypass_version WHERE singleton;
  RETURN jsonb_build_object('enabled',v,'version',n);
END $$;

-- One action type per bounded batch; one change per target owner. Stable
-- event receipt makes retry after a lost response safe, including resets.
-- Explicit baseline revision for each target, plus level version for an
-- override. Bypass has its own version. No lifecycle creation or mode change.
CREATE FUNCTION public.kg_chart_f2_admin_path_control(
  p_event_id uuid,p_operation text,p_changes jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  actor uuid:=auth.uid(); item jsonb; owner_id uuid; email_id text;
  rev bigint; profile_mode text; expected_rev bigint; lang text; topic text;
  expected_level_version bigint; desired int; enabled boolean; before_enabled boolean;
  l public.kg_chart_user_levels%ROWTYPE; before_state jsonb; after_state jsonb;
  results jsonb:='[]'::jsonb; hash bytea; old_event kg_u4b2b_test_private.f2d3e2_admin_events%ROWTYPE;
  changed boolean; at_now timestamptz; previous_reset timestamptz; old_setting jsonb; bypass_version bigint;
BEGIN
  IF public.kg_chart_f2_verified_path_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3E2 verified admin required' USING ERRCODE='42501';
  END IF;
  IF p_event_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('manual_unlock','path_reset','level_override','admin_bypass')
     OR jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR octet_length(p_changes::text)>65536 THEN
    RAISE EXCEPTION 'F2D3E2 invalid control batch' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_changes) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'F2D3E2 invalid batch size' USING ERRCODE='22023';
  END IF;
  -- Rare admin actions use the exclusive gate first; no shared-to-exclusive
  -- upgrade when writing the settings row, and no competing learner writes.
  PERFORM 1 FROM kg_u4b2b_test_private.f2d_authorization_gate WHERE singleton FOR UPDATE;
  IF NOT FOUND OR public.kg_chart_f2_verified_path_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3E2 authorization unavailable' USING ERRCODE='42501';
  END IF;
  hash:=sha256(convert_to(jsonb_build_object('version',1,'operation',p_operation,'changes',p_changes)::text,'UTF8'));
  SELECT * INTO old_event FROM kg_u4b2b_test_private.f2d3e2_admin_events WHERE event_id=p_event_id;
  IF FOUND THEN
    IF old_event.actor_id IS DISTINCT FROM actor OR old_event.request_hash IS DISTINCT FROM hash THEN
      RAISE EXCEPTION 'F2D3E2 event identity conflict' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('event_id',p_event_id,'operation',p_operation,'results',old_event.results,'replayed',true);
  END IF;
  IF p_operation='admin_bypass' THEN
    IF jsonb_array_length(p_changes)<>1 THEN RAISE EXCEPTION 'F2D3E2 single bypass action required' USING ERRCODE='22023'; END IF;
    item:=p_changes->0;
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'F2D3E2 invalid bypass object' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('expected_version','enabled'))
       OR jsonb_typeof(item->'enabled') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(item->'expected_version') IS DISTINCT FROM 'number'
       OR (item->>'expected_version') !~ '^(0|[1-9][0-9]*)$' THEN
      RAISE EXCEPTION 'F2D3E2 invalid bypass fields' USING ERRCODE='22023';
    END IF;
    SELECT version INTO bypass_version FROM kg_u4b2b_test_private.f2d3e2_bypass_version WHERE singleton FOR UPDATE;
    IF NOT FOUND OR bypass_version IS DISTINCT FROM (item->>'expected_version')::bigint THEN
      RAISE EXCEPTION 'F2D3E2 stale bypass version' USING ERRCODE='40001';
    END IF;
    SELECT value INTO old_setting FROM public.kg_chart_settings WHERE key='admin_bypass_lock';
    old_setting:=coalesce(old_setting,'false'::jsonb);
    IF jsonb_typeof(old_setting) IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'F2D3E2 historical bypass needs reconciliation' USING ERRCODE='22023';
    END IF;
    enabled:=(item->>'enabled')::boolean;
    before_state:=jsonb_build_object('enabled',old_setting,'version',bypass_version);
    changed:=old_setting IS DISTINCT FROM to_jsonb(enabled);
    IF changed THEN
      INSERT INTO public.kg_chart_settings(key,value) VALUES('admin_bypass_lock',to_jsonb(enabled))
        ON CONFLICT(key) DO UPDATE SET value=excluded.value;
      UPDATE kg_u4b2b_test_private.f2d3e2_bypass_version SET version=version+1 WHERE singleton RETURNING version INTO bypass_version;
    END IF;
    results:=jsonb_build_array(jsonb_build_object('changed',changed,'before',before_state,
      'after',jsonb_build_object('enabled',enabled,'version',bypass_version)));
  ELSE
    IF (SELECT count(DISTINCT value->>'owner_id') FROM jsonb_array_elements(p_changes))<>jsonb_array_length(p_changes) THEN
      RAISE EXCEPTION 'F2D3E2 one change per owner required' USING ERRCODE='22023';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_changes) ORDER BY (value->>'owner_id')::uuid LOOP
      IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'F2D3E2 invalid target object' USING ERRCODE='22023'; END IF;
      IF jsonb_typeof(item->'owner_id') IS DISTINCT FROM 'string'
         OR jsonb_typeof(item->'expected_revision') IS DISTINCT FROM 'number'
         OR (item->>'expected_revision') !~ '^[1-9][0-9]*$'
         OR jsonb_typeof(item->'language_code') IS DISTINCT FROM 'string'
         OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('owner_id','expected_revision','language_code')
           AND NOT (p_operation='manual_unlock' AND k IN ('topic_id','enabled'))
           AND NOT (p_operation='level_override' AND k IN ('unlocked','expected_level_version'))) THEN
        RAISE EXCEPTION 'F2D3E2 invalid target fields' USING ERRCODE='22023';
      END IF;
      owner_id:=(item->>'owner_id')::uuid;
      expected_rev:=(item->>'expected_revision')::bigint;
      lang:=item->>'language_code';
      IF lang IS NULL OR (lang<>'*' AND lang !~ '^[a-z]{2,3}$') OR (lang='*' AND p_operation='level_override') THEN
        RAISE EXCEPTION 'F2D3E2 invalid control language' USING ERRCODE='22023';
      END IF;
      SELECT lower(u.email) INTO email_id FROM auth.users u JOIN public.kg_chart_users k ON k.email=lower(u.email)
        WHERE u.id=owner_id AND u.email_confirmed_at IS NOT NULL AND k.role='operator' FOR SHARE OF u,k;
      IF NOT FOUND THEN RAISE EXCEPTION 'F2D3E2 verified target required' USING ERRCODE='42501'; END IF;
      SELECT mode,revision INTO profile_mode,rev FROM public.kg_chart_access_profiles WHERE email=email_id FOR UPDATE;
      IF NOT FOUND OR profile_mode IS DISTINCT FROM 'restricted' THEN
        RAISE EXCEPTION 'F2D3E2 existing restricted target required' USING ERRCODE='42501';
      END IF;
      IF rev IS DISTINCT FROM expected_rev THEN RAISE EXCEPTION 'F2D3E2 stale target revision' USING ERRCODE='40001'; END IF;
      at_now:=clock_timestamp();
      changed:=false;
      topic:=NULL;
      IF p_operation='manual_unlock' THEN
        IF jsonb_typeof(item->'topic_id') IS DISTINCT FROM 'string'
           OR btrim(item->>'topic_id')='' OR item->>'topic_id'<>btrim(item->>'topic_id')
           OR length(item->>'topic_id')>200 OR jsonb_typeof(item->'enabled') IS DISTINCT FROM 'boolean' THEN
          RAISE EXCEPTION 'F2D3E2 invalid topic unlock' USING ERRCODE='22023';
        END IF;
        topic:=item->>'topic_id'; enabled:=(item->>'enabled')::boolean;
        IF enabled AND kg_u4b2b_test_private.f2d3e2_target_topic(email_id,lang,topic) IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'F2D3E2 unlock outside granted topic scope' USING ERRCODE='42501';
        END IF;
        SELECT EXISTS(SELECT 1 FROM public.kg_chart_topic_unlocks
          WHERE email=email_id AND language_code=lang AND topic_id=topic) INTO before_enabled;
        changed:=before_enabled IS DISTINCT FROM enabled;
        before_state:=jsonb_build_object('enabled',before_enabled);
        IF changed AND enabled THEN
          INSERT INTO public.kg_chart_topic_unlocks(email,language_code,topic_id) VALUES(email_id,lang,topic);
        ELSIF changed THEN
          DELETE FROM public.kg_chart_topic_unlocks WHERE email=email_id AND language_code=lang AND topic_id=topic;
        END IF;
        after_state:=jsonb_build_object('enabled',enabled);
      ELSE
        IF lang<>'*' AND NOT EXISTS(SELECT 1 FROM public.kg_chart_access_languages al
          JOIN public.kg_chart_languages l2 ON l2.code=al.language_code AND l2.is_active IS TRUE
          WHERE al.email=email_id AND al.language_code=lang) THEN
          RAISE EXCEPTION 'F2D3E2 denied target language' USING ERRCODE='42501';
        END IF;
        IF p_operation='path_reset' THEN
          -- Preserve all historical answers/completions/ratings/manual unlocks.
          -- Reset is an append-only cutoff for topic progression, not a wipe.
          SELECT max(reset_at) INTO previous_reset FROM public.kg_chart_progress_resets
            WHERE (email=email_id OR email IS NULL) AND (lang='*' OR language_code IN (lang,'*'));
          at_now:=date_trunc('milliseconds',at_now);
          IF previous_reset IS NOT NULL AND at_now<=previous_reset THEN
            RAISE EXCEPTION 'F2D3E2 historical reset cutoff requires reconciliation' USING ERRCODE='22023';
          END IF;
          INSERT INTO public.kg_chart_progress_resets(email,language_code,reset_at) VALUES(email_id,lang,at_now);
          before_state:=jsonb_build_object('reset_at',previous_reset);
          after_state:=jsonb_build_object('reset_at',at_now);
          changed:=true;
        ELSE
          IF NOT EXISTS(SELECT 1 FROM public.kg_chart_access_features g
             JOIN public.kg_chart_access_feature_catalog c ON c.feature_key=g.feature_key AND c.is_active IS TRUE
             WHERE g.email=email_id AND g.feature_key='quiz.words') THEN
            RAISE EXCEPTION 'F2D3E2 denied target word quiz feature' USING ERRCODE='42501';
          END IF;
          IF jsonb_typeof(item->'unlocked') IS DISTINCT FROM 'number' OR (item->>'unlocked') !~ '^[1-4]$'
             OR jsonb_typeof(item->'expected_level_version') IS DISTINCT FROM 'number'
             OR (item->>'expected_level_version') !~ '^(0|[1-9][0-9]*)$' THEN
            RAISE EXCEPTION 'F2D3E2 invalid level override' USING ERRCODE='22023';
          END IF;
          desired:=(item->>'unlocked')::int; expected_level_version:=(item->>'expected_level_version')::bigint;
          SELECT * INTO l FROM public.kg_chart_user_levels WHERE email=email_id AND language_code=lang FOR UPDATE;
          IF NOT FOUND THEN
            l.email:=email_id; l.language_code:=lang; l.level:=1; l.unlocked:=1; l.f2_level_version:=0;
          END IF;
          IF l.level NOT BETWEEN 1 AND 4 OR l.unlocked NOT BETWEEN 1 AND 4 OR l.level>l.unlocked THEN
            RAISE EXCEPTION 'F2D3E2 historical level requires reconciliation' USING ERRCODE='22023';
          END IF;
          IF l.f2_level_version IS DISTINCT FROM expected_level_version THEN
            RAISE EXCEPTION 'F2D3E2 stale level version' USING ERRCODE='40001';
          END IF;
          before_state:=kg_u4b2b_test_private.f2d3c_level_json(l)||
            jsonb_build_object('admin_cutoff_at',l.f2_admin_cutoff_at);
          changed:=desired<>l.unlocked;
          IF changed THEN
            INSERT INTO public.kg_chart_user_levels(email,language_code,level,unlocked,updated_at,f2_level_version,f2_admin_cutoff_at)
              VALUES(email_id,lang,least(l.level,desired),desired,at_now,l.f2_level_version+1,
                CASE WHEN desired<l.unlocked THEN at_now ELSE l.f2_admin_cutoff_at END)
              ON CONFLICT(email,language_code) DO UPDATE SET level=excluded.level,unlocked=excluded.unlocked,
                updated_at=excluded.updated_at,f2_level_version=excluded.f2_level_version,
                f2_admin_cutoff_at=excluded.f2_admin_cutoff_at RETURNING * INTO l;
          END IF;
          after_state:=kg_u4b2b_test_private.f2d3c_level_json(l)||
            jsonb_build_object('admin_cutoff_at',l.f2_admin_cutoff_at);
        END IF;
      END IF;
      IF changed THEN
        UPDATE public.kg_chart_access_profiles SET revision=revision+1,updated_at=now()
          WHERE email=email_id RETURNING revision INTO rev;
      END IF;
      results:=results||jsonb_build_array(jsonb_build_object('owner_id',owner_id,'language_code',lang,
        'topic_id',topic,'changed',changed,'previous_revision',expected_rev,'permission_revision',rev,
        'before',before_state,'after',after_state));
    END LOOP;
  END IF;
  INSERT INTO kg_u4b2b_test_private.f2d3e2_admin_events(event_id,actor_id,operation,request_hash,results)
    VALUES(p_event_id,actor,p_operation,hash,results);
  RETURN jsonb_build_object('event_id',p_event_id,'operation',p_operation,'results',results,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.kg_chart_f2_my_path_controls(bigint,text),
  public.kg_chart_f2_admin_bypass_state(),public.kg_chart_f2_admin_path_control(uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_my_path_controls(bigint,text),
  public.kg_chart_f2_admin_bypass_state(),public.kg_chart_f2_admin_path_control(uuid,text,jsonb) TO authenticated;
COMMIT;
