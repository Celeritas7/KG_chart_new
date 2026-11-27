#!/usr/bin/env python3
"""F2D3D3: preference scope, exact receipts, merge and concurrency."""
import copy
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
P="public.kg_chart_user_prefs"
V="kg_u4b2b_test_private.f2d3d3_pref_versions"
R="kg_u4b2b_test_private.f2d3d3_pref_receipts"
READ="public.kg_chart_f2_my_preferences"
WRITE="public.kg_chart_f2_patch_preferences"
FOOD="my|copy|words|food"
ALL="my|recall|words"
COLOUR="my|recall|words|colours"
PRIVATE="my|copy|words|friends_names"
JA="ja|copy|words|food"
SENTENCE="my|copy|sentences"
TOPICS=json.dumps([{"language_code":"my","topic_id":t} for t in ("food","colours","friends_names")])
GRANTS=f"ARRAY['my'],'{TOPICS}'::jsonb,ARRAY['quiz.words','quiz.typing']"
NO_TYPING=GRANTS.replace("ARRAY['quiz.words','quiz.typing']","ARRAY['quiz.words']")
def lit(v):
    return "'" + str(v).replace("'","''") + "'"
def event(n):
    return f"99947000-0000-4000-8000-{n:012d}"
def best(cpm,last,day=1):
    return dict(cpm=cpm,last=last,at=f"2026-01-{day:02d}T10:00:00.000Z")
def typing(key,v):
    return {"typing_best":{key:v}}
def call(rev,n,ver,patch,owner=UID):
    return f"SELECT {WRITE}({rev},'{owner}','{event(n)}',{ver},{lit(json.dumps(patch,ensure_ascii=False))}::jsonb);"
def read_call(rev,owner=UID):
    return f"SELECT {READ}({rev},'{owner}');"
def ack(sql,who=IDENTITY):
    return json.loads(value(who+sql))
def state(rev,who=IDENTITY,owner=UID):
    s=ack(read_call(rev,owner),who)
    assert s["owner_id"]==owner and s["permission_revision"]==rev,s
    return s
def expect_ack(n,rev,ver,current=None,replayed=False,owner=UID):
    return dict(owner_id=owner,event_id=event(n),event_version=ver,
        current_version=ver if current is None else current,permission_revision=rev,replayed=replayed)
def raw(owner=UID):
    return json.loads(value(f"SELECT to_jsonb(p) FROM {P} p WHERE user_id='{owner}';"))
def absent_event(n):
    assert value(f"SELECT count(*) FROM {R} WHERE event_id='{event(n)}';")=="0"
def save(rev,n,ver,patch,who=IDENTITY,owner=UID):
    result=ack(call(rev,n,ver,patch,owner),who)
    assert result==expect_ack(n,rev,ver+1,owner=owner),result
    return result

