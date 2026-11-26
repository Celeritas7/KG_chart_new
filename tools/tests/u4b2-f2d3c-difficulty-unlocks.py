#!/usr/bin/env python3
"""F2D3C: restricted level selection and complete, current MCQ evidence."""
import copy
import json
import runpy
import subprocess
from pathlib import Path

root=Path(__file__).parent
a=runpy.run_path(str(root/"u4b2-f2a-existing-profile-protocol.py"))
old=runpy.run_path(str(root/"u4b2-f2d3a-recovery-contract.py"))
query,value,denied,start,ready,wait_blocked,finish,clean=(
    a[k] for k in ("query","value","denied","start","ready","wait_blocked","finish","clean"))
UID,OTHER,EMAIL,OTHER_EMAIL,IDENTITY,OTHER_IDENTITY,ADMIN,NONE=(
    a[k] for k in ("UID","OTHER","EMAIL","OTHER_EMAIL","IDENTITY","OTHER_IDENTITY","ADMIN","NONE"))
publish,revision=a["publish"],a["revision"]
literal,call,absent=old["literal"],old["call"],old["absent"]
S="public.kg_chart_quiz_sessions"
A="public.kg_chart_quiz_answers"
L="public.kg_chart_user_levels"
R="kg_u4b2b_test_private.f2d3c_mcq_receipts"
STATE="public.kg_chart_f2_level_state"
SELECT="public.kg_chart_f2_select_difficulty"
CHECK="public.kg_chart_f2_check_level_up"
TOPICS=json.dumps([{"language_code":"my","topic_id":t} for t in ("food","colours")])
GRANTS=f"ARRAY['my'],'{TOPICS}'::jsonb,ARRAY['quiz.words','quiz.sentences']"
COLOUR_ONLY=GRANTS.replace(TOPICS,json.dumps([{"language_code":"my","topic_id":"colours"}]))
RULES={"level_up":{"answers":10,"pct":85},"languages":{"my":{"level_up":{"pct":90}}}}

def rules(v):
    return f"UPDATE public.kg_chart_settings SET value={literal(json.dumps(v))}::jsonb WHERE key='unlock_rules';"

def seed():
    # Existing synthetic state deliberately includes an earned historical unlock
    # for the independent learner. No history or learner rows are deleted.
    query(f"""INSERT INTO {L}(email,language_code,level,unlocked)
      VALUES('{EMAIL}','my',1,1),('{OTHER_EMAIL}','my',2,2)
      ON CONFLICT(email,language_code) DO UPDATE SET level=excluded.level,unlocked=excluded.unlocked;
      """+rules(RULES))
    r,o=int(revision()),int(revision(OTHER_EMAIL))
    query(ADMIN+publish(r,GRANTS)+publish(o,GRANTS,OTHER_EMAIL))
    return r+1,o+1

def rpc(name,rev,*args,lang="my"):
    return f"SELECT {name}({rev},{literal(lang)}"+ "".join(f",{x}" for x in args)+");"

def state(rev,identity=IDENTITY):
    return json.loads(value(identity+rpc(STATE,rev)))

def check(rev,ver,identity=IDENTITY):
    return json.loads(value(identity+rpc(CHECK,rev,ver)))

def select(rev,ver,level):
    return json.loads(value(IDENTITY+rpc(SELECT,rev,ver,level)))

def expect(v,level,unlocked,version):
    assert {k:v[k] for k in ("level","unlocked","version")}==dict(level=level,unlocked=unlocked,version=version),v

def evidence(v,n,c,target=10,pct=90):
    assert (v["evaluated_total"],v["evaluated_correct"],v["required_answers"],v["required_pct"])==(n,c,target,pct),v

def payload(template,n,level,correct=10,count=10):
    d=copy.deepcopy(template)
    def id(i):return f"99944000-0000-4000-8000-{n*1000+i:012d}"
    at=f"2026-11-26T16:{n:02d}:00Z"
    d["id"]=id(0)
    d["session"].update(id=d["id"],difficulty=level,total_questions=count,
      correct_answers=correct,created_at=at,completed_at=at)
    d["answers"]=[dict(template["answers"][0],id=id(i+1),session_id=d["id"],
      answered_at=at,is_correct=(i<correct)) for i in range(count)]
    return d

def save(d,rev):
    ack=json.loads(value(IDENTITY+call(d,rev)))
    assert ack==dict(session_id=d["id"],answer_count=len(d["answers"]),expected_revision=rev),ack
    assert value(f"SELECT count(*) FROM {R} WHERE session_id='{d['id']}';")=="1"

