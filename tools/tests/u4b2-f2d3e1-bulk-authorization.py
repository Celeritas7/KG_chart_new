#!/usr/bin/env python3
"""F2D3E1: baseline and coalesced authorization publication in synthetic CI."""
import json
import runpy
import sys
from pathlib import Path

root=Path(__file__).parent
a=runpy.run_path(str(root/"u4b2-f2a-existing-profile-protocol.py"))
d=runpy.run_path(str(root/"u4b2-f2d2-content-authorization.py"))
c=runpy.run_path(str(root/"u4b2-f2c-versioned-progress.py"))
query,value,denied,start,ready,wait_blocked,finish,clean=(
    a[k] for k in ("query","value","denied","start","ready","wait_blocked","finish","clean"))
UID,OTHER,EMAIL,OTHER_EMAIL,IDENTITY,OTHER_IDENTITY,ADMIN=(
    a[k] for k in ("UID","OTHER","EMAIL","OTHER_EMAIL","IDENTITY","OTHER_IDENTITY","ADMIN"))
epoch,revisions,expect_versions,assert_at=(
    d[k] for k in ("epoch","revisions","expect_versions","assert_at"))
rate,state,ack=c["rate"],c["state"],c["ack"]
G=d["G"]
V="public.kg_chart_vocabulary"
T="public.kg_chart_topics"
TT="public.kg_chart_topic_translations"
M="public.kg_chart_sentence_group_topic_map"
S="public.kg_chart_settings"
A="kg_u4b2b_test_private.f2d3e1_global_audit"
PROFILE="public.kg_chart_access_profiles"
N=1000
PREFIX="99948000-0000-4000-8000-"
BULK=f"INSERT INTO {V}(id,topic_id,english_text) SELECT ('{PREFIX}'||lpad(g::text,12,'0'))::uuid,'food','synthetic bulk '||g FROM generate_series(1,{N}) g;"
SCOPE=f"id::text LIKE '{PREFIX}%'"
CHANGE=f"UPDATE {V} SET english_text=english_text||' revised' WHERE {SCOPE};"
NOOP=f"UPDATE {V} SET english_text=english_text WHERE {SCOPE};"
REMOVE=f"DELETE FROM {V} WHERE {SCOPE};"
ADMIN_ID="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
SOURCES=[t for t,*_ in d["CASES"]]+[S,M]

def advance(e,r,n=1):
    return e+n,(r[0]+n,r[1]+n)

def audit(after):
    return json.loads(value(f"""SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY epoch),'[]'::jsonb)
      FROM {A} a WHERE epoch>{after};"""))

def expected_audit(after,events,profiles,actor_kind="maintenance"):
    rows=audit(after)
    assert len(rows)==len(events),(rows,events)
    actual=[(r["source_name"],r["operation"],r["removed_rows"],r["added_rows"]) for r in rows]
    assert sorted(actual)==sorted(events),(actual,events)
    assert [r["epoch"] for r in rows]==list(range(after+1,after+1+len(rows)))
    assert all(r["affected_profiles"]==profiles and r["actor_kind"]==actor_kind for r in rows),rows
    assert all(r["transaction_id"]>0 for r in rows)
    return rows

def baseline():
    # Actual row-trigger baseline on the identical workload. Roll back,
    # including all temporary source rows and all revision increments.
    e,r=epoch(),revisions()
    assert value(f"SELECT count(*) FROM {V} WHERE {SCOPE};")=="0"
    assert value(f"SELECT count(*) FROM {PROFILE} WHERE mode='restricted';")=="2"
    query("BEGIN;"+BULK+assert_at(*advance(e,r,N))+CHANGE+
          assert_at(*advance(e,r,2*N))+NOOP+assert_at(*advance(e,r,2*N))+
          REMOVE+assert_at(*advance(e,r,3*N))+"ROLLBACK;")
    expect_versions(e,r)
    assert value(f"SELECT count(*) FROM {V} WHERE {SCOPE};")=="0"
    print("F2D3E1_BASELINE_1000_ROW_INSERT_UPDATE_DELETE_PASS: 3000 epochs and 3000 increments per restricted profile; rolled back")

