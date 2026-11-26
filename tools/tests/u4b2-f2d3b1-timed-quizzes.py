#!/usr/bin/env python3
"""F2D3B1: timed quiz contract from the existing producer shapes; synthetic only."""
import copy
import json
import runpy
from pathlib import Path

root = Path(__file__).parent
a = runpy.run_path(str(root / "u4b2-f2a-existing-profile-protocol.py"))
b = runpy.run_path(str(root / "u4b2-f2b-atomic-quiz.py"))
query, value, denied, start, ready, wait_blocked, finish, clean = (
    a[k] for k in ("query","value","denied","start","ready","wait_blocked","finish","clean"))
UID, OTHER, IDENTITY, OTHER_IDENTITY, ADMIN, OTHER_EMAIL, STAMP = (
    a[k] for k in ("UID","OTHER","IDENTITY","OTHER_IDENTITY","ADMIN","OTHER_EMAIL","STAMP"))
publish, revision = a["publish"], a["revision"]
WORD, SENT, PRIVATE, UNMAPPED = (b[k] for k in ("WORD","SENTENCE","PRIVATE","UNMAPPED"))
GRANTS = a["GRANT"].replace("ARRAY['quiz.words']", "ARRAY['quiz.typing','quiz.speak']")
TYPING = GRANTS.replace("'quiz.typing','quiz.speak'", "'quiz.typing'")
SPEAK = GRANTS.replace("'quiz.typing','quiz.speak'", "'quiz.speak'")
S, A = "public.kg_chart_quiz_sessions", "public.kg_chart_quiz_answers"
RPC = "public.kg_chart_f2_save_timed_quiz"

def literal(v):
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"

def sid(n):
    return f"99920000-0000-4000-8000-{n:012d}"

def aid(n):
    return f"99930000-0000-4000-8000-{n:012d}"

def payload(n, mode="typing_copy", owner=UID):
    typing = mode.startswith("typing_")
    s = dict(id=sid(n),user_id=owner,language_code="my",topic_id=None,
             quiz_type=mode,total_questions=2,correct_answers=1,time_spent_seconds=30,
             created_at=STAMP,completed_at="2026-01-10T10:00:30Z")
    # A repeated word is legal; answer IDs, not content IDs, identify attempts.
    # In copy mode a finished but initially mistaken word is NOT is_correct,
    # while the existing session summary still counts it as finished.
    rows = [dict(id=aid(n*10+i),session_id=s["id"],
                 vocabulary_id=WORD if typing else None,
                 sentence_id=None if typing else SENT,
                 selected_vocabulary_id=WORD if typing and i==0 else None,
                 is_correct=i==0 and mode!="typing_copy",
                 answer_text=("first mistake" if i==0 else "skipped") if typing else None,
                 answered_at=s["completed_at"]) for i in range(2)]
    return s, rows

def call(p, rev):
    return f"SELECT {RPC}({rev},{literal(json.dumps(p[0]))}::jsonb,{literal(json.dumps(p[1]))}::jsonb);"

def absent(p):
    assert value(f"SELECT count(*) FROM {S} WHERE id='{p[0]['id']}';")=="0"
    assert value(f"SELECT count(*) FROM {A} WHERE session_id='{p[0]['id']}';")=="0"

def verify(p):
    s, rows = p
    checks = [f"{key} IS NOT DISTINCT FROM {literal(val)}" for key,val in s.items()]
    assert value(f"SELECT count(*) FROM {S} WHERE " + " AND ".join(checks) + ";")=="1"
    assert value(f"SELECT count(*) FROM {A} WHERE session_id='{s['id']}';")==str(len(rows))
    for row in rows:
        checks = [f"{key} IS NOT DISTINCT FROM {literal(val)}" for key,val in row.items()]
        assert value(f"SELECT count(*) FROM {A} WHERE " + " AND ".join(checks) +
                     " AND created_at=answered_at;")=="1"

def save(p, rev, identity=IDENTITY):
    ack = json.loads(value(identity+call(p,rev)))
    assert ack==dict(session_id=p[0]["id"],answer_count=len(p[1]),expected_revision=rev,
                     time_spent_seconds=p[0]["time_spent_seconds"])
    verify(p)

