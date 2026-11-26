#!/usr/bin/env python3
"""F2D1: deterministic authorization-source races in disposable CI only."""
import json
import runpy
from pathlib import Path

root=Path(__file__).parent
a=runpy.run_path(str(root/"u4b2-f2a-existing-profile-protocol.py"))
b=runpy.run_path(str(root/"u4b2-f2b-atomic-quiz.py"))
c=runpy.run_path(str(root/"u4b2-f2c-versioned-progress.py"))
query,value,denied,start,ready,wait_blocked,finish,clean=(
    a[k] for k in ("query","value","denied","start","ready","wait_blocked","finish","clean"))
UID,OTHER,EMAIL,OTHER_EMAIL,IDENTITY,OTHER_IDENTITY,ADMIN=(
    a[k] for k in ("UID","OTHER","EMAIL","OTHER_EMAIL","IDENTITY","OTHER_IDENTITY","ADMIN"))
publish,revision=a["publish"],a["revision"]
GRANTS=c["GRANTS"]
rate,state,ack=c["rate"],c["state"],c["ack"]
G="kg_u4b2b_test_private.f2d_authorization_gate"
S="public.kg_chart_settings"
M="public.kg_chart_sentence_group_topic_map"
SCOPE="language_code='my' AND group_name='food'"
RULE=f"""UPDATE {S} SET value=value||jsonb_build_array(
    jsonb_build_object('topic_id','food','language_code','my','emails',jsonb_build_array('{OTHER_EMAIL}')))
    WHERE key='private_lessons';"""
DISABLE=f"UPDATE {M} SET review_status='disabled' WHERE {SCOPE};"
ENABLE=f"UPDATE {M} SET review_status='verified' WHERE {SCOPE};"

def epoch():
    return int(value(f"SELECT epoch FROM {G} WHERE singleton;"))

def revisions():
    return (int(revision()),int(revision(OTHER_EMAIL)))

def expect_versions(e,r):
    assert epoch()==e,(epoch(),e)
    assert revisions()==r,(revisions(),r)

def advance(e,r):
    return e+1,(r[0]+1,r[1]+1)

def rules():
    return value(f"SELECT value::text FROM {S} WHERE key='private_lessons';")

def restore(original):
    return f"UPDATE {S} SET value='{original.replace(chr(39),chr(39)*2)}'::jsonb WHERE key='private_lessons';"

def quiz(n,rev):
    items=[b["answer"](n,word=None,sentence=b["SENTENCE"])]
    return b["quiz"](n,rev,items,mode="sentence_to_meaning",topic=None)

def absent_quiz(n):
    b["count"](b["sid"](n),0,0)

def saved_quiz(n):
    b["exact"](b["sid"](n),[b["answer"](n,word=None,sentence=b["SENTENCE"])])

def baseline(e,r,original):
    # Unrelated/no-op edits do not change the authorization epoch or revisions.
    query(ADMIN+f"""UPDATE {S} SET value=value WHERE key='private_lessons';
      UPDATE {M} SET review_status=review_status WHERE {SCOPE};
      UPDATE {S} SET value='true'::jsonb WHERE key='admin_bypass_lock';""")
    expect_versions(e,r)
    # Unauthorized source edits: no rows affected, no revocation bypass.
    query(IDENTITY+RULE+DISABLE)
    expect_versions(e,r)
    assert rules()==original
    assert value(f"SELECT review_status FROM {M} WHERE {SCOPE};")=="verified"
    denied(IDENTITY+f"INSERT INTO {S}(key,value) VALUES('f2d_forbidden','[]');","42501")
    denied(f"TRUNCATE {S};","42501")
    denied(f"TRUNCATE {M};","42501")
    for role in ("anon","authenticated","service_role"):
        for privilege in ("SELECT","INSERT","UPDATE","DELETE","TRUNCATE"):
            assert value(f"SELECT has_table_privilege('{role}','{G}','{privilege}');")=="f"
    # Insert, delete, rename and upsert paths increment and roll back.
    # All checks are inside one isolated transaction; compare committed state
    # only after rollback. PostgreSQL runs the same hooks for owner maintenance.
    query(f"""BEGIN;
      UPDATE {S} SET key='f2d_tmp_private' WHERE key='private_lessons';
      INSERT INTO {S}(key,value) VALUES('private_lessons','[]');
      INSERT INTO {S}(key,value) VALUES('private_lessons','[{{"topic_id":"food","emails":[]}}]')
        ON CONFLICT(key) DO UPDATE SET value=excluded.value;
      DELETE FROM {S} WHERE key='private_lessons';
      UPDATE {S} SET key='private_lessons' WHERE key='f2d_tmp_private';
      DO $$ BEGIN
        IF (SELECT epoch FROM {G}) <> {e+5} THEN
          RAISE EXCEPTION 'private DML path did not publish exactly once';
        END IF;
      END $$;
      DELETE FROM {M} WHERE {SCOPE};
      INSERT INTO {M}(language_code,group_name,topic_id,review_status)
        VALUES('my','food','food','disabled');
      DO $$ BEGIN
        IF (SELECT epoch FROM {G}) <> {e+7} THEN
          RAISE EXCEPTION 'mapping DML path did not publish';
        END IF;
      END $$;
      ROLLBACK;""")
    expect_versions(e,r)
    assert rules()==original
    assert value(f"SELECT review_status FROM {M} WHERE {SCOPE};")=="verified"
    print("F2D1_DIRECT_DML_NOOP_UNRELATED_AND_ROLLBACK_PASS")

