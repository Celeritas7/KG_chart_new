#!/usr/bin/env python3
"""F2D3D2: disposable pronunciation reservation and service receipt tests."""
import json
import runpy
from pathlib import Path

root=Path(__file__).parent
a=runpy.run_path(str(root/"u4b2-f2a-existing-profile-protocol.py"))
query,value,denied,start,ready,wait_blocked,finish,clean=(
    a[k] for k in ("query","value","denied","start","ready","wait_blocked","finish","clean"))
UID,OTHER,EMAIL,OTHER_EMAIL,IDENTITY,OTHER_IDENTITY,ADMIN,NONE=(
    a[k] for k in ("UID","OTHER","EMAIL","OTHER_EMAIL","IDENTITY","OTHER_IDENTITY","ADMIN","NONE"))
publish,revision=a["publish"],a["revision"]
SERVICE="SET ROLE service_role;"
BEGIN="public.kg_chart_f2_begin_pronunciation"
END="public.kg_chart_f2_finish_pronunciation"
T="kg_u4b2b_test_private.f2d3d2_pronunciation_tickets"
A="public.kg_chart_pronunciation_attempts"
WORD="10000000-0000-4000-8000-000000000001"
SENT="20000000-0000-4000-8000-000000000001"
UNMAPPED="87000000-0000-4000-8000-000000000001"
PRIVATE="10000000-0000-4000-8000-000000000004"
GRANTS=a["GRANT"].replace("ARRAY['quiz.words']","ARRAY['quiz.say','quiz.speak']")
SCORE=dict(score=89,accuracy=92,fluency=86,completeness=95,words=[dict(w="synthetic",accuracy=88,error="None")])

def lit(v):
    return "NULL" if v is None else "'"+str(v).replace("'","''")+"'"

def rid(n):
    return f"99946000-0000-4000-8000-{n:012d}"

def reserve(n,rev,word=WORD,sent=None,source="word",text="my-food",lang="my",digest="a"*64):
    return (f"SELECT {BEGIN}({rev},'{rid(n)}',{lit(lang)},{lit(text)},"
            f"{lit(word)},{lit(sent)},{lit(source)},{lit(digest)});")

def complete(n,rev,result=SCORE,owner=UID,state="saved"):
    data="NULL" if result is None else lit(json.dumps(result))+"::jsonb"
    return f"SELECT {END}('{owner}',{rev},'{rid(n)}',{lit(state)},{data});"

def ack(sql,who=IDENTITY):
    return json.loads(value(who+sql))

def count(n,table=A,key="id"):
    return value(f"SELECT count(*) FROM {table} WHERE {key}='{rid(n)}';")

def absent(n):
    assert count(n)=="0"
    assert count(n,T,"request_id")=="0"

def status(n,expected):
    assert value(f"SELECT state FROM {T} WHERE request_id='{rid(n)}';")==expected

def saved(n,owner=UID):
    assert count(n)=="1"
    assert value(f"SELECT user_id FROM {A} WHERE id='{rid(n)}';")==owner
    status(n,"saved")

