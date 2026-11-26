#!/usr/bin/env python3
"""F2C: versioned progress + idempotent event receipts in disposable CI only."""
import json
import runpy
from pathlib import Path

a = runpy.run_path(str(Path(__file__).with_name("u4b2-f2a-existing-profile-protocol.py")))
query, value, denied, start, ready, wait_blocked, finish, clean = (
    a[k] for k in ("query","value","denied","start","ready","wait_blocked","finish","clean"))
UID, OTHER, EMAIL, OTHER_EMAIL, IDENTITY, OTHER_IDENTITY, ADMIN, NONE = (
    a[k] for k in ("UID","OTHER","EMAIL","OTHER_EMAIL","IDENTITY","OTHER_IDENTITY","ADMIN","NONE"))
publish, revision = a["publish"], a["revision"]
GRANTS = a["GRANT"].replace("ARRAY['quiz.words']", "ARRAY['quiz.words','quiz.sentences']")
WORD = "10000000-0000-4000-8000-000000000001"
OTHER_WORD = "10000000-0000-4000-8000-000000000003"
R = "public.kg_chart_user_ratings"
C = "public.kg_chart_topic_completions"
V = "kg_u4b2b_test_private.f2c_versions"
E = "kg_u4b2b_test_private.f2c_receipts"
D1 = "2026-02-01T10:00:00+00:00"
D2 = "2026-02-02T10:00:00+00:00"
D3 = "2026-02-03T10:00:00+00:00"
D4 = "2026-02-04T10:00:00+00:00"

def eid(n):
    return f"99900000-0000-4000-8000-{n:012d}"

def literal(v):
    return "NULL" if v is None else "'" + str(v).replace("'","''") + "'"

def op(n,rev,ver,kind,word=None,topic=None,rating=None,reviewed=None,updated=None,completed=None,lang="my"):
    args = [str(rev),literal(eid(n)),str(ver),literal(kind),literal(lang),literal(word),
            literal(topic),"NULL" if rating is None else str(rating),literal(reviewed),literal(updated),literal(completed)]
    return "SELECT public.kg_chart_f2_save_progress(" + ",".join(args) + ");"

def rate(n,rev,ver,rating,date=D1,word=WORD):
    return op(n,rev,ver,"rating_upsert",word=word,rating=rating,reviewed=date,updated=date)

def remove(n,rev,ver):
    return op(n,rev,ver,"rating_delete",word=WORD)

def complete(n,rev,ver,date=D1,topic="food"):
    return op(n,rev,ver,"completion_upsert",topic=topic,completed=date)

def state(rev,kind="rating",identity=IDENTITY,word=WORD,topic="food"):
    vocab = literal(word) if kind=="rating" else "NULL"
    t = "NULL" if kind=="rating" else literal(topic)
    return json.loads(value(identity+f"SELECT public.kg_chart_f2_my_progress_state({rev},'{kind}','my',{vocab},{t});"))

def ack(identity,sql,n,event_version,current_version,replayed=False):
    result = json.loads(value(identity+sql))
    assert result == dict(event_id=eid(n),event_version=event_version,
                          current_version=current_version,replayed=replayed),result

def key(owner=UID):
    return f"user_id='{owner}' AND vocabulary_id='{WORD}' AND language_code='my'"

def ckey(owner=UID):
    return f"user_id='{owner}' AND topic_id='food' AND language_code='my'"

def saved_rating(expected,owner=UID,date=None):
    assert value(f"SELECT rating FROM {R} WHERE {key(owner)};") == str(expected)
    if date:
        assert value(f"SELECT count(*) FROM {R} WHERE {key(owner)} AND updated_at='{date}'::timestamptz AND last_reviewed_at='{date}'::timestamptz;") == "1"

def saved_completion(date,owner=UID):
    assert value(f"SELECT count(*) FROM {C} WHERE {ckey(owner)} AND completed_at='{date}'::timestamptz;") == "1"

def receipts(n,owner=UID):
    return value(f"SELECT count(*) FROM {E} WHERE owner_id='{owner}' AND event_id='{eid(n)}';")

def expect_unrecorded(n):
    assert receipts(n)=="0"

