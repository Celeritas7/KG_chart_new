#!/usr/bin/env python3
"""F2D3B2: synthetic colour evidence, immutable summaries and authorization."""
import copy
import json
import runpy
from pathlib import Path

root=Path(__file__).parent
a=runpy.run_path(str(root/"u4b2-f2a-existing-profile-protocol.py"))
query,value,denied,start,ready,wait_blocked,finish,clean=(
    a[k] for k in ("query","value","denied","start","ready","wait_blocked","finish","clean"))
UID,OTHER,IDENTITY,OTHER_IDENTITY,ADMIN,OTHER_EMAIL,STAMP=(
    a[k] for k in ("UID","OTHER","IDENTITY","OTHER_IDENTITY","ADMIN","OTHER_EMAIL","STAMP"))
publish,revision=a["publish"],a["revision"]
S="public.kg_chart_quiz_sessions"
A="public.kg_chart_quiz_answers"
R="kg_u4b2b_test_private.f2d3b2_colour_receipts"
C="public.kg_chart_colour_phrases"
RPC="public.kg_chart_f2_save_colour_quiz"
FOOD="10000000-0000-4000-8000-000000000001"
COLOUR="10000000-0000-4000-8000-000000000002"
FRIEND="10000000-0000-4000-8000-000000000004"
SECOND="99941000-0000-4000-8000-000000000001"
MISSING="99941000-0000-4000-8000-000000000002"
P1="30000000-0000-4000-8000-000000000001"
def pid(n):
    return f"99942000-0000-4000-8000-{n:012d}"
P2,PRIVATE,FOREIGN,NO_TRANSLATION=(pid(n) for n in (2,3,4,5))
TOPICS=json.dumps([{"language_code":"my","topic_id":t} for t in ("food","colours","friends_names")])
GRANTS=f"ARRAY['my'],'{TOPICS}'::jsonb,ARRAY['quiz.colours']"
FOOD_ONLY=a["GRANT"].replace("quiz.words","quiz.colours")
NO_FEATURE=GRANTS.replace("ARRAY['quiz.colours']","ARRAY[]::text[]")
def literal(v):
    return "NULL" if v is None else "'" + str(v).replace("'","''") + "'"

def seed():
    # Synthetic source edits go through the F2D2 gate and publish revisions.
    query(f"""BEGIN;
      INSERT INTO public.kg_chart_vocabulary(id,topic_id,english_text) VALUES
      ('{SECOND}','colours','second colour'),('{MISSING}','colours','missing translation');
      INSERT INTO public.kg_chart_vocabulary_translations(vocabulary_id,language_code,native_text)
        VALUES('{SECOND}','my','synthetic second');
      INSERT INTO {C}(id,language_code,colour_id,noun_id,native_text) VALUES
      ('{P2}','my','{SECOND}','{FOOD}','synthetic second food'),
      ('{PRIVATE}','my','{COLOUR}','{FRIEND}','synthetic private'),
      ('{FOREIGN}','ja','{COLOUR}','{FOOD}','synthetic foreign'),
      ('{NO_TRANSLATION}','my','{MISSING}','{FOOD}','synthetic incomplete');
      COMMIT;""")
    r,o=int(revision()),int(revision(OTHER_EMAIL))
    query(ADMIN+publish(r,GRANTS)+publish(o,GRANTS,OTHER_EMAIL))
    return r+1,o+1

def payload(n,mode="phrase_to_picture",owner=UID):
    s=dict(id=f"99943000-0000-4000-8000-{n:012d}",user_id=owner,
           language_code="my",topic_id=None,quiz_type="colour_phrase",
           total_questions=2,correct_answers=1,time_spent_seconds=30,
           created_at=STAMP,completed_at="2026-01-10T10:00:30Z")
    return s,mode,[dict(phrase_id=P1,selected_phrase_id=P1,option_ids=[P2,P1],
                       answered_at="2026-01-10T10:00:10Z"),
                   dict(phrase_id=P2,selected_phrase_id=P1,option_ids=[P2,P1],
                       answered_at="2026-01-10T10:00:20Z")]

def call(p,rev):
    s,mode,questions=p
    return f"SELECT {RPC}({rev},{literal(json.dumps(s))}::jsonb,{literal(mode)},{literal(json.dumps(questions))}::jsonb);"

