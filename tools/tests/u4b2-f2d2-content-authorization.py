#!/usr/bin/env python3
"""F2D2: authorization-source coverage and races; disposable fixture only."""
import runpy
from pathlib import Path

root=Path(__file__).parent
a=runpy.run_path(str(root/"u4b2-f2a-existing-profile-protocol.py"))
b=runpy.run_path(str(root/"u4b2-f2b-atomic-quiz.py"))
c=runpy.run_path(str(root/"u4b2-f2c-versioned-progress.py"))
d=runpy.run_path(str(root/"u4b2-f2d1-shared-authorization.py"))
query,value,denied,start,ready,wait_blocked,finish,clean=(
    a[k] for k in ("query","value","denied","start","ready","wait_blocked","finish","clean"))
IDENTITY,OTHER_IDENTITY,ADMIN,EMAIL,OTHER_EMAIL=(
    a[k] for k in ("IDENTITY","OTHER_IDENTITY","ADMIN","EMAIL","OTHER_EMAIL"))
publish=a["publish"]
epoch,revisions,expect_versions,advance=(d[k] for k in ("epoch","revisions","expect_versions","advance"))
rate,complete,state,ack=(c[k] for k in ("rate","complete","state","ack"))
G=d["G"]
WORD=c["WORD"]
SENT=b["SENTENCE"]
ASSET="81000000-0000-4000-8000-000000000008"
FEATURE="public.kg_chart_access_feature_catalog"
TOPIC="public.kg_chart_topics"
MEDIA="public.kg_chart_private_media_assets"
TTRANS="public.kg_chart_topic_translations"

# One precise source row per table, actual field change, and a no-op.
CASES=[
    (FEATURE,"is_active","false","feature_key='quiz.words'"),
    ("public.kg_chart_languages","is_active","false","code='my'"),
    (TOPIC,"is_hidden","true","id='food'"),
    (TTRANS,"title_native","'f2d2 changed title'","topic_id='food' AND language_code='my'"),
    ("public.kg_chart_vocabulary","english_text","'f2d2 changed word'",f"id='{WORD}'"),
    ("public.kg_chart_vocabulary_translations","native_text","'f2d2 changed translation'",f"vocabulary_id='{WORD}' AND language_code='my'"),
    ("public.kg_chart_sentences","native_text","'f2d2 changed sentence'",f"id='{SENT}'"),
    ("public.kg_chart_colour_phrases","native_text","'f2d2 changed phrase'","id='30000000-0000-4000-8000-000000000001'"),
    (MEDIA,"state","'disabled'",f"asset_id='{ASSET}'"),
]

def assert_at(e,r):
    return f"""DO $check$ BEGIN
      IF (SELECT epoch FROM {G} WHERE singleton) IS DISTINCT FROM {e}::bigint
       OR (SELECT revision FROM public.kg_chart_access_profiles WHERE email='{EMAIL}') IS DISTINCT FROM {r[0]}::bigint
       OR (SELECT revision FROM public.kg_chart_access_profiles WHERE email='{OTHER_EMAIL}') IS DISTINCT FROM {r[1]}::bigint
      THEN RAISE EXCEPTION 'F2D2 wrong committed-in-transaction revision'; END IF;
    END $check$;"""

def row_value(table,col,key):
    return value(f"SELECT {col}::text FROM {table} WHERE {key};")