def check_install(e,r):
    # The 11-table scope must be complete; old row publication removed,
    # unchanged lock/no-truncate guards retained. No audit API privileges.
    for table in SOURCES:
        assert value(f"""SELECT count(*) FROM pg_trigger
          WHERE tgrelid='{table}'::regclass AND NOT tgisinternal AND tgenabled='O'
            AND tgname IN ('f2d3e1_publish_insert','f2d3e1_publish_update','f2d3e1_publish_delete')
            AND (tgtype & 1)=0;""")=="3",table
        assert value(f"""SELECT count(*) FROM pg_trigger
          WHERE tgrelid='{table}'::regclass AND NOT tgisinternal AND tgenabled='O'
          AND tgname IN ('f2d1_settings_lock','f2d1_mapping_lock','f2d2_content_lock',
                         'f2d1_settings_no_truncate','f2d1_mapping_no_truncate','f2d2_content_no_truncate');""")=="2",table
        assert value(f"""SELECT count(*) FROM pg_trigger WHERE tgrelid='{table}'::regclass
          AND tgname IN ('f2d1_settings_publish','f2d1_mapping_publish','f2d2_content_publish');""")=="0",table
        denied(f"BEGIN; TRUNCATE {table} CASCADE; ROLLBACK;","42501")
    for role in ("anon","authenticated","service_role"):
        for privilege in ("SELECT","INSERT","UPDATE","DELETE","TRUNCATE"):
            assert value(f"SELECT has_table_privilege('{role}','{A}','{privilege}');")=="f"
        assert value(f"""SELECT has_function_privilege('{role}',
          'kg_u4b2b_test_private.f2d3e1_publish_transition()','EXECUTE');""")=="f"
    expect_versions(e,r)
    assert audit(e)==[]
    print("F2D3E1_ELEVEN_SOURCE_TRIGGER_AND_AUDIT_PRIVILEGES_PASS")

def bulk(e,r,profiles):
    query(BULK)
    expect_versions(*advance(e,r))
    assert value(f"SELECT count(*) FROM {V} WHERE {SCOPE};")==str(N)
    query(CHANGE)
    expect_versions(*advance(e,r,2))
    query(NOOP)
    expect_versions(*advance(e,r,2))
    # Unchanged upsert, conflict DO NOTHING and zero-row delete: no audit.
    query(BULK.rstrip(";")+" ON CONFLICT(id) DO NOTHING;"+
          f"INSERT INTO {V}(id,topic_id,english_text) SELECT id,topic_id,english_text FROM {V} WHERE {SCOPE} "
          "ON CONFLICT(id) DO UPDATE SET english_text=excluded.english_text;"+
          f"DELETE FROM {V} WHERE id='{PREFIX}000000009999';")
    expect_versions(*advance(e,r,2))
    query(REMOVE)
    expect_versions(*advance(e,r,3))
    assert value(f"SELECT count(*) FROM {V} WHERE {SCOPE};")=="0"
    rows=expected_audit(e,[("kg_chart_vocabulary","INSERT",0,N),
      ("kg_chart_vocabulary","UPDATE",N,N),("kg_chart_vocabulary","DELETE",N,0)],profiles)
    assert all(x["actor_id"] is None for x in rows)
    print("F2D3E1_BULK_1000_ROW_INSERT_UPDATE_DELETE_PASS: 3 epochs and 3 increments per restricted profile (1000x fewer than measured baseline)")
    return advance(e,r,3)