def test_behavior(rev,other_rev):
    assert state(rev)["version"]==0 and state(rev)["state"]["rating"]==5
    assert state(rev,"completion")["version"]==0
    # Missing revision/baseline, denied content, bad shapes: no receipt.
    denied(IDENTITY+rate(1,"NULL",0,4),"40001")
    denied(IDENTITY+rate(1,rev,"NULL",4),"22023")
    denied(IDENTITY+rate(1,rev,0,4,word=OTHER_WORD),"42501")
    denied(IDENTITY+complete(1,rev,0,topic="friends_names"),"42501")
    denied(IDENTITY+rate(1,rev,0,6),"22023")
    expect_unrecorded(1)
    ack(IDENTITY,rate(1,rev,0,4),1,1,1)
    saved_rating(4,date=D1)
    ack(IDENTITY,rate(1,rev,0,4,"2026-02-01T19:00:00+09:00"),1,1,1,True)
    ack(IDENTITY,rate(2,rev,1,2,D2),2,2,2)
    ack(IDENTITY,rate(1,rev,0,4),1,1,2,True)
    saved_rating(2,date=D2)
    denied(IDENTITY+rate(1,rev,0,3),"23505")
    denied(IDENTITY+rate(3,rev,1,5,D3),"40001")
    expect_unrecorded(3)
    ack(IDENTITY,remove(4,rev,2),4,3,3)
    assert state(rev)==dict(version=3,state=None,permission_revision=rev)
    ack(IDENTITY,rate(2,rev,1,2,D2),2,2,3,True)
    assert value(f"SELECT count(*) FROM {R} WHERE {key()};")=="0"
    denied(IDENTITY+rate(5,rev,0,4),"40001")
    ack(IDENTITY,rate(5,rev,3,5,D3),5,4,4)
    ack(IDENTITY,remove(4,rev,2),4,3,4,True)
    saved_rating(5,date=D3)
    # Same event UUID is independent for a different authenticated owner.
    ack(OTHER_IDENTITY,rate(1,other_rev,0,1,D4),1,1,1)
    saved_rating(1,OTHER,D4)
    saved_rating(5,date=D3)
    ack(IDENTITY,complete(10,rev,0,D1),10,1,1)
    ack(IDENTITY,complete(11,rev,1,D2),11,2,2)
    ack(IDENTITY,complete(10,rev,0,D1),10,1,2,True)
    saved_completion(D2)
    denied(IDENTITY+complete(12,rev,1,D3),"40001")
    denied(IDENTITY+complete(10,rev,0,D3),"23505")
    denied(IDENTITY+complete(1,rev,2,D3),"23505")
    expect_unrecorded(12)
    print("F2C_RATING_COMPLETION_REPLAY_BASELINE_AND_TOMBSTONE_PASS")

def test_bypass(rev):
    denied(IDENTITY+f"""INSERT INTO {R}(user_id,vocabulary_id,language_code,rating)
      VALUES(auth.uid(),'{WORD}','my',1) ON CONFLICT(user_id,vocabulary_id,language_code)
      DO UPDATE SET rating=excluded.rating;""","42501")
    denied(IDENTITY+f"""INSERT INTO {C}(user_id,language_code,topic_id,completed_at)
      VALUES(auth.uid(),'my','food','{D4}') ON CONFLICT(user_id,language_code,topic_id)
      DO UPDATE SET completed_at=excluded.completed_at;""","42501")
    query(IDENTITY+f"""UPDATE {R} SET rating=1 WHERE {key()};
      DELETE FROM {R} WHERE {key()};
      UPDATE {C} SET completed_at='{D4}' WHERE {ckey()};
      DELETE FROM {C} WHERE {ckey()};
      UPDATE {R} SET rating=5 WHERE {key(OTHER)};
      DELETE FROM {C} WHERE {ckey(OTHER)};""")
    saved_rating(5,date=D3)
    saved_completion(D2)
    saved_rating(1,OTHER,D4)
    for role in ("anon","authenticated","service_role"):
        for table in (E,V):
            for privilege in ("SELECT","INSERT","UPDATE","DELETE","TRUNCATE"):
                assert value(f"SELECT has_table_privilege('{role}','{table}','{privilege}');")=="f"
    denied(IDENTITY+f"SELECT * FROM {E};","42501")
    denied("SET ROLE anon;"+rate(13,rev,4,1),"42501")
    denied("SET ROLE service_role;"+rate(13,rev,4,1),"42501")
    # Legacy access unchanged in an explicitly rolled-back fixture transaction.
    query(f"""BEGIN;
      UPDATE public.kg_chart_access_profiles SET mode='legacy' WHERE email='{EMAIL}';
      {IDENTITY}
      UPDATE {R} SET rating=1 WHERE {key()};
      UPDATE {C} SET completed_at='{D4}' WHERE {ckey()};
      DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM {R} WHERE {key()} AND rating=1)
          OR NOT EXISTS(SELECT 1 FROM {C} WHERE {ckey()} AND completed_at='{D4}'::timestamptz)
        THEN RAISE EXCEPTION 'legacy path failed'; END IF;
      END $$;
      DELETE FROM {R} WHERE {key()};
      ROLLBACK;""")
    saved_rating(5,date=D3)
    saved_completion(D2)
    # A progress transaction rollback also rolls back its receipt/version.
    query(IDENTITY+"BEGIN;"+rate(14,rev,4,2,D4)+complete(15,rev,2,D4)+"ROLLBACK;")
    saved_rating(5,date=D3)
    saved_completion(D2)
    assert state(rev)["version"]==4 and state(rev,"completion")["version"]==2
    expect_unrecorded(14)
    expect_unrecorded(15)
    print("F2C_DIRECT_BYPASS_LEGACY_AND_ROLLBACK_PASS")