def coverage(e,r):
    originals=[]
    for table,col,new,key in CASES:
        original=row_value(table,col,key)
        originals.append(original)
        # Unprivileged table writes must neither change the source nor publish.
        query(IDENTITY+f"UPDATE {table} SET {col}={new} WHERE {key};")
        assert row_value(table,col,key)==original
        expect_versions(e,r)
        denied(f"TRUNCATE {table};","42501")
        # Verify that the full trigger trio really exists on every source.
        assert value(f"""SELECT count(*) FROM pg_trigger
          WHERE tgrelid='{table}'::regclass AND NOT tgisinternal
          AND tgname IN ('f2d2_content_lock','f2d2_content_publish','f2d2_content_no_truncate')
          AND tgenabled='O';""")=="3"
        # Prove admin direct no-op / actual update and all revisions in the
        # transaction, then roll back rather than changing the test baseline.
        query("BEGIN;"+ADMIN+f"UPDATE {table} SET {col}={col} WHERE {key};"
              +"RESET ROLE;"+assert_at(e,r)+ADMIN
              +f"UPDATE {table} SET {col}={new} WHERE {key};"
              +"RESET ROLE;"+assert_at(e+1,(r[0]+1,r[1]+1))+"ROLLBACK;")
        assert row_value(table,col,key)==original
        expect_versions(e,r)
    # Actual trusted maintenance INSERT, UPDATE/UPSERT, DELETE also publish.
    query(f"""BEGIN;
      INSERT INTO public.kg_chart_topics(id,sort_order) VALUES('f2d2_temp',90);
      {assert_at(e+1,(r[0]+1,r[1]+1))}
      INSERT INTO public.kg_chart_topics(id,sort_order) VALUES('f2d2_temp',91)
        ON CONFLICT(id) DO UPDATE SET sort_order=excluded.sort_order;
      {assert_at(e+2,(r[0]+2,r[1]+2))}
      DELETE FROM public.kg_chart_topics WHERE id='f2d2_temp';
      {assert_at(e+3,(r[0]+3,r[1]+3))}
      ROLLBACK;""")
    expect_versions(e,r)
    assert value("SELECT count(*) FROM public.kg_chart_topics WHERE id='f2d2_temp';")=="0"
    print("F2D2_NINE_SOURCE_ADMIN_DML_NOOP_TRUNCATE_AND_ROLLBACK_PASS")

def cascade(e,r):
    # Translation removal cascades into explicit topic grants (U1 FK).
    # The origin must coordinate with publication, even without a direct
    # grant-table DML privilege. Prove actual cascade and revision in one
    # rolled-back transaction; keep the existing learner's data.
    grants=a["GRANT"].replace('{"language_code":"my","topic_id":"food"}',
        '{"language_code":"my","topic_id":"food"},{"language_code":"my","topic_id":"colours"}')
    key=f"email='{EMAIL}' AND language_code='my' AND topic_id='colours'"
    query("BEGIN;"+ADMIN+publish(r[0],grants)+"RESET ROLE;"+
          assert_at(e,(r[0]+1,r[1]))+f"""DO $check$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM public.kg_chart_access_topics WHERE {key})
        THEN RAISE EXCEPTION 'Expected topic grant before cascade'; END IF;
      END $check$;""" + ADMIN +
      f"DELETE FROM {TTRANS} WHERE topic_id='colours' AND language_code='my';"
      +"RESET ROLE;"+assert_at(e+1,(r[0]+2,r[1]+1))+f"""DO $check$ BEGIN
        IF EXISTS(SELECT 1 FROM public.kg_chart_access_topics WHERE {key})
          OR EXISTS(SELECT 1 FROM {TTRANS} WHERE topic_id='colours' AND language_code='my')
        THEN RAISE EXCEPTION 'Expected translation/grant cascade'; END IF;
      END $check$; ROLLBACK;""")
    expect_versions(e,r)
    assert value(f"SELECT count(*) FROM {TTRANS} WHERE topic_id='colours' AND language_code='my';")=="1"
    assert value(f"SELECT count(*) FROM public.kg_chart_access_topics WHERE {key};")=="0"
    print("F2D2_FK_ORIGIN_TOPIC_GRANT_CASCADE_PASS")

