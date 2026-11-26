-- F2D3A candidate: exact sealed F1 v1 recovery draft, isolated fixture only.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;

-- The positional prototype is an internal implementation after this step.
-- Only the adapter can select the compatibility behavior.
REVOKE ALL ON FUNCTION public.kg_chart_f2_save_restricted_quiz(
  bigint,uuid,text,text,text,int,int,smallint,timestamptz,timestamptz,jsonb,text,boolean)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.kg_chart_f2_save_recovery_quiz(
  p_expected_revision bigint,p_draft jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  s jsonb;
  a jsonb;
  payload jsonb;
  kind text;
  mode text;
  owner_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'F2D3A unauthenticated' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(p_draft) IS DISTINCT FROM 'object'
     OR octet_length(p_draft::text) > 2200000 THEN
    RAISE EXCEPTION 'F2D3A invalid draft' USING ERRCODE='22023';
  END IF;
  IF p_draft->'version' IS DISTINCT FROM '1'::jsonb
     OR p_draft->'sealed' IS DISTINCT FROM 'true'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_draft) k
       WHERE k NOT IN ('version','id','ownerId','languageCode','kind','session','answers','sealed','omittedColumns'))
     OR jsonb_typeof(p_draft->'id') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_draft->'ownerId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_draft->'languageCode') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_draft->'kind') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_draft->'session') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_draft->'answers') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_draft->'omittedColumns') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'F2D3A malformed recovery envelope' USING ERRCODE='22023';
  END IF;
  owner_id := (p_draft->>'ownerId')::uuid;
  IF owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'F2D3A wrong recovery owner' USING ERRCODE='42501';
  END IF;
  s := p_draft->'session';
  kind := p_draft->>'kind';
  mode := s->>'quiz_type';
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(s) k WHERE k NOT IN
      ('id','user_id','language_code','topic_id','quiz_type','total_questions','correct_answers',
       'completed_at','created_at','quiz_level','difficulty'))
     OR s->'id' IS DISTINCT FROM p_draft->'id'
     OR s->'user_id' IS DISTINCT FROM p_draft->'ownerId'
     OR s->'language_code' IS DISTINCT FROM p_draft->'languageCode'
     OR jsonb_typeof(s->'quiz_type') IS DISTINCT FROM 'string'
     OR jsonb_typeof(s->'total_questions') IS DISTINCT FROM 'number'
     OR jsonb_typeof(s->'correct_answers') IS DISTINCT FROM 'number'
     OR jsonb_typeof(s->'completed_at') IS DISTINCT FROM 'string'
     OR jsonb_typeof(s->'created_at') IS DISTINCT FROM 'string'
     OR (s ? 'topic_id' AND jsonb_typeof(s->'topic_id') NOT IN ('string','null'))
     OR (s ? 'difficulty' AND jsonb_typeof(s->'difficulty') NOT IN ('number','null'))
     OR (s ? 'quiz_level' AND jsonb_typeof(s->'quiz_level') NOT IN ('string','null'))
     OR NOT ((kind='word' AND mode IN ('native_to_image','image_to_native','devanagari_to_image',
        'english_to_native','listen_to_image','listen_to_native','word_builder','type_word'))
       OR (kind='sentence' AND mode IN ('sentence_to_meaning','meaning_to_sentence','build_sentence'))) THEN
    RAISE EXCEPTION 'F2D3A invalid session contract' USING ERRCODE='22023';
  END IF;
  -- Current type_word always records the level. Older unknown or dropped
  -- levels require explicit reconciliation rather than guessed progress.
  IF (mode='type_word' AND (s->>'quiz_level' IS NULL OR s->>'quiz_level' NOT IN ('copy','dev','memory')))
     OR (mode<>'type_word' AND s->>'quiz_level' IS NOT NULL) THEN
    RAISE EXCEPTION 'F2D3A invalid typed-word level' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_draft->'answers') NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'F2D3A invalid answer count' USING ERRCODE='22023';
  END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(p_draft->'answers') LOOP
    IF jsonb_typeof(a) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'F2D3A invalid answer object' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(a) k WHERE k NOT IN
        ('id','session_id','vocabulary_id','sentence_id','selected_vocabulary_id','is_correct','answer_text','answered_at'))
       OR a->'session_id' IS DISTINCT FROM s->'id'
       OR a->'id' IS NOT DISTINCT FROM s->'id'
       OR (kind='word' AND (a->>'vocabulary_id' IS NULL OR a->>'sentence_id' IS NOT NULL))
       OR (kind='sentence' AND (a->>'sentence_id' IS NULL OR a->>'vocabulary_id' IS NOT NULL)) THEN
      RAISE EXCEPTION 'F2D3A invalid answer association' USING ERRCODE='22023';
    END IF;
  END LOOP;
  -- F1 compatibility omission hints never authorize dropping fields here.
  -- The original data is still present in the recovery envelope.
  SELECT jsonb_agg(value - 'session_id' ORDER BY ordinality) INTO payload
    FROM jsonb_array_elements(p_draft->'answers') WITH ORDINALITY;
  RETURN public.kg_chart_f2_save_restricted_quiz(
    p_expected_revision,(s->>'id')::uuid,s->>'language_code',s->>'topic_id',mode,
    (s->>'total_questions')::int,(s->>'correct_answers')::int,(s->>'difficulty')::smallint,
    (s->>'completed_at')::timestamptz,(s->>'created_at')::timestamptz,payload,s->>'quiz_level',true);
END $$;
REVOKE ALL ON FUNCTION public.kg_chart_f2_save_recovery_quiz(bigint,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kg_chart_f2_save_recovery_quiz(bigint,jsonb) TO authenticated;
COMMIT;
