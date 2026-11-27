-- F2D3D3: restricted personal preference patch and typing-best candidate.
-- Disposable fixture only. No hosted schema, client or migration change.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;

-- Model the actual audio/typing producer fields. The fixture has no existing
-- prefs table; live defaults, grants and historical shapes need inspection.
CREATE TABLE public.kg_chart_user_prefs (
  user_id uuid PRIMARY KEY,
  audio_voice text NOT NULL DEFAULT 'f' CHECK(audio_voice IN ('m','f')),
  audio_muted boolean NOT NULL DEFAULT false,
  typing_best jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.kg_chart_user_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kg_chart_user_prefs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.kg_chart_user_prefs TO authenticated;
-- Model only the existing legacy own-row read/upsert. A restricted read
-- must use the filtered RPC; a full row could expose revoked topic keys.
CREATE POLICY f2d3d3_legacy_pref_select ON public.kg_chart_user_prefs
  FOR SELECT TO authenticated USING (
    user_id=auth.uid() AND public.kg_chart_u3b2_is_legacy() IS TRUE);
CREATE POLICY f2d3d3_legacy_pref_insert ON public.kg_chart_user_prefs
  FOR INSERT TO authenticated WITH CHECK (
    user_id=auth.uid() AND public.kg_chart_u3b2_is_legacy() IS TRUE);
CREATE POLICY f2d3d3_legacy_pref_update ON public.kg_chart_user_prefs
  FOR UPDATE TO authenticated USING (
    user_id=auth.uid() AND public.kg_chart_u3b2_is_legacy() IS TRUE)
  WITH CHECK (user_id=auth.uid() AND public.kg_chart_u3b2_is_legacy() IS TRUE);
-- Defense even against another permissive policy added later.
CREATE POLICY f2d3d3_restrict_pref_select ON public.kg_chart_user_prefs
  AS RESTRICTIVE FOR SELECT TO authenticated USING (
    user_id=auth.uid() AND public.kg_chart_u3b2_is_legacy() IS TRUE);
CREATE POLICY f2d3d3_restrict_pref_insert ON public.kg_chart_user_prefs
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (
    user_id=auth.uid() AND public.kg_chart_u3b2_is_legacy() IS TRUE);
CREATE POLICY f2d3d3_restrict_pref_update ON public.kg_chart_user_prefs
  AS RESTRICTIVE FOR UPDATE TO authenticated USING (
    user_id=auth.uid() AND public.kg_chart_u3b2_is_legacy() IS TRUE)
  WITH CHECK (user_id=auth.uid() AND public.kg_chart_u3b2_is_legacy() IS TRUE);

CREATE TABLE kg_u4b2b_test_private.f2d3d3_pref_versions (
  owner_id uuid PRIMARY KEY,
  version bigint NOT NULL CHECK(version>0)
);
CREATE TABLE kg_u4b2b_test_private.f2d3d3_pref_receipts (
  event_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  permission_revision bigint NOT NULL,
  request_hash bytea NOT NULL CHECK(octet_length(request_hash)=32),
  event_version bigint NOT NULL CHECK(event_version>0)
);
ALTER TABLE kg_u4b2b_test_private.f2d3d3_pref_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_u4b2b_test_private.f2d3d3_pref_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kg_u4b2b_test_private.f2d3d3_pref_versions,
  kg_u4b2b_test_private.f2d3d3_pref_receipts FROM PUBLIC,anon,authenticated,service_role;

-- The global gate and profile-before-data ordering is shared with F2C.
-- FOR UPDATE on the existing profile serializes same-owner preference
-- patches including a missing row/version; different owners stay independent.
CREATE FUNCTION kg_u4b2b_test_private.f2d3d3_lock_owner(
  p_expected_revision bigint,p_owner uuid
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); email_id text; profile_mode text; rev bigint;
BEGIN
  IF uid IS NULL OR p_owner IS DISTINCT FROM uid
     OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3D3 wrong or unverified owner' USING ERRCODE='42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision<1 THEN
    RAISE EXCEPTION 'F2D3D3 revision required' USING ERRCODE='40001';
  END IF;
  PERFORM kg_u4b2b_test_private.f2d_lock_shared();
  SELECT lower(u.email) INTO email_id FROM auth.users u
    JOIN public.kg_chart_users k ON k.email=lower(u.email)
    WHERE u.id=uid AND u.email_confirmed_at IS NOT NULL AND k.role='operator';
  IF email_id IS NULL THEN
    RAISE EXCEPTION 'F2D3D3 unverified operator' USING ERRCODE='42501';
  END IF;
  SELECT mode,revision INTO profile_mode,rev FROM public.kg_chart_access_profiles
    WHERE email=email_id FOR UPDATE;
  IF NOT FOUND OR profile_mode IS DISTINCT FROM 'restricted'
     OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3D3 existing restricted profile required' USING ERRCODE='42501';
  END IF;
  IF rev IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'F2D3D3 stale permission revision' USING ERRCODE='40001';
  END IF;
  RETURN uid;
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d3d3_lock_owner(bigint,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Actual TypingView keys: lang|copy/recall|words[|topic].
-- Restricted typing intentionally does not allow the sentences source.
-- A bare words key means all CURRENTLY permitted topics, not all content.
CREATE FUNCTION kg_u4b2b_test_private.f2d3d3_typing_scope(p_key text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE parts text[]; topic text;
BEGIN
  IF p_key IS NULL OR octet_length(p_key)>512 THEN RETURN false; END IF;
  parts:=string_to_array(p_key,'|');
  IF cardinality(parts) NOT IN (3,4) OR parts[1] !~ '^[a-z]{2,3}$'
     OR parts[2] NOT IN ('copy','recall') OR parts[3]<>'words' THEN RETURN false; END IF;
  IF cardinality(parts)=4 THEN
    topic:=parts[4];
    IF topic IS NULL OR btrim(topic)='' OR topic<>btrim(topic)
       OR topic='all' OR char_length(topic)>200 THEN RETURN false; END IF;
  END IF;
  RETURN public.kg_chart_u3b2_can_quiz_session(parts[1],topic,'typing_'||parts[2]) IS TRUE
    AND public.kg_chart_u3b3b1_can_private_session(parts[1],topic) IS TRUE;
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d3d3_typing_scope(text)
  FROM PUBLIC,anon,authenticated,service_role;

-- Retain actual {cpm,last,at} shape; no client-controlled preference-row
-- timestamp. Restrict future run timestamps to 5 minutes of clock skew.
-- These are personal practice metrics, not verified quiz/level evidence.
CREATE FUNCTION kg_u4b2b_test_private.f2d3d3_valid_best(v jsonb,p_now timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE stamp timestamptz;
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT (v ?& ARRAY['cpm','last','at'])
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN ('cpm','last','at'))
     OR jsonb_typeof(v->'cpm') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v->'last') IS DISTINCT FROM 'number'
     OR (v->>'cpm') !~ '^(0|[1-9][0-9]{0,5})$'
     OR (v->>'last') !~ '^(0|[1-9][0-9]{0,5})$'
     OR jsonb_typeof(v->'at') IS DISTINCT FROM 'string'
     OR (v->>'at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    RETURN false;
  END IF;
  IF (v->>'cpm')::integer>100000 OR (v->>'last')::integer>(v->>'cpm')::integer THEN
    RETURN false;
  END IF;
  stamp:=(v->>'at')::timestamptz;
  RETURN isfinite(stamp) AND stamp<=p_now+interval '5 minutes';
EXCEPTION WHEN data_exception THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d3d3_valid_best(jsonb,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.kg_chart_f2_my_preferences(p_expected_revision bigint,p_owner_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid; prefs public.kg_chart_user_prefs%ROWTYPE; v bigint; scoped jsonb;
BEGIN
  uid:=kg_u4b2b_test_private.f2d3d3_lock_owner(p_expected_revision,p_owner_id);
  SELECT * INTO prefs FROM public.kg_chart_user_prefs WHERE user_id=uid;
  IF FOUND AND jsonb_typeof(prefs.typing_best) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'F2D3D3 historical preference map needs reconciliation' USING ERRCODE='22023';
  END IF;
  SELECT version INTO v FROM kg_u4b2b_test_private.f2d3d3_pref_versions WHERE owner_id=uid;
  SELECT coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) INTO scoped
    FROM jsonb_each(coalesce(prefs.typing_best,'{}'::jsonb)) e
    WHERE kg_u4b2b_test_private.f2d3d3_typing_scope(e.key)
      AND kg_u4b2b_test_private.f2d3d3_valid_best(e.value,statement_timestamp());
  RETURN jsonb_build_object('owner_id',uid,'permission_revision',p_expected_revision,
    'version',coalesce(v,0),'audio_voice',coalesce(prefs.audio_voice,'f'),
    'audio_muted',coalesce(prefs.audio_muted,false),'typing_best',scoped);
END $$;

CREATE FUNCTION public.kg_chart_f2_patch_preferences(
  p_expected_revision bigint,p_owner_id uuid,p_event_id uuid,p_expected_version bigint,p_patch jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE
  uid uuid; prefs public.kg_chart_user_prefs%ROWTYPE; v bigint; next_version bigint;
  prior kg_u4b2b_test_private.f2d3d3_pref_receipts%ROWTYPE;
  req_hash bytea; new_best jsonb; item record; old jsonb; merged jsonb;
  old_at timestamptz; new_at timestamptz; best integer; at_now timestamptz:=clock_timestamp();
BEGIN
  uid:=kg_u4b2b_test_private.f2d3d3_lock_owner(p_expected_revision,p_owner_id);
  IF p_event_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0
     OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
     OR octet_length(p_patch::text)>65536 THEN
    RAISE EXCEPTION 'F2D3D3 invalid preference patch' USING ERRCODE='22023';
  END IF;
  IF p_patch='{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k
      WHERE k NOT IN ('audio_voice','audio_muted','typing_best'))
     OR (p_patch ? 'audio_voice' AND (jsonb_typeof(p_patch->'audio_voice') IS DISTINCT FROM 'string'
          OR p_patch->>'audio_voice' NOT IN ('m','f')))
     OR (p_patch ? 'audio_muted' AND jsonb_typeof(p_patch->'audio_muted') IS DISTINCT FROM 'boolean')
     OR (p_patch ? 'typing_best' AND jsonb_typeof(p_patch->'typing_best') IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'F2D3D3 invalid preference fields' USING ERRCODE='22023';
  END IF;
  IF p_patch ? 'typing_best' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_patch->'typing_best')) NOT BETWEEN 1 AND 50 THEN
      RAISE EXCEPTION 'F2D3D3 invalid typing patch size' USING ERRCODE='22023';
    END IF;
    FOR item IN SELECT * FROM jsonb_each(p_patch->'typing_best') LOOP
      IF kg_u4b2b_test_private.f2d3d3_typing_scope(item.key) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'F2D3D3 denied typing preference scope' USING ERRCODE='42501';
      END IF;
      IF kg_u4b2b_test_private.f2d3d3_valid_best(item.value,at_now) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'F2D3D3 invalid typing best' USING ERRCODE='22023';
      END IF;
    END LOOP;
  END IF;

  -- Current authorization and all supplied keys are checked before replay.
  -- Hash immutable authored fields, not a second copy of historical values.
  req_hash:=sha256(convert_to(jsonb_build_object('version',1,'expected_version',p_expected_version,
    'patch',p_patch)::text,'UTF8'));
  SELECT version INTO v FROM kg_u4b2b_test_private.f2d3d3_pref_versions WHERE owner_id=uid;
  v:=coalesce(v,0);
  SELECT * INTO prior FROM kg_u4b2b_test_private.f2d3d3_pref_receipts WHERE event_id=p_event_id;
  IF FOUND THEN
    IF prior.owner_id IS DISTINCT FROM uid OR prior.request_hash IS DISTINCT FROM req_hash THEN
      RAISE EXCEPTION 'F2D3D3 preference event identity conflict' USING ERRCODE='23505';
    END IF;
    IF prior.permission_revision IS DISTINCT FROM p_expected_revision THEN
      RAISE EXCEPTION 'F2D3D3 historical preference revision requires reconciliation' USING ERRCODE='40001';
    END IF;
    -- ACK the historical operation, never its old values as current state.
    RETURN jsonb_build_object('owner_id',uid,'event_id',p_event_id,'event_version',prior.event_version,
      'current_version',v,'permission_revision',p_expected_revision,'replayed',true);
  END IF;
  IF v IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'F2D3D3 stale preference baseline' USING ERRCODE='40001';
  END IF;

  SELECT * INTO prefs FROM public.kg_chart_user_prefs WHERE user_id=uid FOR UPDATE;
  new_best:=coalesce(prefs.typing_best,'{}'::jsonb);
  IF p_patch ? 'typing_best' THEN
    IF jsonb_typeof(new_best) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'F2D3D3 historical preference map needs reconciliation' USING ERRCODE='22023';
    END IF;
    FOR item IN SELECT * FROM jsonb_each(p_patch->'typing_best') LOOP
      old:=new_best->item.key;
      IF old IS NULL THEN
        merged:=item.value;
      ELSE
        -- Do not silently normalize, discard or claim unverified historical
        -- values. Hold a touched invalid key while leaving other keys intact.
        IF kg_u4b2b_test_private.f2d3d3_valid_best(old,at_now) IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'F2D3D3 historical best needs reconciliation' USING ERRCODE='22023';
        END IF;
        old_at:=(old->>'at')::timestamptz; new_at:=(item.value->>'at')::timestamptz;
        IF old_at=new_at AND old->'last' IS DISTINCT FROM item.value->'last' THEN
          RAISE EXCEPTION 'F2D3D3 ambiguous equal-time typing run' USING ERRCODE='23505';
        END IF;
        best:=greatest((old->>'cpm')::integer,(item.value->>'cpm')::integer);
        merged:=(CASE WHEN new_at>old_at THEN item.value ELSE old END)||jsonb_build_object('cpm',best);
      END IF;
      new_best:=jsonb_set(new_best,ARRAY[item.key],merged,true);
    END LOOP;
  END IF;
  INSERT INTO public.kg_chart_user_prefs(user_id,audio_voice,audio_muted,typing_best,updated_at)
    VALUES(uid,coalesce(p_patch->>'audio_voice',prefs.audio_voice,'f'),
      coalesce((p_patch->>'audio_muted')::boolean,prefs.audio_muted,false),new_best,at_now)
    ON CONFLICT(user_id) DO UPDATE SET audio_voice=excluded.audio_voice,
      audio_muted=excluded.audio_muted,typing_best=excluded.typing_best,updated_at=excluded.updated_at;
  next_version:=v+1;
  INSERT INTO kg_u4b2b_test_private.f2d3d3_pref_versions(owner_id,version) VALUES(uid,next_version)
    ON CONFLICT(owner_id) DO UPDATE SET version=excluded.version;
  INSERT INTO kg_u4b2b_test_private.f2d3d3_pref_receipts
    (event_id,owner_id,permission_revision,request_hash,event_version)
    VALUES(p_event_id,uid,p_expected_revision,req_hash,next_version);
  RETURN jsonb_build_object('owner_id',uid,'event_id',p_event_id,'event_version',next_version,
    'current_version',next_version,'permission_revision',p_expected_revision,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.kg_chart_f2_my_preferences(bigint,uuid),
  public.kg_chart_f2_patch_preferences(bigint,uuid,uuid,bigint,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_my_preferences(bigint,uuid),
  public.kg_chart_f2_patch_preferences(bigint,uuid,uuid,bigint,jsonb) TO authenticated;
COMMIT;