def test_concurrent(rev):
    h=w=None
    try:
        h=start("f2c_writer",IDENTITY+"BEGIN;"+rate(20,rev,4,3,D4)+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2c_retry",IDENTITY+"BEGIN;"+rate(20,rev,4,3,D4)+"COMMIT;")
        wait_blocked("f2c_retry","f2c_writer")
        saved_rating(5,date=D3)
        expect_unrecorded(20)
        finish(h,"COMMIT;")
        finish(w)
        saved_rating(3,date=D4)
        assert state(rev)["version"]==5 and receipts(20)=="1"
    finally:
        clean(w,h)
    print("F2C_CONCURRENT_EXACT_RETRY_PASS")

def revoke_first(rev,other_rev,isolation,operation,n):
    h=w=None
    try:
        h=start("f2c_revoker",ADMIN+"BEGIN;"+publish(rev,NONE)+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2c_writer",IDENTITY+f"BEGIN ISOLATION LEVEL {isolation};"+
                "SELECT public.kg_chart_u3b1_can_topic('my','food');"+operation+"COMMIT;")
        wait_blocked("f2c_writer","f2c_revoker")
        # Other owner's progress state remains readable while this profile is locked.
        assert state(other_rev,identity=OTHER_IDENTITY)["version"]==1
        finish(h,"COMMIT;")
        finish(w,state="40001")
        expect_unrecorded(n)
        saved_rating(3,date=D4)
        saved_completion(D2)
        denied(IDENTITY+rate(20,rev+1,4,3,D4),"42501")
        denied(IDENTITY+complete(30,rev+1,2,D3),"42501")
        query(ADMIN+publish(rev+1,GRANTS))
        denied(IDENTITY+operation,"40001")
        return rev+2
    finally:
        clean(w,h)

def writer_first(rev):
    h=w=None
    try:
        h=start("f2c_writer",IDENTITY+"BEGIN;"+complete(40,rev,2,D3)+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2c_revoker",ADMIN+"BEGIN;"+publish(rev,NONE)+"COMMIT;")
        wait_blocked("f2c_revoker","f2c_writer")
        saved_completion(D2)
        finish(h,"COMMIT;")
        finish(w)
        saved_completion(D3)
        assert receipts(40)=="1"
        denied(IDENTITY+complete(40,rev+1,2,D3),"42501")
        query(ADMIN+publish(rev+1,GRANTS))
        ack(IDENTITY,complete(40,rev+2,2,D3),40,3,3,True)
        return rev+2
    finally:
        clean(w,h)

def main():
    assert value("SELECT current_database();")=="kg_u4b2_fixture"
    rev,other_rev=int(revision()),int(revision(OTHER_EMAIL))
    history_rating=value(f"SELECT to_jsonb(r)::text FROM {R} r WHERE user_id='{OTHER}' AND language_code='ja';")
    history_completion=value(f"SELECT to_jsonb(c)::text FROM {C} c WHERE user_id='{OTHER}' AND language_code='ja';")
    test_behavior(rev,other_rev)
    test_bypass(rev)
    test_concurrent(rev)
    rev=revoke_first(rev,other_rev,"READ COMMITTED",complete(30,rev,2,D3),30)
    rev=revoke_first(rev,other_rev,"REPEATABLE READ",remove(31,rev,5),31)
    rev=writer_first(rev)
    ack(IDENTITY,remove(31,rev,5),31,6,6)
    assert state(rev)["state"] is None
    assert value(f"SELECT to_jsonb(r)::text FROM {R} r WHERE user_id='{OTHER}' AND language_code='ja';")==history_rating
    assert value(f"SELECT to_jsonb(c)::text FROM {C} c WHERE user_id='{OTHER}' AND language_code='ja';")==history_completion
    saved_rating(1,OTHER,D4)
    saved_completion(D3)
    print("F2C_REVOCATION_BOTH_ORDERS_REPEATABLE_READ_AND_HISTORY_PASS")
    print("F2C_FIXTURE_ONLY_PASS: production remains NO-GO")

if __name__=="__main__":
    main()