def historical_summary(d):
    s=d["session"]
    claims=IDENTITY.replace("SET ROLE authenticated;","")
    query(claims+f"""INSERT INTO {S}(id,user_id,language_code,topic_id,quiz_type,total_questions,
      correct_answers,difficulty,created_at,completed_at)
      VALUES('{s['id']}','{UID}','my','food','native_to_image',{s['total_questions']},
       {s['correct_answers']},1,{literal(s['created_at'])},{literal(s['completed_at'])});""")

def main():
    assert value("SELECT current_database();")=="kg_u4b2_fixture"
    template=json.loads(subprocess.check_output(["node",str(root/"u4b2-f2d3a-recovery-drafts.mjs")],text=True))["word"]
    rev,other_rev=seed()
    expect(state(rev),1,1,0)
    expect(state(other_rev,OTHER_IDENTITY),2,2,0)
    # Old public RPC and raw direct level writes cannot grant difficulty.
    assert value(IDENTITY+"SELECT public.kg_chart_check_level_up('my') IS NULL;")=="t"
    query(IDENTITY+f"""SELECT set_config('kg.level_up','on',false);
      UPDATE {L} SET unlocked=4,level=4,f2_level_version=999 WHERE email='{EMAIL}' AND language_code='my';
      DELETE FROM {L} WHERE email='{EMAIL}' AND language_code='my';""")
    expect(state(rev),1,1,0)
    denied(IDENTITY+f"INSERT INTO {L}(email,language_code,level,unlocked) VALUES('{EMAIL}','my',4,4) ON CONFLICT DO NOTHING;","42501")
    denied(IDENTITY+rpc(SELECT,rev,0,2),"42501")
    denied(IDENTITY+rpc(SELECT,rev,0,0),"42501")
    denied(IDENTITY+rpc(STATE,rev,lang="ja"),"42501")
    denied(IDENTITY+rpc(STATE,rev-1),"40001")
    for role in ("anon","service_role"):
        for sig in (f"{STATE}(bigint,text)",f"{SELECT}(bigint,text,bigint,integer)",f"{CHECK}(bigint,text,bigint)",
                    "public.kg_chart_check_level_up(text)"):
            assert value(f"SELECT has_function_privilege('{role}','{sig}','EXECUTE');")=="f"
    for role in ("anon","authenticated","service_role"):
        for sig in ("public.kg_chart_f2_recovery_quiz_internal(bigint,jsonb)",
                    "public.kg_chart_f2_legacy_level_up_internal(text)"):
            assert value(f"SELECT has_function_privilege('{role}','{sig}','EXECUTE');")=="f"
    for d,code in ((payload(template,1,2),"42501"),(payload(template,1,5),"22023")):
        denied(IDENTITY+call(d,rev),code)
        absent(d)
    d=payload(template,1,1)
    d["session"].pop("difficulty")
    denied(IDENTITY+call(d,rev),"22023")
    absent(d)
    d=payload(template,1,1)
    d["ownerId"]=OTHER
    d["session"]["user_id"]=OTHER
    denied(IDENTITY+call(d,rev),"42501")
    absent(d)
    print("F2D3C_RAW_LEVEL_AND_LOCKED_DIFFICULTY_BYPASS_DENIED_PASS")

    history=payload(template,20,1,100,100)
    historical_summary(history)
    v=check(rev,0)
    expect(v,1,1,0); evidence(v,0,0)
    d1=payload(template,2,1,8)
    save(d1,rev)
    v=check(rev,0)
    expect(v,1,1,0); evidence(v,10,8)
    d2=payload(template,3,1,9)
    save(d2,rev); save(d2,rev)
    # Remove one invented answer as fixture owner to model damaged evidence.
    # Its receipt remains, but the missing answer excludes the entire quiz.
    query(f"DELETE FROM {A} WHERE id='{d2['answers'][-1]['id']}';")
    v=check(rev,0)
    expect(v,1,1,0); evidence(v,10,8)
    save(d2,rev)
    v=check(rev,0)
    expect(v,1,2,1); evidence(v,10,9)
    assert value(f"SELECT count(*) FROM {S} WHERE id='{history['id']}' AND total_questions=100;")=="1"
    assert value(f"SELECT count(*) FROM {R} WHERE session_id='{history['id']}';")=="0"
    denied(IDENTITY+rpc(CHECK,rev,0),"40001")
    expect(select(rev,1,2),2,2,2)
    expect(select(rev,2,2),2,2,2)
    denied(IDENTITY+rpc(SELECT,rev,1,1),"40001")
    d=payload(template,4,3)
    denied(IDENTITY+call(d,rev),"42501"); absent(d)
    print("F2D3C_COMPLETE_ATOMIC_EVIDENCE_AND_VERSIONED_SELECTION_PASS")

    # Serialize two advancement checks using the exact same expected version.
    d3=payload(template,5,2)
    save(d3,rev)
    holder=retry=None
    try:
        holder=start("f2d3c_holder",IDENTITY+"BEGIN;"+rpc(CHECK,rev,2)+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        retry=start("f2d3c_retry",IDENTITY+"BEGIN;"+rpc(CHECK,rev,2)+"COMMIT;")
        wait_blocked("f2d3c_retry","f2d3c_holder")
        finish(holder,"COMMIT;"); finish(retry,state="40001")
    finally:
        clean(retry,holder)
    expect(state(rev),2,3,3)
    expect(state(other_rev,OTHER_IDENTITY),2,2,0)
    d4=payload(template,6,3,9)
    save(d4,rev)

    # A rule editor gets the global gate first. The old revision cannot
    # advance under the pre-edit threshold after the new rule commits.
    strict=copy.deepcopy(RULES); strict["languages"]["my"]["level_up"]["pct"]=100
    holder=retry=None
    try:
        holder=start("f2d3c_editor",ADMIN+"BEGIN;"+rules(strict)+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        retry=start("f2d3c_writer",IDENTITY+"BEGIN;"+rpc(CHECK,rev,3)+"COMMIT;")
        wait_blocked("f2d3c_writer","f2d3c_editor")
        finish(holder,"COMMIT;"); finish(retry,state="40001")
    finally:
        clean(retry,holder)
    rev+=1; other_rev+=1
    assert int(revision())==rev and int(revision(OTHER_EMAIL))==other_rev
    v=check(rev,3)
    expect(v,2,3,3); evidence(v,10,9,pct=100)
    query(ADMIN+rules(strict))
    assert int(revision())==rev
    # Keep a different permitted word topic: the check itself remains
    # authorized, but the former food evidence must not be counted.
    query(ADMIN+publish(rev,COLOUR_ONLY)); rev+=1
    v=check(rev,3)
    expect(v,2,3,3); evidence(v,0,0,pct=100)
    denied(IDENTITY+call(d4,rev),"42501")
    query(ADMIN+publish(rev,NONE)); rev+=1
    denied(IDENTITY+rpc(CHECK,rev-1,3),"40001")
    denied(IDENTITY+rpc(CHECK,rev,3),"42501")
    denied(IDENTITY+rpc(SELECT,rev,3,1),"42501")
    query(ADMIN+publish(rev,GRANTS)); rev+=1
    expect(state(rev),2,3,3)
    expect(state(other_rev,OTHER_IDENTITY),2,2,0)
    v=check(rev,3)
    expect(v,2,3,3); evidence(v,10,9,pct=100)
    d5=payload(template,7,3)
    save(d5,rev)
    v=check(rev,3)
    expect(v,2,4,4); evidence(v,10,10,pct=100)
    expect(check(rev,4),2,4,4)
    print("F2D3C_CONCURRENT_ADVANCEMENT_RULE_CHANGE_REVOCATION_AND_HISTORY_PASS")

    # Rollback a historical-mode fixture transition: legacy direct selection
    # and the legacy RPC retain their old interface. F3 owns real lifecycle.
    query(f"""BEGIN;
      UPDATE public.kg_chart_access_profiles SET mode='legacy' WHERE email='{EMAIL}';
      {IDENTITY}
      UPDATE {L} SET level=1 WHERE email='{EMAIL}' AND language_code='my';
      DO $$ BEGIN
        IF (SELECT level FROM {L} WHERE email='{EMAIL}' AND language_code='my')<>1
           OR public.kg_chart_check_level_up('my') IS DISTINCT FROM 4::smallint
        THEN RAISE EXCEPTION 'legacy level behavior changed'; END IF;
      END $$;
      ROLLBACK;""")
    expect(state(rev),2,4,4)
    print("F2D3C_LEGACY_PATH_AND_ROLLBACK_PASS")
    print("F2D3C_FIXTURE_ONLY_PASS: no live permission activation")

if __name__=="__main__":
    main()