def absent(p):
    sid=p[0]["id"]
    for table,key in ((S,"id"),(R,"session_id"),(A,"session_id")):
        assert value(f"SELECT count(*) FROM {table} WHERE {key}='{sid}';")=="0"

def verify(p):
    s,mode,questions=p
    sid=s["id"]
    checks=[f"{key} IS NOT DISTINCT FROM {literal(val)}" for key,val in s.items()]
    assert value(f"SELECT count(*) FROM {S} WHERE "+" AND ".join(checks)+";")=="1"
    r=json.loads(value(f"""SELECT jsonb_build_object('mode',mode,'questions',questions)
      FROM {R} WHERE session_id='{sid}';"""))
    assert r["mode"]==mode
    # UTC timestamp normalization; IDs and displayed option order are immutable.
    assert r["questions"]==[dict(x,answered_at=x["answered_at"].replace("Z","+00:00")) for x in questions]
    assert value(f"SELECT count(*) FROM {A} WHERE session_id='{sid}';")=="0"

def save(p,rev,identity=IDENTITY):
    s=p[0]
    ack=json.loads(value(identity+call(p,rev)))
    assert ack==dict(session_id=s["id"],question_count=s["total_questions"],
                     correct_answers=s["correct_answers"],expected_revision=rev,
                     time_spent_seconds=s["time_spent_seconds"])
    verify(p)