def main():
    assert value("SELECT current_database();")=="kg_u4b2_fixture"
    # Invented pre-candidate rows, including old out-of-scope and malformed
    # values. No guessed owner assignment and no historical normalization.
    original={FOOD:best(90,90,2),PRIVATE:best(55,55),JA:best(88,88),
        SENTENCE:best(30,30),COLOUR:{"cpm":"old unknown value"}}
    other_orig={FOOD:best(210,200)}
    query(f"""INSERT INTO {P}(user_id,audio_voice,audio_muted,typing_best) VALUES
      ('{UID}','f',false,{lit(json.dumps(original))}::jsonb),
      ('{OTHER}','m',true,{lit(json.dumps(other_orig))}::jsonb);""")
    rev,other=int(revision()),int(revision(OTHER_EMAIL))
    query(ADMIN+publish(rev,GRANTS)+publish(other,GRANTS,OTHER_EMAIL))
    rev+=1; other+=1
    s=state(rev)
    assert (s["version"],s["audio_voice"],s["audio_muted"],s["typing_best"])==(0,"f",False,{FOOD:original[FOOD]}),s
    assert state(other,OTHER_IDENTITY,OTHER)["typing_best"]==other_orig
    denied(IDENTITY+read_call(rev,OTHER),"42501")
    denied(IDENTITY+read_call(rev-1),"40001")
    for role in ("anon","service_role"):
        for sig in (f"{READ}(bigint,uuid)",f"{WRITE}(bigint,uuid,uuid,bigint,jsonb)"):
            assert value(f"SELECT has_function_privilege('{role}','{sig}','EXECUTE');")=="f"
    for role in ("anon","authenticated","service_role"):
        for table in (V,R):
            assert value(f"SELECT has_table_privilege('{role}','{table}','SELECT,INSERT,UPDATE,DELETE');")=="f"
    # Deliberately permissive policies cannot bypass restrictive own/legacy
    # checks. Test denied direct reads, inserts and silent zero-row updates.
    query(f"""CREATE POLICY synthetic_bad_pref_select ON {P} FOR SELECT TO authenticated USING(true);
      CREATE POLICY synthetic_bad_pref_insert ON {P} FOR INSERT TO authenticated WITH CHECK(true);
      CREATE POLICY synthetic_bad_pref_update ON {P} FOR UPDATE TO authenticated USING(true) WITH CHECK(true);""")
    assert value(IDENTITY+f"SELECT count(*) FROM {P};")=="0"
    denied(IDENTITY+f"INSERT INTO {P}(user_id,audio_voice) VALUES('{UID}','m') ON CONFLICT DO NOTHING;","42501")
    before=raw()
    query(IDENTITY+f"UPDATE {P} SET audio_muted=true,typing_best='{{}}'::jsonb;")
    assert raw()==before
    denied(IDENTITY+call(rev,90,0,{"audio_muted":True},OTHER),"42501")
    absent_event(90)
    print("F2D3D3_OWNER_SCOPE_RAW_BYPASS_AND_HISTORY_PASS")

    # Separate audio fields and typing values survive patches. Old replay
    # acknowledges its own event but never turns back more recent choices.
    save(rev,1,0,{"audio_voice":"m"})
    save(rev,2,1,{"audio_muted":True})
    assert ack(call(rev,1,0,{"audio_voice":"m"}))==expect_ack(1,rev,1,2,True)
    save(rev,3,2,typing(FOOD,best(70,70,3)))
    assert state(rev)["typing_best"][FOOD]==best(90,70,3)
    save(rev,4,3,typing(FOOD,best(120,120,1)))
    assert state(rev)["typing_best"][FOOD]==best(120,70,3)
    save(rev,5,4,typing(ALL,best(42,42,4)))
    s=state(rev)
    assert (s["version"],s["audio_voice"],s["audio_muted"])==(5,"m",True)
    assert s["typing_best"]=={FOOD:best(120,70,3),ALL:best(42,42,4)}
    for key in (PRIVATE,JA,SENTENCE,COLOUR):
        assert raw()["typing_best"][key]==original[key]
    denied(IDENTITY+call(rev,6,4,{"audio_muted":False}),"40001")
    denied(IDENTITY+call(rev,1,0,{"audio_voice":"f"}),"23505")
    denied(OTHER_IDENTITY+call(other,1,0,{"audio_voice":"m"},OTHER),"23505")
    # Every failure, including a combined valid audio + bad typing key,
    # leaves all values, version and receipts unchanged.
    before=raw()
    cases=[
      ({"audio_voice":"x"},"22023"),({"audio_muted":"false"},"22023"),
      ({"audio_voice":None},"22023"),({"user_id":OTHER},"22023"),
      ({"updated_at":"2026-01-01"},"22023"),({},"22023"),
      ({"typing_best":{}},"22023"),({"typing_best":[]},"22023"),
      (typing(JA,best(12,12)),"42501"),(typing(PRIVATE,best(12,12)),"42501"),
      (typing(SENTENCE,best(12,12)),"42501"),
      (typing("my|copy|words|all",best(12,12)),"42501"),
      (typing("my|copy|words|missing",best(12,12)),"42501"),
      (typing(ALL,best(-1,0)),"22023"),(typing(ALL,best(10,11)),"22023"),
      (typing(ALL,dict(best(10,10),at="tomorrow")),"22023"),
      (typing(ALL,dict(best(10,10),at="9999-01-01T00:00:00Z")),"22023"),
      (typing(ALL,dict(best(10,10),at="2026-02-31T10:00:00Z")),"22023"),
      (typing(FOOD,best(120,80,3)),"23505"),
      (typing(COLOUR,best(100,100)),"22023"),
      ({"audio_muted":False,"typing_best":{FOOD:best(150,150),PRIVATE:best(20,20)}},"42501"),
    ]
    for patch,code in cases:
        denied(IDENTITY+call(rev,6,5,patch),code)
        assert raw()==before
        absent_event(6)
    assert state(rev)["version"]==5
    query(IDENTITY+"BEGIN;"+call(rev,7,5,{"audio_muted":False})+"ROLLBACK;")
    assert raw()==before
    absent_event(7)
    print("F2D3D3_PATCH_MERGE_RECENCY_INVALID_AND_ROLLBACK_PASS")

    # Overlapping independent patches at one baseline cannot clobber each
    # other. The second must be reconciled; other owners do not block.
    holder=retry=None
    try:
        holder=start("f2d3d3_holder",IDENTITY+"BEGIN;"+call(rev,10,5,{"audio_voice":"f"})+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        retry=start("f2d3d3_conflict",IDENTITY+"BEGIN;"+call(rev,11,5,typing(ALL,best(50,50,5)))+"COMMIT;")
        wait_blocked("f2d3d3_conflict","f2d3d3_holder")
        save(other,12,0,{"audio_muted":False},OTHER_IDENTITY,OTHER)
        finish(holder,"COMMIT;"); finish(retry,state="40001")
    finally:
        clean(retry,holder)
    absent_event(11)
    assert state(rev)["version"]==6
    # Explicit new event after reread, not automatic rebasing of an old queue.
    save(rev,13,6,typing(ALL,best(50,50,5)))
    holder=retry=None
    try:
        sql=call(rev,14,7,{"audio_muted":False})
        holder=start("f2d3d3_holder",IDENTITY+"BEGIN;"+sql+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        retry=start("f2d3d3_replay",IDENTITY+"BEGIN;"+sql+"COMMIT;")
        wait_blocked("f2d3d3_replay","f2d3d3_holder")
        finish(holder,"COMMIT;"); finish(retry)
    finally:
        clean(retry,holder)
    assert ack(sql)==expect_ack(14,rev,8,8,True)
    assert state(other,OTHER_IDENTITY,OTHER)["typing_best"]==other_orig
    print("F2D3D3_CONCURRENT_PATCH_CONFLICT_REPLAY_AND_INDEPENDENCE_PASS")

    # Grant changes and preference patches share profile locks. Revoking
    # typing hides old keys without deleting them; global audio choices stay
    # permitted for the verified restricted account.
    holder=retry=None
    before=raw()
    try:
        holder=start("f2d3d3_revoke",ADMIN+"BEGIN;"+publish(rev,NO_TYPING)+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        retry=start("f2d3d3_writer",IDENTITY+"BEGIN;"+call(rev,20,8,typing(ALL,best(60,60,6)))+"COMMIT;")
        wait_blocked("f2d3d3_writer","f2d3d3_revoke")
        finish(holder,"COMMIT;"); finish(retry,state="40001")
    finally:
        clean(retry,holder)
    rev+=1
    assert raw()==before
    absent_event(20)
    assert state(rev)["typing_best"]=={}
    denied(IDENTITY+call(rev,20,8,typing(ALL,best(60,60,6))),"42501")
    denied(IDENTITY+call(rev,13,6,typing(ALL,best(50,50,5))),"42501")
    denied(IDENTITY+call(rev,14,7,{"audio_muted":False}),"40001")
    save(rev,21,8,{"audio_muted":True})
    assert raw()["typing_best"]==before["typing_best"]
    query(ADMIN+publish(rev,GRANTS)); rev+=1
    assert state(rev)["typing_best"]=={FOOD:best(120,70,3),ALL:best(50,50,5)}
    assert state(rev)["version"]==9
    denied(IDENTITY+call(rev,13,6,typing(ALL,best(50,50,5))),"40001")
    save(rev,22,9,typing(ALL,best(60,60,6)))
    assert state(rev)["typing_best"][ALL]==best(60,60,6)
    # Verify the legacy direct path in a rolled-back fixture transition.
    before=raw()
    query(f"""BEGIN;
      UPDATE public.kg_chart_access_profiles SET mode='legacy' WHERE email='{EMAIL}';
      {IDENTITY}
      INSERT INTO {P}(user_id,audio_voice) VALUES('{UID}','m')
        ON CONFLICT(user_id) DO UPDATE SET audio_voice=excluded.audio_voice;
      DO $$ BEGIN
        IF (SELECT audio_voice FROM {P} WHERE user_id=auth.uid()) IS DISTINCT FROM 'm'
           OR EXISTS(SELECT 1 FROM {P} WHERE user_id='{OTHER}')
        THEN RAISE EXCEPTION 'legacy preferences ownership or upsert failed'; END IF;
      END $$;
      ROLLBACK;""")
    assert raw()==before
    assert state(rev)["version"]==10
    assert state(other,OTHER_IDENTITY,OTHER)["version"]==1
    print("F2D3D3_REVOCATION_REGRANT_LEGACY_AND_PRESERVATION_PASS")
    print("F2D3D3_FIXTURE_ONLY_PASS: no live preference or permission changes")

if __name__=="__main__":
    main()