def all_sources(e,r,profiles):
    # Exercise every existing catalog/content source after replacement.
    # No-op and denied changes publish nothing; changed admin row produces
    # one private receipt in the same transaction, then rollback.
    for table,col,new,key in d["CASES"]:
        original=d["row_value"](table,col,key)
        query(IDENTITY+f"UPDATE {table} SET {col}={new} WHERE {key};")
        assert d["row_value"](table,col,key)==original
        expect_versions(e,r)
        query("BEGIN;"+ADMIN+f"UPDATE {table} SET {col}={col} WHERE {key};"
              +"RESET ROLE;"+assert_at(e,r)+ADMIN+
              f"UPDATE {table} SET {col}={new} WHERE {key};RESET ROLE;"+
              assert_at(*advance(e,r))+f"""DO $$ BEGIN
                IF NOT EXISTS(SELECT 1 FROM {A} WHERE epoch={e+1}
                  AND source_name='{table.split(".")[-1]}' AND operation='UPDATE'
                  AND removed_rows=1 AND added_rows=1 AND affected_profiles={profiles}
                  AND actor_id='{ADMIN_ID}' AND actor_kind='verified_admin'
                  AND invoker_role='authenticated')
                THEN RAISE EXCEPTION 'Missing admin publication receipt'; END IF;
              END $$;ROLLBACK;""")
        assert d["row_value"](table,col,key)==original
        expect_versions(e,r)
        assert audit(e)==[]
    # Settings: two sensitive updates in one statement, plus an unrelated
    # row. Rename into/out of scope and no-op transitions are accounted for.
    query(f"""BEGIN;
      UPDATE {S} SET value=CASE key WHEN 'unlock_rules' THEN '{{"level_up":{{"answers":17}}}}'::jsonb
        WHEN 'pronunciation_daily_limit' THEN '19'::jsonb ELSE 'true'::jsonb END
        WHERE key IN ('unlock_rules','pronunciation_daily_limit','admin_bypass_lock');
      {assert_at(*advance(e,r))}
      UPDATE {S} SET value=value WHERE key IN ('unlock_rules','pronunciation_daily_limit');
      {assert_at(*advance(e,r))}
      UPDATE {S} SET key='f2d3e1_temp_rule' WHERE key='unlock_rules';
      {assert_at(*advance(e,r,2))}
      UPDATE {S} SET key='unlock_rules' WHERE key='f2d3e1_temp_rule';
      {assert_at(*advance(e,r,3))}
      UPDATE {S} SET value='false'::jsonb WHERE key='admin_bypass_lock';
      {assert_at(*advance(e,r,3))}
      DO $$ BEGIN
        IF (SELECT count(*) FROM {A} WHERE epoch>{e} AND source_name='kg_chart_settings'
            AND removed_rows=2 AND added_rows=2)<>1
           OR NOT EXISTS(SELECT 1 FROM {A} WHERE epoch={e+2} AND removed_rows=1 AND added_rows=0)
           OR NOT EXISTS(SELECT 1 FROM {A} WHERE epoch={e+3} AND removed_rows=0 AND added_rows=1)
        THEN RAISE EXCEPTION 'Wrong filtered settings deltas'; END IF;
      END $$; ROLLBACK;""")
    expect_versions(e,r)
    assert audit(e)==[]
    # Existing mapping update and rollback must retain verified evidence.
    query(f"""BEGIN;
      UPDATE {M} SET review_status=review_status WHERE language_code='my' AND group_name='food';
      {assert_at(e,r)}
      UPDATE {M} SET review_status='disabled' WHERE language_code='my' AND group_name='food';
      {assert_at(*advance(e,r))}
      DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM {A} WHERE epoch={e+1}
           AND source_name='kg_chart_sentence_group_topic_map' AND removed_rows=1 AND added_rows=1)
        THEN RAISE EXCEPTION 'Missing mapping receipt'; END IF;
      END $$; ROLLBACK;""")
    expect_versions(e,r)
    assert audit(e)==[]
    print("F2D3E1_ALL_SOURCE_NOOP_RLS_SETTINGS_RENAME_AND_ROLLBACK_PASS")

