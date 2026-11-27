-- F2D3E1: bounded bulk authorization publication and audit candidate.
-- Disposable PostgreSQL only; never install on hosted Supabase.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'kg_u4b2_fixture' THEN
    RAISE EXCEPTION 'Disposable KG fixture required';
  END IF;
END $$;

-- One metadata-only audit row per nonempty authorization transition group.
-- Earlier epochs predate this audit. No source texts, private rule values,
-- email lists, learner history or arbitrary client-supplied actor fields.
CREATE TABLE kg_u4b2b_test_private.f2d3e1_global_audit (
  epoch bigint PRIMARY KEY CHECK(epoch>1),
  source_name text NOT NULL,
  operation text NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
  removed_rows bigint NOT NULL CHECK(removed_rows>=0),
  added_rows bigint NOT NULL CHECK(added_rows>=0),
  affected_profiles bigint NOT NULL CHECK(affected_profiles>=0),
  actor_id uuid,
  actor_kind text NOT NULL CHECK(actor_kind IN ('verified_admin','verified_account','unverified_api','maintenance')),
  invoker_role text NOT NULL,
  transaction_id bigint NOT NULL,
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (greatest(removed_rows,added_rows)>0)
);
ALTER TABLE kg_u4b2b_test_private.f2d3e1_global_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kg_u4b2b_test_private.f2d3e1_global_audit FROM PUBLIC,anon,authenticated,service_role;

-- The existing BEFORE STATEMENT lock remains on every source. It obtains
-- the exclusive global gate before source rows, so publication can safely
-- advance the epoch and all existing restricted profiles together. Do not
-- coalesce once per transaction: a later statement may change scope again.
-- No session GUC, caller-supplied suppression flag or trigger-depth skip.
CREATE FUNCTION kg_u4b2b_test_private.f2d3e1_publish_transition()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  old_n bigint:=0;
  new_n bigint:=0;
  next_epoch bigint;
  profiles bigint;
  actor uuid;
  actor_role text;
  actor_kind text;
  invoker text:=coalesce(nullif(current_setting('role',true),'none'),session_user::text);
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN (
    'kg_chart_settings','kg_chart_sentence_group_topic_map',
    'kg_chart_access_feature_catalog','kg_chart_languages','kg_chart_topics',
    'kg_chart_topic_translations','kg_chart_vocabulary','kg_chart_vocabulary_translations',
    'kg_chart_sentences','kg_chart_colour_phrases','kg_chart_private_media_assets')
    OR TG_WHEN<>'AFTER' OR TG_LEVEL<>'STATEMENT' THEN
    RAISE EXCEPTION 'F2D3E1 unexpected publication source' USING ERRCODE='42501';
  END IF;

  -- Transition relations are statement-local and include only actually
  -- modified rows. Use whole-row JSONB multiset differences rather than
  -- positional pairing or an assumed immutable primary key. A key rename
  -- counts as a change. Empty/RLS-denied/no-op groups do not publish.
  -- For settings preserve the previously reviewed sensitive-key scope
  -- on BOTH sides, including renames into or out of that scope.
  IF TG_TABLE_NAME='kg_chart_settings' THEN
    IF TG_OP='INSERT' THEN
      SELECT count(*) INTO new_n FROM new_rows
        WHERE key IN ('private_lessons','unlock_rules','pronunciation_daily_limit');
    ELSIF TG_OP='DELETE' THEN
      SELECT count(*) INTO old_n FROM old_rows
        WHERE key IN ('private_lessons','unlock_rules','pronunciation_daily_limit');
    ELSIF TG_OP='UPDATE' THEN
      SELECT count(*) INTO old_n FROM (
        SELECT to_jsonb(o) FROM old_rows o WHERE key IN ('private_lessons','unlock_rules','pronunciation_daily_limit')
        EXCEPT ALL
        SELECT to_jsonb(n) FROM new_rows n WHERE key IN ('private_lessons','unlock_rules','pronunciation_daily_limit')
      ) AS difference;
      SELECT count(*) INTO new_n FROM (
        SELECT to_jsonb(n) FROM new_rows n WHERE key IN ('private_lessons','unlock_rules','pronunciation_daily_limit')
        EXCEPT ALL
        SELECT to_jsonb(o) FROM old_rows o WHERE key IN ('private_lessons','unlock_rules','pronunciation_daily_limit')
      ) AS difference;
    ELSE
      RAISE EXCEPTION 'F2D3E1 unsupported operation' USING ERRCODE='42501';
    END IF;
  ELSE
    IF TG_OP='INSERT' THEN
      SELECT count(*) INTO new_n FROM new_rows;
    ELSIF TG_OP='DELETE' THEN
      SELECT count(*) INTO old_n FROM old_rows;
    ELSIF TG_OP='UPDATE' THEN
      SELECT count(*) INTO old_n FROM (
        SELECT to_jsonb(o) FROM old_rows o
        EXCEPT ALL
        SELECT to_jsonb(n) FROM new_rows n
      ) AS difference;
      SELECT count(*) INTO new_n FROM (
        SELECT to_jsonb(n) FROM new_rows n
        EXCEPT ALL
        SELECT to_jsonb(o) FROM old_rows o
      ) AS difference;
    ELSE
      RAISE EXCEPTION 'F2D3E1 unsupported operation' USING ERRCODE='42501';
    END IF;
  END IF;
  IF old_n=0 AND new_n=0 THEN RETURN NULL; END IF;

  UPDATE kg_u4b2b_test_private.f2d_authorization_gate
    SET epoch=epoch+1 WHERE singleton RETURNING epoch INTO next_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'F2D3E1 authorization gate unavailable' USING ERRCODE='42501';
  END IF;
  UPDATE public.kg_chart_access_profiles SET revision=revision+1,updated_at=now()
    WHERE mode='restricted';
  GET DIAGNOSTICS profiles=ROW_COUNT;

  -- SECURITY DEFINER changes current_user, so record the invoking SQL role
  -- and verified account separately. Never invent an admin for a service
  -- or trusted maintenance statement with no verified authenticated actor.
  actor_kind:='maintenance';
  IF invoker='authenticated' THEN
    SELECT u.id,k.role INTO actor,actor_role
      FROM auth.users u JOIN public.kg_chart_users k ON k.email=lower(u.email)
      WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL;
    actor_kind:=CASE WHEN actor IS NULL THEN 'unverified_api'
      WHEN actor_role='admin' AND public.kg_chart_is_admin() IS TRUE THEN 'verified_admin'
      ELSE 'verified_account' END;
  END IF;
  INSERT INTO kg_u4b2b_test_private.f2d3e1_global_audit
    (epoch,source_name,operation,removed_rows,added_rows,affected_profiles,
     actor_id,actor_kind,invoker_role,transaction_id)
  VALUES(next_epoch,TG_TABLE_NAME,TG_OP,old_n,new_n,profiles,
     actor,actor_kind,invoker,txid_current());
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION kg_u4b2b_test_private.f2d3e1_publish_transition()
  FROM PUBLIC,anon,authenticated,service_role;

