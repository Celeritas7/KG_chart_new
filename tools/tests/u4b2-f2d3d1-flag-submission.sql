-- F2D3D1: candidate restricted single/batch flag submission.
-- Isolated PostgreSQL fixture only; never apply to hosted Supabase.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;

-- Model fields already used by FlagModal, BatchFlagModal and admin review.
-- Existing synthetic historical flags have no inferred reason or reporter.
ALTER TABLE public.kg_chart_flags
  ADD COLUMN reason text,
  ADD COLUMN shown_devanagari text,
  ADD COLUMN suggestion text,
  ADD COLUMN resolved_at timestamptz;

CREATE POLICY f2d3d1_legacy_flag_insert ON public.kg_chart_flags
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_u3b2_is_legacy() IS TRUE);
CREATE POLICY f2d3d1_legacy_flag_update ON public.kg_chart_flags
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.kg_chart_u3b2_is_legacy() IS TRUE)
  WITH CHECK (public.kg_chart_u3b2_is_legacy() IS TRUE);
CREATE POLICY f2d3d1_legacy_flag_delete ON public.kg_chart_flags
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.kg_chart_u3b2_is_legacy() IS TRUE);
REVOKE TRUNCATE ON public.kg_chart_flags FROM PUBLIC,anon,authenticated,service_role;

-- The synthetic historical schema has no admin moderation DML. Model only
-- the status/resolved_at update used by the existing admin UI, not a broader
-- real grant or policy. Retain all existing SELECT and ownership policies.
GRANT UPDATE(status,resolved_at) ON public.kg_chart_flags TO authenticated;
CREATE POLICY f2d3d1_fixture_admin_moderate ON public.kg_chart_flags
  FOR UPDATE TO authenticated
  USING (public.kg_chart_is_admin() IS TRUE AND auth.uid() IS NOT NULL)
  WITH CHECK (public.kg_chart_is_admin() IS TRUE AND auth.uid() IS NOT NULL);

-- Private, immutable idempotency receipt per report, not per target.
-- Do not FK-cascade this receipt when a moderator removes a report: a
-- retry of that ID must not recreate it. No second plaintext copy of notes.
-- Identity lifecycle, receipt retention and production migration are F3/3F.
CREATE TABLE kg_u4b2b_test_private.f2d3d1_flag_receipts (
  flag_id uuid PRIMARY KEY,
  reporter_id uuid NOT NULL,
  payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32)
);
ALTER TABLE kg_u4b2b_test_private.f2d3d1_flag_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kg_u4b2b_test_private.f2d3d1_flag_receipts FROM PUBLIC,anon,authenticated,service_role;

-- Canonical v1 authored fields only. NULL and omitted optional values are
-- equivalent. Moderation status/timestamp and DB creation time are excluded.
CREATE FUNCTION kg_u4b2b_test_private.f2d3d1_flag_hash(f public.kg_chart_flags)
RETURNS bytea LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT sha256(convert_to(jsonb_build_object(
    'version',1,'id',f.id,'language_code',f.language_code,
    'vocabulary_id',f.vocabulary_id,'sentence_id',f.sentence_id,
    'colour_phrase_id',f.colour_phrase_id,'reason',f.reason,'notes',f.notes,
    'shown_devanagari',f.shown_devanagari,'suggestion',f.suggestion)::text,'UTF8'));