def private_revoke_first(e,r,original):
    h=w=None
    before=state(r[0])
    try:
        h=start("f2d_editor",ADMIN+"BEGIN;"+RULE+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2d_writer",IDENTITY+"BEGIN ISOLATION LEVEL READ COMMITTED;"+
            rate(101,r[0],before["version"],4)+"COMMIT;")
        wait_blocked("f2d_writer","f2d_editor")
        expect_versions(e,r)
        finish(h,"COMMIT;")
        finish(w,state="40001")
    finally:
        clean(w,h)
    e,r=advance(e,r)
    expect_versions(e,r)
    assert c["receipts"](101)=="0"
    denied(IDENTITY+rate(101,r[0],before["version"],4),"42501")
    # Other learner's access remains valid with the newly issued revision.
    assert state(r[1],identity=OTHER_IDENTITY)["state"]["rating"]==1
    query(ADMIN+restore(original))
    e,r=advance(e,r)
    expect_versions(e,r)
    assert state(r[0])["version"]==before["version"]
    denied(IDENTITY+rate(101,r[0]-2,before["version"],4),"40001")
    ack(IDENTITY,rate(101,r[0],before["version"],4),101,before["version"]+1,before["version"]+1)
    print("F2D1_PRIVATE_RULE_READ_COMMITTED_REVOKER_FIRST_PASS")
    return e,r

def mapping_writer_first(e,r):
    h=w=None
    try:
        h=start("f2d_writer",IDENTITY+"BEGIN;"+quiz(102,r[0])+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2d_editor",ADMIN+"BEGIN;"+DISABLE+"COMMIT;")
        wait_blocked("f2d_editor","f2d_writer")
        absent_quiz(102)
        finish(h,"COMMIT;")
        finish(w)
    finally:
        clean(w,h)
    e,r=advance(e,r)
    expect_versions(e,r)
    saved_quiz(102)
    denied(IDENTITY+quiz(102,r[0]),"42501")  # old receipt cannot bypass denial
    denied(IDENTITY+quiz(103,r[0]-1),"40001")
    denied(IDENTITY+quiz(103,r[0]),"42501")
    absent_quiz(103)
    query(ADMIN+ENABLE)
    e,r=advance(e,r)
    expect_versions(e,r)
    query(IDENTITY+quiz(103,r[0]))
    saved_quiz(103)
    print("F2D1_MAPPING_WRITER_FIRST_HISTORY_AND_REGRANT_PASS")
    return e,r

def mapping_repeatable_read(e,r):
    h=w=None
    try:
        h=start("f2d_editor",ADMIN+"BEGIN;"+DISABLE+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2d_writer",IDENTITY+"BEGIN ISOLATION LEVEL REPEATABLE READ;"+
            "SELECT public.kg_chart_u3c2_can_sentence_group('my','food');"+
            quiz(104,r[0])+"COMMIT;")
        wait_blocked("f2d_writer","f2d_editor")
        finish(h,"COMMIT;")
        finish(w,state="40001")
    finally:
        clean(w,h)
    e,r=advance(e,r)
    expect_versions(e,r)
    absent_quiz(104)
    denied(IDENTITY+quiz(104,r[0]),"42501")
    query(ADMIN+ENABLE)
    e,r=advance(e,r)
    expect_versions(e,r)
    query(IDENTITY+quiz(104,r[0]))
    saved_quiz(104)
    print("F2D1_MAPPING_REPEATABLE_READ_REVOKER_FIRST_PASS")
    return e,r

def grant_edit_race(e,r,original):
    h=w=None
    try:
        h=start("f2d_editor",ADMIN+"BEGIN;"+RULE+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2d_grant",ADMIN+"BEGIN;"+publish(r[0],GRANTS)+"COMMIT;")
        wait_blocked("f2d_grant","f2d_editor")
        finish(h,"COMMIT;")
        finish(w,state="40001")
    finally:
        clean(w,h)
    e,r=advance(e,r)
    expect_versions(e,r)
    query(ADMIN+restore(original))
    e,r=advance(e,r)
    expect_versions(e,r)
    query(ADMIN+publish(r[0],GRANTS))
    r=(r[0]+1,r[1])
    expect_versions(e,r)
    print("F2D1_GRANT_PUBLICATION_LOCK_ORDER_PASS")
    return e,r

def main():
    assert value("SELECT current_database();")=="kg_u4b2_fixture"
    e,r=epoch(),revisions()
    original=rules()
    before_completion=state(r[0],"completion")
    baseline(e,r,original)
    e,r=private_revoke_first(e,r,original)
    e,r=mapping_writer_first(e,r)
    e,r=mapping_repeatable_read(e,r)
    e,r=grant_edit_race(e,r,original)
    assert rules()==original
    assert value(f"SELECT review_status FROM {M} WHERE {SCOPE};")=="verified"
    assert state(r[0],"completion")["state"]==before_completion["state"]
    assert state(r[0],"completion")["version"]==before_completion["version"]
    assert state(r[1],identity=OTHER_IDENTITY)["state"]["rating"]==1
    for n in (102,103,104):
        saved_quiz(n)
    print("F2D1_FIXTURE_ONLY_PASS: other authorization sources and production remain NO-GO")

if __name__=="__main__":
    main()