def main():
    assert value("SELECT current_database();")=="kg_u4b2_fixture"
    query("INSERT INTO public.kg_chart_settings(key,value) VALUES('pronunciation_daily_limit','3'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value;")
    rev,other=int(revision()),int(revision(OTHER_EMAIL))
    query(ADMIN+publish(rev,GRANTS)+publish(other,GRANTS,OTHER_EMAIL))
    rev+=1; other+=1
    for role in ("anon","authenticated","service_role"):
        assert value(f"SELECT has_table_privilege('{role}','{T}','SELECT,INSERT,UPDATE,DELETE');")=="f"
        assert value(f"SELECT has_table_privilege('{role}','{A}','INSERT,UPDATE,DELETE');")=="f"
    for role in ("anon","authenticated"):
        assert value(f"SELECT has_function_privilege('{role}','{END}(uuid,bigint,uuid,text,jsonb)','EXECUTE');")=="f"
    for role in ("anon","service_role"):
        assert value(f"SELECT has_function_privilege('{role}','{BEGIN}(bigint,uuid,text,text,uuid,uuid,text,text)','EXECUTE');")=="f"
    denied(SERVICE+complete(1,rev),"42501")
    absent(1)
    for args,code in [
        (dict(text="changed"),"42501"),
        (dict(word=PRIVATE),"42501"),
        (dict(word=None,sent=UNMAPPED,source="speak_lines",text="unmapped"),"42501"),
        (dict(word=WORD,sent=SENT),"22023"),
        (dict(digest="not-a-digest"),"22023"),
        (dict(lang="ja"),"42501"),
        (dict(source="forged"),"22023"),
    ]:
        denied(IDENTITY+reserve(1,rev,**args),code)
        absent(1)
    denied(IDENTITY+reserve(1,rev-1),"40001")
    assert ack(reserve(1,rev))["status"]=="start"
    assert ack(reserve(1,rev))["status"]=="pending"
    denied(IDENTITY+reserve(1,rev,digest="b"*64),"23505")
    denied(OTHER_IDENTITY+reserve(1,other),"23505")
    denied(IDENTITY+complete(1,rev),"42501")
    denied(SERVICE+complete(1,other,owner=OTHER),"42501")
    for bad in (dict(SCORE,score=101),dict(SCORE,score=None),dict(SCORE,words=[{"w":"x","accuracy":-1,"error":"None"}]),dict(SCORE,owner=OTHER)):
        denied(SERVICE+complete(1,rev,bad),"22023")
        assert count(1)=="0"
        status(1,"running")
    first=ack(complete(1,rev),SERVICE)
    assert first["status"]=="saved" and first["result"]==SCORE and first["used"]==1
    assert ack(complete(1,rev),SERVICE)==first
    assert ack(reserve(1,rev))==first
    denied(SERVICE+complete(1,rev,dict(SCORE,score=88)),"23505")
    denied(SERVICE+complete(1,rev,None,state="failed"),"23505")
    saved(1)
    assert value(OTHER_IDENTITY+f"SELECT count(*) FROM {A} WHERE id='{rid(1)}';")=="0"
    assert value(IDENTITY+f"SELECT count(*) FROM {A} WHERE id='{rid(1)}';")=="1"
    # Sentence scope and result-less terminal states.
    sr=reserve(2,rev,word=None,sent=SENT,source="speak_lines",text="my-sentence")
    assert ack(sr)["status"]=="start"
    assert ack(complete(2,rev,None,state="no_speech"),SERVICE)["status"]=="no_speech"
    assert ack(sr)["status"]=="no_speech"
    assert count(2)=="0"
    assert ack(reserve(3,rev))["status"]=="start"
    assert ack(complete(3,rev,None,state="failed"),SERVICE)["status"]=="failed"
    assert ack(reserve(3,rev))["status"]=="failed"
    assert count(3)=="0"
    print("F2D3D2_SCOPE_SERVICE_ONLY_RECEIPT_AND_TERMINAL_REPLAY_PASS")

    # Active same-user reservations consume quota atomically; a different
    # learner may reserve independently. Test one remaining slot.
    assert ack(reserve(4,rev))["status"]=="start"
    holder=retry=None
    try:
        holder=start("f2d3d2_holder",IDENTITY+"BEGIN;"+reserve(5,rev)+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        retry=start("f2d3d2_quota",IDENTITY+"BEGIN;"+reserve(6,rev)+"COMMIT;")
        wait_blocked("f2d3d2_quota","f2d3d2_holder")
        assert ack(reserve(7,other),OTHER_IDENTITY)["status"]=="start"
        finish(holder,"COMMIT;"); finish(retry)
    finally:
        clean(retry,holder)
    absent(6)
    assert ack(reserve(6,rev))["status"]=="limit"
    assert ack(reserve(5,rev))["status"]=="pending"
    # Expire without resurrecting the provider operation for that same ID.
    query(f"UPDATE {T} SET expires_at=clock_timestamp()-interval '1 second' WHERE request_id='{rid(5)}';")
    assert ack(reserve(5,rev))["status"]=="expired"
    denied(SERVICE+complete(5,rev),"22023")
    assert ack(reserve(6,rev))["status"]=="start"
    query(SERVICE+"BEGIN;"+complete(6,rev)+"ROLLBACK;")
    assert count(6)=="0"; status(6,"running")
    assert ack(complete(6,rev),SERVICE)["status"]=="saved"
    saved(6)
    assert ack(complete(7,other,owner=OTHER),SERVICE)["status"]=="saved"
    saved(7,OTHER)
    print("F2D3D2_CONCURRENT_QUOTA_EXPIRY_ROLLBACK_AND_INDEPENDENCE_PASS")

    # Provider call takes place between reserve and complete. Admin's
    # revocation locks the profile before a delayed service finalization.
    holder=retry=None
    try:
        holder=start("f2d3d2_revoker",ADMIN+"BEGIN;"+publish(rev,NONE)+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        retry=start("f2d3d2_finish",SERVICE+"BEGIN;"+complete(4,rev)+"COMMIT;")
        wait_blocked("f2d3d2_finish","f2d3d2_revoker")
        finish(holder,"COMMIT;"); finish(retry,state="40001")
    finally:
        clean(retry,holder)
    rev+=1
    assert count(4)=="0"; status(4,"running")
    denied(SERVICE+complete(4,rev),"40001")
    denied(IDENTITY+reserve(1,rev),"42501")
    saved(1); saved(6); saved(7,OTHER)
    query(ADMIN+publish(rev,GRANTS)); rev+=1
    denied(IDENTITY+reserve(4,rev),"40001")
    denied(SERVICE+complete(4,rev),"40001")
    # New quota change is a coordinated source edit, not a stale success.
    query("UPDATE public.kg_chart_settings SET value='5'::jsonb WHERE key='pronunciation_daily_limit';")
    rev+=1; other+=1
    assert int(revision())==rev and int(revision(OTHER_EMAIL))==other
    assert ack(reserve(8,rev))["status"]=="start"
    query("UPDATE public.kg_chart_settings SET value='4'::jsonb WHERE key='pronunciation_daily_limit';")
    rev+=1; other+=1
    denied(SERVICE+complete(8,rev-1),"40001")
    assert count(8)=="0"
    denied(SERVICE+complete(8,rev),"40001")
    # The finalizer also rechecks the current allowlist identity even
    # though full removal/regrant lifecycle is not yet coordinated by F3.
    assert ack(reserve(9,other),OTHER_IDENTITY)["status"]=="start"
    query(f"UPDATE auth.users SET email_confirmed_at=NULL WHERE id='{OTHER}';")
    denied(SERVICE+complete(9,other,owner=OTHER),"42501")
    assert count(9)=="0"
    query(f"UPDATE auth.users SET email_confirmed_at=now() WHERE id='{OTHER}';")
    print("F2D3D2_LATE_REVOKE_REGRANT_LIMIT_CHANGE_IDENTITY_AND_HISTORY_PASS")
    print("F2D3D2_FIXTURE_ONLY_PASS: no live Edge or Azure calls")

if __name__=="__main__":
    main()
