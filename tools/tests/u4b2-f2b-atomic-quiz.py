#!/usr/bin/env python3
"""F2B: atomic word/sentence quiz ingestion, isolated synthetic database only."""
import json
import runpy
from pathlib import Path

a = runpy.run_path(str(Path(__file__).with_name("u4b2-f2a-existing-profile-protocol.py")))
query, value, denied, start, ready, wait_blocked, finish, clean = (
    a[k] for k in ("query","value","denied","start","ready","wait_blocked","finish","clean"))
UID, OTHER, EMAIL, OTHER_EMAIL, IDENTITY, OTHER_IDENTITY, ADMIN, NONE, STAMP = (
    a[k] for k in ("UID","OTHER","EMAIL","OTHER_EMAIL","IDENTITY","OTHER_IDENTITY","ADMIN","NONE","STAMP"))
publish, revision = a["publish"], a["revision"]
GRANTS = a["GRANT"].replace("ARRAY['quiz.words']", "ARRAY['quiz.words','quiz.sentences']")
WORD = "10000000-0000-4000-8000-000000000001"
OTHER_WORD = "10000000-0000-4000-8000-000000000003"
SENTENCE = "20000000-0000-4000-8000-000000000001"
UNMAPPED = "87000000-0000-4000-8000-000000000001"
PRIVATE = "20000000-0000-4000-8000-000000000003"

def sid(n):
    return f"99800000-0000-4000-8000-{n:012d}"

def aid(n):
    return f"99810000-0000-4000-8000-{n:012d}"

def answer(n, correct=True, word=WORD, sentence=None):
    return dict(id=aid(n),vocabulary_id=word,sentence_id=sentence,
                selected_vocabulary_id=None,is_correct=correct,answer_text=None,
                answered_at=STAMP,completed_at=None,created_at=STAMP)

def quiz(n, rev, answers, correct=None, total=None, mode="native_to_image", topic="food", parent=None):
    payload = json.dumps(answers).replace("'","''")
    if correct is None:
        correct = sum(x.get("is_correct") is True for x in answers)
    if total is None:
        total = len(answers)
    t = "NULL" if topic is None else f"'{topic}'"
    return (f"SELECT public.kg_chart_f2_save_restricted_quiz({rev},'{parent or sid(n)}',"
            f"'my',{t},'{mode}',{total},{correct},NULL::smallint,"
            f"'{STAMP}'::timestamptz,'{STAMP}'::timestamptz,'{payload}'::jsonb);")

def count(parent, expected_sessions, expected_answers, owner=UID):
    assert value(f"SELECT count(*) FROM public.kg_chart_quiz_sessions WHERE id='{parent}' AND user_id='{owner}';") == str(expected_sessions)
    assert value(f"SELECT count(*) FROM public.kg_chart_quiz_answers WHERE session_id='{parent}';") == str(expected_answers)

def exact(parent, items, owner=UID):
    count(parent,1,len(items),owner)
    for item in items:
        word = item["vocabulary_id"]
        sentence = item["sentence_id"]
        w = f"'{word}'::uuid" if word else "NULL::uuid"
        s = f"'{sentence}'::uuid" if sentence else "NULL::uuid"
        correct = str(item["is_correct"]).lower()
        assert value(f"""SELECT count(*) FROM public.kg_chart_quiz_answers
          WHERE id='{item['id']}' AND session_id='{parent}' AND vocabulary_id IS NOT DISTINCT FROM {w}
          AND sentence_id IS NOT DISTINCT FROM {s} AND is_correct={correct}
          AND answered_at='{STAMP}'::timestamptz AND created_at='{STAMP}'::timestamptz;""") == "1"

def seed():
    # Keep F2A's actual revision state rather than resetting audit history.
    r1,r2 = int(revision()),int(revision(OTHER_EMAIL))
    query(ADMIN + publish(r1,GRANTS) + publish(r2,GRANTS,OTHER_EMAIL))
    return r1+1,r2+1