def main():
    assert value("SELECT current_database();")=="kg_u4b2_fixture"
    rev,other=seed()
    for role in ("anon","authenticated","service_role"):
        for priv in ("SELECT","INSERT","UPDATE","DELETE","TRUNCATE"):
            assert value(f"SELECT has_table_privilege('{role}','{R}','{priv}');")=="f"
    for role in ("anon","service_role"):
        assert value(f"SELECT has_function_privilege('{role}','{RPC}(bigint,jsonb,text,jsonb)','EXECUTE');")=="f"

    # The primary private test must fail only for the private rule, not the
    # topic or feature grant. The missing component translation is separate.
    assert value(IDENTITY+f"SELECT public.kg_chart_u3b1_can_colour_phrase('my','{COLOUR}','{FRIEND}');")=="t"
    assert value(IDENTITY+f"SELECT public.kg_chart_u3b3a_private_colour('my','{COLOUR}','{FRIEND}');")=="f"
    for n,mode in enumerate(("phrase_to_picture","listen_to_picture","picture_to_phrase"),1):
        p=payload(n,mode)
        save(p,rev)
        save(p,rev)
        equivalent=copy.deepcopy(p)
        equivalent[2][0]["answered_at"]="2026-01-10T19:00:10+09:00"
        ack=json.loads(value(IDENTITY+call(equivalent,rev)))
        assert ack["session_id"]==p[0]["id"]
        verify(p)
        changed=copy.deepcopy(p)
        changed[2][0]["option_ids"].reverse()
        denied(IDENTITY+call(changed,rev),"23505")
        denied(IDENTITY+call((p[0],"listen_to_picture" if mode!="listen_to_picture" else "picture_to_phrase",p[2]),rev),"23505")
        verify(p)
    denied(OTHER_IDENTITY+call(payload(1),other),"42501")
    denied(OTHER_IDENTITY+call(payload(1,owner=OTHER),other),"23505")
    save(payload(4,owner=OTHER),other,OTHER_IDENTITY)
    print("F2D3B2_THREE_MODES_EXACT_EVIDENCE_REPLAY_INDEPENDENCE_PASS")

    p=payload(5)
    for mutate in (
        lambda x:x[0].update(correct_answers=2),
        lambda x:x[0].update(total_questions=3),
        lambda x:x[0].update(topic_id="food"),
        lambda x:x[2][1].update(phrase_id=P1),
        lambda x:x[2][1].update(option_ids=[P1,P1]),
        lambda x:x[2][1].update(selected_phrase_id=PRIVATE),
        lambda x:x[2][1].update(option_ids=[P2]),
        lambda x:x[2][1].update(answered_at="2026-01-10T10:00:31Z"),
        lambda x:x[2][1].update(is_correct=True),
    ):
        bad=copy.deepcopy(p)
        mutate(bad)
        denied(IDENTITY+call(bad,rev),"22023")
        absent(p)
    # Hidden content cannot be claimed as a target, selected answer or even
    # unselected distractor. Verify the entire run is rolled back.
    for bad_id in (PRIVATE,FOREIGN,NO_TRANSLATION,pid(99)):
        for kind in ("target","selected","distractor"):
            bad=copy.deepcopy(p)
            q=bad[2][1]
            q["option_ids"].append(bad_id)
            if kind=="target":
                q["phrase_id"]=bad_id
            elif kind=="selected":
                q["selected_phrase_id"]=bad_id
            denied(IDENTITY+call(bad,rev),"42501")
            absent(p)
    denied(IDENTITY+call((p[0],p[1],[]),rev),"22023")
    denied(IDENTITY+call(p,rev-1),"40001")
    query(IDENTITY+"BEGIN;"+call(p,rev)+"ROLLBACK;")
    absent(p)
    denied(IDENTITY+f"""INSERT INTO {S}(id,user_id,language_code,quiz_type,total_questions)
      VALUES('{p[0]['id']}',auth.uid(),'my','colour_phrase',2);""","42501")
    print("F2D3B2_MALFORMED_SCOPE_ALL_OPTIONS_SUMMARY_ONLY_ROLLBACK_PASS")

    # The exact old summary still cannot acquire new unverified evidence.
    old=payload(6)
    s=old[0]
    claims=IDENTITY.replace("SET ROLE authenticated;","")
    query(claims+f"""INSERT INTO {S}(id,user_id,language_code,quiz_type,total_questions,
      correct_answers,created_at,completed_at,time_spent_seconds)
      VALUES('{s['id']}','{UID}','my','colour_phrase',2,1,'{STAMP}','{s['completed_at']}',30);""")
    denied(IDENTITY+call(old,rev),"23505")
    assert value(f"SELECT count(*) FROM {S} WHERE id='{s['id']}' AND correct_answers=1;")=="1"
    assert value(f"SELECT count(*) FROM {R} WHERE session_id='{s['id']}';")=="0"
    print("F2D3B2_HISTORICAL_SUMMARY_PRESERVED_WITHOUT_INVENTED_EVIDENCE_PASS")

    h=w=None
    p=payload(7)
    try:
        h=start("f2d3b2_holder",IDENTITY+"BEGIN;"+call(p,rev)+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2d3b2_retry",IDENTITY+"BEGIN;"+call(p,rev)+"COMMIT;")
        wait_blocked("f2d3b2_retry","f2d3b2_holder")
        absent(p)
        finish(h,"COMMIT;")
        finish(w)
        verify(p)
    finally:
        clean(w,h)
    h=w=None
    try:
        blocked=payload(8)
        h=start("f2d3b2_edit",ADMIN+"BEGIN;"+f"DELETE FROM {C} WHERE id='{P2}';"+"SELECT 'f2_ready';",hold=True)
        ready(h)
        w=start("f2d3b2_writer",IDENTITY+"BEGIN;"+call(blocked,rev)+"COMMIT;")
        wait_blocked("f2d3b2_writer","f2d3b2_edit")
        finish(h,"COMMIT;")
        finish(w,state="40001")
        rev+=1
        other+=1
        denied(IDENTITY+call(blocked,rev),"42501")
        denied(IDENTITY+call(p,rev),"42501")
        absent(blocked)
        verify(p)
        verify(payload(4,owner=OTHER))
    finally:
        clean(w,h)
    # Recreate the synthetic source row, then recheck current grants. Neither
    # regrant nor restoration silently overwrites the old immutable receipt.
    query(f"INSERT INTO {C}(id,language_code,colour_id,noun_id,native_text) VALUES('{P2}','my','{SECOND}','{FOOD}','synthetic second food');")
    rev+=1
    other+=1
    query(ADMIN+publish(rev,FOOD_ONLY))
    rev+=1
    denied(IDENTITY+call(blocked,rev),"42501")
    query(ADMIN+publish(rev,NO_FEATURE))
    rev+=1
    denied(IDENTITY+call(blocked,rev),"42501")
    query(ADMIN+publish(rev,GRANTS))
    rev+=1
    save(blocked,rev)
    save(p,rev)
    save(payload(9,owner=OTHER),other,OTHER_IDENTITY)
    print("F2D3B2_CONCURRENT_RETRY_SOURCE_DELETE_REVOKE_REGRANT_PASS")
    print("F2D3B2_FIXTURE_ONLY_PASS: no live permission activation")

if __name__=="__main__":
    main()