def main():
    assert value("SELECT current_database();")=="kg_u4b2_fixture"
    rev, other_rev = int(revision()), int(revision(OTHER_EMAIL))
    query(ADMIN+publish(rev,GRANTS)+publish(other_rev,GRANTS,OTHER_EMAIL))
    rev, other_rev = rev+1, other_rev+1
    for role in ("anon","service_role"):
        assert value(f"SELECT has_function_privilege('{role}','{RPC}(bigint,jsonb,jsonb)','EXECUTE');")=="f"

    for n, mode in enumerate(("typing_copy","typing_recall","speak_lines","speak_paragraph"),1):
        p = payload(n,mode)
        save(p,rev)
        save((p[0],list(reversed(p[1]))),rev)
        bad = copy.deepcopy(p)
        bad[0]["time_spent_seconds"] += 1
        denied(IDENTITY+call(bad,rev),"23505")
        verify(p)
    # Independent users with matching grants cannot take over a session.
    p = payload(1,owner=OTHER)
    denied(OTHER_IDENTITY+call(p,other_rev),"23505")
    denied(OTHER_IDENTITY+call(payload(1),other_rev),"42501")
    save(payload(5,owner=OTHER),other_rev,OTHER_IDENTITY)
    print("F2D3B1_COPY_FINISH_VS_ACCURACY_RECALL_SPEAK_DURATION_REPLAY_PASS")

    p = payload(6)
    for mutate, state in (
        (lambda x: x[0].update(total_questions=3),"22023"),
        (lambda x: x[0].update(correct_answers=0),"22023"),
        (lambda x: x[0].update(time_spent_seconds=-1),"22023"),
        (lambda x: x[1][1].update(id=x[1][0]["id"]),"22023"),
        (lambda x: x[1][1].update(session_id=sid(99)),"22023"),
        (lambda x: x[1][1].update(selected_vocabulary_id=b["OTHER_WORD"]),"22023"),
        (lambda x: x[1][1].update(vocabulary_id=b["OTHER_WORD"]),"42501"),
        (lambda x: x[1][1].update(vocabulary_id=None,sentence_id=SENT),"42501"),
    ):
        bad=copy.deepcopy(p)
        mutate(bad)
        denied(IDENTITY+call(bad,rev),state)
        absent(p)
        assert value(f"SELECT count(*) FROM {A} WHERE id='{p[1][0]['id']}';")=="0"
    for i, target in enumerate((PRIVATE,UNMAPPED,b["OTHER_WORD"]),7):
        bad=payload(i,"speak_lines")
        bad[1][1]["sentence_id"]=target
        denied(IDENTITY+call(bad,rev),"42501")
        absent(bad)
    denied(IDENTITY+call(p,rev-1),"40001")
    query(IDENTITY+"BEGIN;"+call(p,rev)+"ROLLBACK;")
    absent(p)
    # Raw restricted writes still denied; no new direct policy or grant.
    denied(IDENTITY+f"""INSERT INTO {S}(id,user_id,language_code,quiz_type,total_questions)
      VALUES('{sid(99)}',auth.uid(),'my','typing_copy',1);""","42501")
    denied(IDENTITY+f"""INSERT INTO {A}(id,session_id,vocabulary_id,is_correct)
      VALUES('{aid(99)}','{sid(1)}','{WORD}',true);""","42501")
    print("F2D3B1_SCOPE_MALFORMED_ROLLBACK_RAW_BYPASS_PASS")

    # Historical unknown duration: fixture owner models older records, with
    # normal fictional identity/insert triggers still active.
    old=payload(10)
    claims=IDENTITY.replace("SET ROLE authenticated;","")
    s=old[0]
    query(claims+f"""INSERT INTO {S}(id,user_id,language_code,quiz_type,total_questions,
      correct_answers,created_at,completed_at)
      VALUES('{s['id']}','{UID}','my','typing_copy',2,1,'{STAMP}','{s['completed_at']}');""")
    denied(IDENTITY+call(old,rev),"23505")
    assert value(f"SELECT count(*) FROM {S} WHERE id='{s['id']}' AND time_spent_seconds IS NULL;")=="1"
    assert value(f"SELECT count(*) FROM {A} WHERE session_id='{s['id']}';")=="0"
    print("F2D3B1_UNKNOWN_HISTORICAL_DURATION_HELD_PASS")

    # Same request racing itself; then a revoker racing an authorized writer.
    p=payload(11,"speak_paragraph")
    holder=retry=None
    try:
        holder=start("f2d3b1_holder",IDENTITY+"BEGIN;"+call(p,rev)+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        retry=start("f2d3b1_retry",IDENTITY+"BEGIN;"+call(p,rev)+"COMMIT;")
        wait_blocked("f2d3b1_retry","f2d3b1_holder")
        absent(p)
        finish(holder,"COMMIT;")
        finish(retry)
        verify(p)
    finally:
        clean(retry,holder)
    holder=retry=None
    try:
        blocked=payload(12,"speak_lines")
        holder=start("f2d3b1_revoke",ADMIN+"BEGIN;"+publish(rev,TYPING)+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        retry=start("f2d3b1_denied",IDENTITY+"BEGIN;"+call(blocked,rev)+"COMMIT;")
        wait_blocked("f2d3b1_denied","f2d3b1_revoke")
        finish(holder,"COMMIT;")
        finish(retry,state="40001")
        rev+=1
        denied(IDENTITY+call(blocked,rev),"42501")
        denied(IDENTITY+call(p,rev),"42501")
        absent(blocked)
        verify(p)
        save(payload(13),rev)
        query(ADMIN+publish(rev,SPEAK))
        rev+=1
        denied(IDENTITY+call(payload(14),rev),"42501")
        save(blocked,rev)
        save(payload(15,"speak_lines",OTHER),other_rev,OTHER_IDENTITY)
    finally:
        clean(retry,holder)
    print("F2D3B1_CONCURRENT_RETRY_REVOCATION_INDEPENDENCE_PASS")
    print("F2D3B1_FIXTURE_ONLY_PASS: production remains NO-GO")

if __name__=="__main__":
    main()