def behavior(rev, other_rev):
    first = [answer(1),answer(2,False)]
    denied(IDENTITY + a["session"](91,rev),"42501")
    denied(IDENTITY + quiz(1,rev,first,total=3),"22023")
    count(sid(1),0,0)
    denied(IDENTITY + quiz(1,rev,[first[0],answer(3,word=OTHER_WORD)]),"42501")
    count(sid(1),0,0)
    assert value(f"SELECT count(*) FROM public.kg_chart_quiz_answers WHERE id='{aid(1)}';") == "0"
    denied(IDENTITY + quiz(1,rev,first,correct=2),"22023")
    count(sid(1),0,0)
    denied(IDENTITY + quiz(1,rev,[first[0],first[0]]),"22023")
    count(sid(1),0,0)
    denied(IDENTITY + quiz(1,rev,[dict(first[0],session_id=sid(99))]),"22023")
    count(sid(1),0,0)
    query(IDENTITY + quiz(1,rev,first))
    query(IDENTITY + quiz(1,rev,list(reversed(first))))
    exact(sid(1),first)
    denied(IDENTITY + quiz(1,rev,[answer(4),answer(5,False)]),"22023")
    exact(sid(1),first)
    changed = [dict(first[0],answer_text="conflict"),first[1]]
    denied(IDENTITY + quiz(1,rev,changed),"23505")
    denied(OTHER_IDENTITY + quiz(1,other_rev,first),"23505")
    denied(OTHER_IDENTITY + quiz(2,other_rev,[answer(6),first[0]]),"23505")
    count(sid(2),0,0,OTHER)
    assert value(f"SELECT count(*) FROM public.kg_chart_quiz_answers WHERE id='{aid(6)}';") == "0"
    denied(IDENTITY + f"""INSERT INTO public.kg_chart_quiz_answers(id,session_id,vocabulary_id,is_correct)
      VALUES('{aid(7)}','{sid(1)}','{WORD}',true);""","42501")
    exact(sid(1),first)
    print("F2B_ATOMIC_FAILURE_EXACT_REPLAY_AND_DIRECT_BYPASS_PASS")

    # A matching historical session-only F2A write may be recovered.
    old = a["sid"](6)
    query(IDENTITY + quiz(6,rev,[answer(8)],parent=old))
    exact(old,[answer(8)])

    sentence = [answer(10,word=None,sentence=SENTENCE)]
    query(IDENTITY + quiz(10,rev,sentence,mode="sentence_to_meaning",topic=None))
    exact(sid(10),sentence)
    for n,bad in [(11,UNMAPPED),(12,PRIVATE)]:
        denied(IDENTITY + quiz(n,rev,[sentence[0] | {"id":aid(n),"sentence_id":bad}],
             mode="sentence_to_meaning",topic=None),"42501")
        count(sid(n),0,0)
    denied(IDENTITY + quiz(13,rev,[answer(13)],mode="colour_phrase"),"22023")
    print("F2B_SENTENCE_SCOPE_AND_COMPATIBLE_PARTIAL_RECOVERY_PASS")

def concurrent_retry(rev):
    holder = retry = None
    items = [answer(20),answer(21,False)]
    try:
        holder = start("f2b_writer",IDENTITY+"BEGIN;"+quiz(20,rev,items)+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        retry = start("f2b_retry",IDENTITY+"BEGIN;"+quiz(20,rev,items)+"COMMIT;")
        wait_blocked("f2b_retry","f2b_writer")
        count(sid(20),0,0)
        finish(holder,"COMMIT;")
        finish(retry)
        exact(sid(20),items)
        print("F2B_CONCURRENT_IDENTICAL_RETRY_PASS")
    finally:
        clean(retry,holder)

def revocation(rev, other_rev):
    holder = writer = None
    items = [answer(30),answer(31,False)]
    try:
        holder = start("f2b_revoker",ADMIN+"BEGIN;"+publish(rev,NONE)+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        writer = start("f2b_writer",IDENTITY+"BEGIN;"+quiz(30,rev,items)+"COMMIT;")
        wait_blocked("f2b_writer","f2b_revoker")
        query(OTHER_IDENTITY+quiz(32,other_rev,[answer(32)]))
        exact(sid(32),[answer(32)],OTHER)
        finish(holder,"COMMIT;")
        finish(writer,state="40001")
        count(sid(30),0,0)
        denied(IDENTITY+quiz(30,rev+1,items),"42501")
        # Even an exact previously acknowledged quiz must not bypass revocation.
        denied(IDENTITY+quiz(1,rev+1,[answer(1),answer(2,False)]),"42501")
        query(ADMIN+publish(rev+1,GRANTS))
        denied(IDENTITY+quiz(30,rev,items),"40001")
        query(IDENTITY+quiz(30,rev+2,items))
        exact(sid(30),items)
        exact(sid(1),[answer(1),answer(2,False)])
        print("F2B_REVOCATION_STALE_RETRY_HISTORY_AND_INDEPENDENCE_PASS")
    finally:
        clean(writer,holder)
    return rev+2

def legacy_and_rollback(rev):
    # Existing legacy direct path remains authorized in this fixture. No
    # persistent profile mode changes; F3 will own the lifecycle protocol.
    query(f"""BEGIN;
      UPDATE public.kg_chart_access_profiles SET mode='legacy' WHERE email='{EMAIL}';
      {IDENTITY}
      INSERT INTO public.kg_chart_quiz_sessions(id,user_id,language_code,topic_id,quiz_type)
        VALUES('{sid(40)}',auth.uid(),'my','food','native_to_image');
      INSERT INTO public.kg_chart_quiz_answers(id,session_id,vocabulary_id,is_correct)
        VALUES('{aid(40)}','{sid(40)}','{WORD}',true);
      ROLLBACK;""")
    count(sid(40),0,0)
    query(IDENTITY+"BEGIN;"+quiz(41,rev,[answer(41)])+"ROLLBACK;")
    count(sid(41),0,0)
    print("F2B_LEGACY_DIRECT_PATH_AND_ROLLBACK_PASS")

def main():
    assert value("SELECT current_database();") == "kg_u4b2_fixture"
    rev, other_rev = seed()
    behavior(rev,other_rev)
    concurrent_retry(rev)
    rev = revocation(rev,other_rev)
    legacy_and_rollback(rev)
    print("F2B_FIXTURE_ONLY_PASS: production remains NO-GO")

if __name__ == "__main__":
    main()