def mixed_and_cascade(e,r,profiles):
    # Mixed UPSERT publishes each nonempty event group, not each row.
    # Two statements in one transaction must not be coalesced.
    k1=PREFIX+"000000009001"
    k2=PREFIX+"000000009002"
    query(f"""BEGIN;
      INSERT INTO {V}(id,topic_id,english_text) VALUES('{k1}','food','initial');
      {assert_at(*advance(e,r))}
      INSERT INTO {V}(id,topic_id,english_text) VALUES('{k1}','food','changed'),('{k2}','food','new')
        ON CONFLICT(id) DO UPDATE SET english_text=excluded.english_text;
      {assert_at(*advance(e,r,3))}
      DO $$ BEGIN
        IF (SELECT count(*) FROM {A} WHERE epoch>{e} AND source_name='kg_chart_vocabulary'
            AND operation='INSERT' AND removed_rows=0 AND added_rows=1)<>2
           OR (SELECT count(*) FROM {A} WHERE epoch>{e} AND source_name='kg_chart_vocabulary'
            AND operation='UPDATE' AND removed_rows=1 AND added_rows=1)<>1
           OR (SELECT count(DISTINCT transaction_id) FROM {A} WHERE epoch>{e})<>1
        THEN RAISE EXCEPTION 'Mixed upsert event groups missing'; END IF;
      END $$; ROLLBACK;""")
    expect_versions(e,r)
    assert audit(e)==[]
    # A topic-translation primary-key update cascades into the reviewed
    # group mapping AND topic grants. No trigger-depth suppression.
    query(f"""BEGIN;
      INSERT INTO {T}(id,sort_order) VALUES('f2e_from',99),('f2e_to',100);
      INSERT INTO {TT}(topic_id,language_code,title_native) VALUES('f2e_from','my','fixture from');
      INSERT INTO {M}(language_code,group_name,topic_id,review_status)
        VALUES('my','f2e_group','f2e_from','draft');
      {assert_at(*advance(e,r,3))}
      UPDATE {TT} SET topic_id='f2e_to' WHERE topic_id='f2e_from' AND language_code='my';
      {assert_at(*advance(e,r,5))}
      DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM {M} WHERE language_code='my' AND group_name='f2e_group' AND topic_id='f2e_to')
           OR NOT EXISTS(SELECT 1 FROM {A} WHERE epoch>{e+3} AND source_name='kg_chart_sentence_group_topic_map'
             AND operation='UPDATE' AND removed_rows=1 AND added_rows=1)
           OR NOT EXISTS(SELECT 1 FROM {A} WHERE epoch>{e+3} AND source_name='kg_chart_topic_translations'
             AND operation='UPDATE' AND removed_rows=1 AND added_rows=1)
        THEN RAISE EXCEPTION 'FK cascade publication missing'; END IF;
      END $$; ROLLBACK;""")
    expect_versions(e,r)
    assert audit(e)==[]
    # Actual grant-origin cascade: use a temporary translation grant in a
    # rollback transaction, then remove the translated topic.
    temp="f2e_grant"
    grants=f"ARRAY['my'],'[{{\"language_code\":\"my\",\"topic_id\":\"food\"}},{{\"language_code\":\"my\",\"topic_id\":\"{temp}\"}}]'::jsonb,ARRAY['quiz.words']"
    query(f"BEGIN; INSERT INTO {T}(id,sort_order) VALUES('{temp}',99);"
      +f"INSERT INTO {TT}(topic_id,language_code,title_native) VALUES('{temp}','my','temporary');"
      +assert_at(*advance(e,r,2))+ADMIN+a["publish"](r[0]+2,grants)+"RESET ROLE;"
      +assert_at(e+2,(r[0]+3,r[1]+2))
      +f"DELETE FROM {TT} WHERE topic_id='{temp}' AND language_code='my';"
      +assert_at(e+3,(r[0]+4,r[1]+3))+f"""DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM public.kg_chart_access_topics WHERE email='{EMAIL}' AND topic_id='{temp}')
           OR NOT EXISTS(SELECT 1 FROM {A} WHERE epoch={e+3} AND source_name='kg_chart_topic_translations' AND operation='DELETE')
        THEN RAISE EXCEPTION 'Grant cascade did not publish'; END IF;
      END $$;ROLLBACK;""")
    expect_versions(e,r)
    assert audit(e)==[]
    print("F2D3E1_MIXED_UPSERT_TRANSACTION_AND_FK_CASCADE_PASS")