-- PostgreSQL transition tables require separate AFTER triggers by event.
-- A mixed INSERT ... ON CONFLICT DO UPDATE can therefore publish twice:
-- once for changed UPDATE rows and once for new INSERT rows. FK cascades
-- can produce multiple groups; do not suppress nested trigger invocations.
-- Preserve all existing BEFORE lock/no-TRUNCATE hooks and source policies.
DO $install$
DECLARE t text; prior text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'kg_chart_settings','kg_chart_sentence_group_topic_map',
    'kg_chart_access_feature_catalog','kg_chart_languages','kg_chart_topics',
    'kg_chart_topic_translations','kg_chart_vocabulary','kg_chart_vocabulary_translations',
    'kg_chart_sentences','kg_chart_colour_phrases','kg_chart_private_media_assets'
  ] LOOP
    prior:=CASE t WHEN 'kg_chart_settings' THEN 'f2d1_settings_publish'
      WHEN 'kg_chart_sentence_group_topic_map' THEN 'f2d1_mapping_publish'
      ELSE 'f2d2_content_publish' END;
    EXECUTE format('DROP TRIGGER %I ON public.%I',prior,t);
    EXECUTE format('CREATE TRIGGER f2d3e1_publish_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION kg_u4b2b_test_private.f2d3e1_publish_transition()',t);
    EXECUTE format('CREATE TRIGGER f2d3e1_publish_update AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION kg_u4b2b_test_private.f2d3e1_publish_transition()',t);
    EXECUTE format('CREATE TRIGGER f2d3e1_publish_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION kg_u4b2b_test_private.f2d3e1_publish_transition()',t);
  END LOOP;
END $install$;
DROP FUNCTION kg_u4b2b_test_private.f2d_publish_edit();
DROP FUNCTION kg_u4b2b_test_private.f2d2_publish_content();
COMMIT;