def editor_first(e,r):
    h=w=None
    before=state(r[0])
    try:
        h=start("f2d2_editor",ADMIN+"BEGIN;"+f"UPDATE {FEATURE} SET is_active=false WHERE feature_key='quiz.words';"+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2d2_writer",IDENTITY+"BEGIN ISOLATION LEVEL READ COMMITTED;"+rate(201,r[0],before["version"],5)+"COMMIT;")
        wait_blocked("f2d2_writer","f2d2_editor")
        expect_versions(e,r)
        finish(h,"COMMIT;")
        finish(w,state="40001")
    finally:
        clean(w,h)
    e,r=advance(e,r)
    expect_versions(e,r)
    assert c["receipts"](201)=="0"
    denied(IDENTITY+rate(201,r[0],before["version"],5),"42501")
    denied(OTHER_IDENTITY+f"SELECT public.kg_chart_f2_my_progress_state({r[1]},'rating','my','{WORD}',NULL);","42501")
    query(ADMIN+f"UPDATE {FEATURE} SET is_active=true WHERE feature_key='quiz.words';")
    e,r=advance(e,r)
    expect_versions(e,r)
    assert state(r[0])==dict(before,permission_revision=r[0])
    denied(IDENTITY+rate(201,r[0]-2,before["version"],5),"40001")
    ack(IDENTITY,rate(201,r[0],before["version"],5),201,before["version"]+1,before["version"]+1)
    print("F2D2_FEATURE_REVOCATION_READ_COMMITTED_PASS")
    return e,r

def writer_first(e,r):
    h=w=None
    before=state(r[0],"completion")
    date="2026-03-01T10:00:00Z"
    try:
        h=start("f2d2_writer",IDENTITY+"BEGIN;"+complete(202,r[0],before["version"],date)+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2d2_editor",ADMIN+"BEGIN;"+f"UPDATE {TOPIC} SET is_hidden=true WHERE id='food';"+"COMMIT;")
        wait_blocked("f2d2_editor","f2d2_writer")
        assert c["receipts"](202)=="0"
        finish(h,"COMMIT;")
        finish(w)
    finally:
        clean(w,h)
    e,r=advance(e,r)
    expect_versions(e,r)
    c["saved_completion"](date)
    denied(IDENTITY+complete(202,r[0],before["version"],date),"42501")
    query(ADMIN+f"UPDATE {TOPIC} SET is_hidden=false WHERE id='food';")
    e,r=advance(e,r)
    expect_versions(e,r)
    ack(IDENTITY,complete(202,r[0],before["version"],date),202,before["version"]+1,before["version"]+1,True)
    c["saved_completion"](date)
    print("F2D2_HIDDEN_TOPIC_WRITER_FIRST_HISTORY_PASS")
    return e,r

def media_race(e,r):
    h=w=None
    before=state(r[0])
    assert value(IDENTITY+f"SELECT public.kg_chart_u3b3b2_can_media('{ASSET}');")=="t"
    try:
        h=start("f2d2_editor",ADMIN+"BEGIN;"+f"UPDATE {MEDIA} SET state='disabled' WHERE asset_id='{ASSET}';"+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2d2_writer",IDENTITY+"BEGIN ISOLATION LEVEL REPEATABLE READ;"+
                f"SELECT public.kg_chart_u3b3b2_can_media('{ASSET}');"+
                rate(203,r[0],before["version"],3)+"COMMIT;")
        wait_blocked("f2d2_writer","f2d2_editor")
        finish(h,"COMMIT;")
        finish(w,state="40001")
    finally:
        clean(w,h)
    e,r=advance(e,r)
    expect_versions(e,r)
    assert c["receipts"](203)=="0"
    assert value(IDENTITY+f"SELECT public.kg_chart_u3b3b2_can_media('{ASSET}');")=="f"
    assert state(r[0])==dict(before,permission_revision=r[0])
    # Media removal invalidates the snapshot but not the unrelated rating
    # grant. A fresh explicitly authorized operation can still succeed.
    denied(IDENTITY+rate(203,r[0]-1,before["version"],3),"40001")
    ack(IDENTITY,rate(203,r[0],before["version"],3),203,before["version"]+1,before["version"]+1)
    query(ADMIN+f"UPDATE {MEDIA} SET state='verified' WHERE asset_id='{ASSET}';")
    e,r=advance(e,r)
    expect_versions(e,r)
    assert value(IDENTITY+f"SELECT public.kg_chart_u3b3b2_can_media('{ASSET}');")=="t"
    print("F2D2_MEDIA_REGISTRY_REPEATABLE_READ_INVALIDATION_PASS")
    return e,r

def main():
    assert value("SELECT current_database();")=="kg_u4b2_fixture"
    e,r=epoch(),revisions()
    other_rating=state(r[1],identity=OTHER_IDENTITY)
    other_completion=state(r[1],"completion",identity=OTHER_IDENTITY)
    coverage(e,r)
    cascade(e,r)
    e,r=editor_first(e,r)
    e,r=writer_first(e,r)
    e,r=media_race(e,r)
    assert state(r[1],identity=OTHER_IDENTITY)==dict(other_rating,permission_revision=r[1])
    assert state(r[1],"completion",identity=OTHER_IDENTITY)==dict(other_completion,permission_revision=r[1])
    for n in (102,103,104):
        d["saved_quiz"](n)
    print("F2D2_INDEPENDENT_HISTORY_PRESERVED")
    print("F2D2_FIXTURE_ONLY_PASS: identity lifecycle, other write paths and live API remain NO-GO")

if __name__=="__main__":
    main()