def race(e,r,profiles):
    # New bulk revocation path, real learner progress writer and both
    # lock orders; previous row-trigger tests still run before this phase.
    before=state(r[0])
    other_before=state(r[1],identity=OTHER_IDENTITY)
    hide=f"UPDATE {T} SET is_hidden=true WHERE id IN ('food','colours');"
    show=f"UPDATE {T} SET is_hidden=false WHERE id IN ('food','colours');"
    h=w=None
    try:
        h=start("f2e_editor",ADMIN+"BEGIN;"+hide+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2e_writer",IDENTITY+"BEGIN ISOLATION LEVEL READ COMMITTED;"+
            rate(801,r[0],before["version"],4)+"COMMIT;")
        wait_blocked("f2e_writer","f2e_editor")
        expect_versions(e,r)
        assert audit(e)==[]
        finish(h,"COMMIT;"); finish(w,state="40001")
    finally:
        clean(w,h)
    expected_audit(e,[("kg_chart_topics","UPDATE",2,2)],profiles,"verified_admin")
    e,r=advance(e,r)
    expect_versions(e,r)
    assert c["receipts"](801)=="0"
    denied(IDENTITY+rate(801,r[0],before["version"],4),"42501")
    query(ADMIN+show)
    e,r=advance(e,r)
    expect_versions(e,r)
    assert state(r[0])==dict(before,permission_revision=r[0])
    # A writer already holding the shared gate commits before the bulk edit.
    h=w=None
    try:
        h=start("f2e_writer",IDENTITY+"BEGIN;"+rate(802,r[0],before["version"],4)+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2e_editor",ADMIN+"BEGIN;"+hide+"COMMIT;")
        wait_blocked("f2e_editor","f2e_writer")
        assert c["receipts"](802)=="0"
        finish(h,"COMMIT;"); finish(w)
    finally:
        clean(w,h)
    e,r=advance(e,r)
    expect_versions(e,r)
    assert c["receipts"](802)=="1"
    c["saved_rating"](4)
    query(ADMIN+show)
    e,r=advance(e,r)
    expect_versions(e,r)
    assert state(r[1],identity=OTHER_IDENTITY)==dict(other_before,permission_revision=r[1])
    denied(IDENTITY+rate(803,r[0]-2,before["version"]+1,5),"40001")
    ack(IDENTITY,rate(803,r[0],before["version"]+1,5),803,before["version"]+2,before["version"]+2)
    print("F2D3E1_EDITOR_WRITER_LOCK_ORDER_STALE_REVISION_AND_HISTORY_PASS")
    return e,r

def main():
    assert value("SELECT current_database();")=="kg_u4b2_fixture"
    if sys.argv[1:]==["--baseline"]:
        baseline()
        return
    assert not sys.argv[1:]
    e,r=epoch(),revisions()
    profiles=int(value(f"SELECT count(*) FROM {PROFILE} WHERE mode='restricted';"))
    assert profiles==2
    check_install(e,r)
    e,r=bulk(e,r,profiles)
    all_sources(e,r,profiles)
    mixed_and_cascade(e,r,profiles)
    e,r=race(e,r,profiles)
    expect_versions(e,r)
    assert value(f"SELECT count(*) FROM {A};")==str(7)
    print("F2D3E1_FIXTURE_ONLY_PASS: no production migration or load test")

if __name__=="__main__":
    main()