$$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d3d1_flag_hash(public.kg_chart_flags)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.kg_chart_f2_submit_flags(
  p_expected_revision bigint,p_owner_id uuid,p_flags jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  uid uuid := auth.uid();
  email_id text;
  profile_mode text;
  rev bigint;
  item jsonb;
  f public.kg_chart_flags%ROWTYPE;
  previous public.kg_chart_flags%ROWTYPE;
  hash bytea;
  saved uuid;
  ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF uid IS NULL OR p_owner_id IS DISTINCT FROM uid
     OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3D1 wrong or unverified reporter' USING ERRCODE='42501';
  END IF;
  SELECT lower(u.email) INTO email_id FROM auth.users u
    JOIN public.kg_chart_users k ON k.email=lower(u.email)
    WHERE u.id=uid AND u.email_confirmed_at IS NOT NULL AND k.role='operator';
  IF email_id IS NULL THEN
    RAISE EXCEPTION 'F2D3D1 unverified operator' USING ERRCODE='42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision<1 THEN
    RAISE EXCEPTION 'F2D3D1 revision required' USING ERRCODE='40001';
  END IF;
  IF jsonb_typeof(p_flags) IS DISTINCT FROM 'array'
     OR octet_length(p_flags::text)>262144 THEN
    RAISE EXCEPTION 'F2D3D1 malformed batch' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_flags) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'F2D3D1 invalid batch size' USING ERRCODE='22023';
  END IF;
  PERFORM kg_u4b2b_test_private.f2d_lock_shared();
  SELECT mode,revision INTO profile_mode,rev FROM public.kg_chart_access_profiles
    WHERE email=email_id FOR SHARE;
  IF NOT FOUND OR profile_mode IS DISTINCT FROM 'restricted'
     OR public.kg_chart_is_allowed() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F2D3D1 existing restricted profile required' USING ERRCODE='42501';
  END IF;
  IF rev IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'F2D3D1 stale permission revision' USING ERRCODE='40001';
  END IF;

  -- Sort by parsed UUID to use the same row/receipt lock order across
  -- overlapping batches, even when input order or UUID case differs.
  FOR item IN SELECT value FROM jsonb_array_elements(p_flags)
     ORDER BY (value->>'id')::uuid LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'F2D3D1 invalid flag object' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN
       ('id','language_code','vocabulary_id','sentence_id','colour_phrase_id',
        'reason','notes','status','shown_devanagari','suggestion'))
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['id','language_code','reason','status']) k
         WHERE jsonb_typeof(item->k) IS DISTINCT FROM 'string')
       OR EXISTS (SELECT 1 FROM jsonb_each(item) e
         WHERE jsonb_typeof(e.value) NOT IN ('string','null')) THEN
      RAISE EXCEPTION 'F2D3D1 invalid flag fields' USING ERRCODE='22023';
    END IF;
    SELECT * INTO f FROM jsonb_populate_record(NULL::public.kg_chart_flags,item);
    IF f.id IS NULL OR f.id=ANY(ids) OR f.status IS DISTINCT FROM 'open'
       OR f.language_code IS NULL OR btrim(f.language_code)='' OR length(f.language_code)>32
       OR ((f.vocabulary_id IS NOT NULL)::int+(f.sentence_id IS NOT NULL)::int+
           (f.colour_phrase_id IS NOT NULL)::int)<>1
       OR f.reason NOT IN ('pronunciation','wrong_word','missing_image','missing_translation','needs_review')
       OR (f.sentence_id IS NOT NULL AND f.reason='missing_image')
       OR (f.colour_phrase_id IS NOT NULL AND f.reason='missing_translation')
       OR (f.suggestion IS NOT NULL AND f.reason<>'pronunciation')
       OR octet_length(f.notes)>16384 OR octet_length(f.shown_devanagari)>8192
       OR octet_length(f.suggestion)>8192 THEN
      RAISE EXCEPTION 'F2D3D1 invalid report' USING ERRCODE='22023';
    END IF;
    IF public.kg_chart_u3b2_can_flag(f.language_code,f.vocabulary_id,f.sentence_id,f.colour_phrase_id) IS DISTINCT FROM true
       OR public.kg_chart_u3b3b1_can_private_flag(f.language_code,f.vocabulary_id,f.sentence_id,f.colour_phrase_id) IS DISTINCT FROM true
       OR (f.colour_phrase_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.kg_chart_colour_phrases c
         JOIN public.kg_chart_vocabulary_translations ct
           ON ct.vocabulary_id=c.colour_id AND ct.language_code=c.language_code
         JOIN public.kg_chart_vocabulary_translations nt
           ON nt.vocabulary_id=c.noun_id AND nt.language_code=c.language_code
         WHERE c.id=f.colour_phrase_id AND c.language_code=f.language_code
       )) THEN
      RAISE EXCEPTION 'F2D3D1 denied flag scope' USING ERRCODE='42501';
    END IF;

    -- Authoritative permission check precedes even an exact retry ACK.
    hash := kg_u4b2b_test_private.f2d3d1_flag_hash(f);
    INSERT INTO kg_u4b2b_test_private.f2d3d1_flag_receipts(flag_id,reporter_id,payload_hash)
      VALUES(f.id,uid,hash) ON CONFLICT(flag_id) DO NOTHING RETURNING flag_id INTO saved;
    IF FOUND THEN
      -- A historical flag without a receipt cannot be silently adopted.
      -- Its collision rolls back the whole new batch, including receipts.
      INSERT INTO public.kg_chart_flags(id,reporter_id,language_code,vocabulary_id,sentence_id,
         colour_phrase_id,reason,notes,shown_devanagari,suggestion,status)
        VALUES(f.id,uid,f.language_code,f.vocabulary_id,f.sentence_id,
          f.colour_phrase_id,f.reason,f.notes,f.shown_devanagari,f.suggestion,'open');
    ELSE
      IF NOT EXISTS (SELECT 1 FROM kg_u4b2b_test_private.f2d3d1_flag_receipts r
        WHERE r.flag_id=f.id AND r.reporter_id=uid AND r.payload_hash=hash) THEN
        RAISE EXCEPTION 'F2D3D1 report identity conflict' USING ERRCODE='23505';
      END IF;
      SELECT * INTO previous FROM public.kg_chart_flags x
        WHERE x.id=f.id AND x.reporter_id=uid FOR SHARE;
      IF NOT FOUND OR kg_u4b2b_test_private.f2d3d1_flag_hash(previous) IS DISTINCT FROM hash THEN
        RAISE EXCEPTION 'F2D3D1 unconfirmed historical report' USING ERRCODE='23505';
      END IF;
      -- Deliberately do not reset a moderator's status or resolved_at.
    END IF;
    ids := array_append(ids,f.id);
  END LOOP;
  RETURN jsonb_build_object('flag_ids',to_jsonb(ids),'count',cardinality(ids),
    'expected_revision',p_expected_revision);
END $$;
REVOKE ALL ON FUNCTION public.kg_chart_f2_submit_flags(bigint,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_submit_flags(bigint,uuid,jsonb) TO authenticated;
COMMIT;
