#!/usr/bin/env python3
"""F2D3A: exercise the real sealed F1 recovery payload against the candidate."""
import copy
import json
import runpy
import subprocess
from pathlib import Path

root = Path(__file__).parent
a = runpy.run_path(str(root / "u4b2-f2a-existing-profile-protocol.py"))
b = runpy.run_path(str(root / "u4b2-f2b-atomic-quiz.py"))
query,value,denied,start,ready,wait_blocked,finish,clean = (
    a[k] for k in ("query","value","denied","start","ready","wait_blocked","finish","clean"))
UID,IDENTITY,OTHER_IDENTITY,ADMIN,NONE = (
    a[k] for k in ("UID","IDENTITY","OTHER_IDENTITY","ADMIN","NONE"))
publish,revision,GRANTS = a["publish"],a["revision"],b["GRANTS"]
S = "public.kg_chart_quiz_sessions"
A = "public.kg_chart_quiz_answers"
RPC = "public.kg_chart_f2_save_recovery_quiz"

def literal(v):
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"

def call(draft, rev):
    return f"SELECT {RPC}({rev},{literal(json.dumps(draft))}::jsonb);"

def absent(draft):
    assert value(f"SELECT count(*) FROM {S} WHERE id={literal(draft['id'])};") == "0"
    assert value(f"SELECT count(*) FROM {A} WHERE session_id={literal(draft['id'])};") == "0"
    for item in draft["answers"]:
        assert value(f"SELECT count(*) FROM {A} WHERE id={literal(item['id'])};") == "0"

def verify(d, historical_created=None):
    s = d["session"]
    where = [f"id={literal(s['id'])}", f"user_id={literal(s['user_id'])}"]
    for key in ("language_code","topic_id","quiz_type","quiz_level","difficulty",
                "total_questions","correct_answers","created_at","completed_at"):
        where.append(f"{key} IS NOT DISTINCT FROM {literal(s.get(key))}")
    assert value(f"SELECT count(*) FROM {S} WHERE " + " AND ".join(where) + ";") == "1"
    assert value(f"SELECT count(*) FROM {A} WHERE session_id={literal(s['id'])};") == str(len(d["answers"]))
    for item in d["answers"]:
        where = [f"id={literal(item['id'])}", f"session_id={literal(s['id'])}"]
        for key in ("vocabulary_id","sentence_id","selected_vocabulary_id","is_correct","answer_text","answered_at"):
            where.append(f"{key} IS NOT DISTINCT FROM {literal(item.get(key))}")
        at = (historical_created or {}).get(item["id"], item["answered_at"])
        where.append(f"created_at={literal(at)}::timestamptz")
        assert value(f"SELECT count(*) FROM {A} WHERE " + " AND ".join(where) + ";") == "1"

def save(d, rev):
    receipt = json.loads(value(IDENTITY + call(d,rev)))
    assert receipt == {"session_id": d["id"], "answer_count": len(d["answers"]), "expected_revision": rev}

def old_partial(d, omitted_answered_at=False):
    s = d["session"]
    item = d["answers"][0]
    # Test owner inserts *synthetic* pre-candidate history, including the
    # old server-assigned metadata. Never mutate an actual learner record.
    history_at = "2026-11-26T10:10:00Z"
    query(f"""INSERT INTO {S}(id,user_id,language_code,topic_id,quiz_type,total_questions,correct_answers,
      created_at,completed_at,difficulty,quiz_level)
      VALUES({literal(s['id'])},{literal(s['user_id'])},{literal(s['language_code'])},{literal(s['topic_id'])},
      {literal(s['quiz_type'])},{s['total_questions']},{s['correct_answers']},
      {literal(s['created_at'])},{literal(s['completed_at'])},{literal(s.get('difficulty'))},{literal(s.get('quiz_level'))});
      INSERT INTO {A}(id,session_id,vocabulary_id,sentence_id,selected_vocabulary_id,is_correct,
      answer_text,answered_at,created_at) VALUES({literal(item['id'])},{literal(s['id'])},
      {literal(item['vocabulary_id'])},{literal(item['sentence_id'])},{literal(item['selected_vocabulary_id'])},
      {literal(item['is_correct'])},{literal(item['answer_text'])},
      {literal(None if omitted_answered_at else item['answered_at'])},{literal(history_at)});""")
    return {item["id"]: history_at}

def main():
    assert value("SELECT current_database();") == "kg_u4b2_fixture"
    ds = json.loads(subprocess.check_output(["node",str(root / "u4b2-f2d3a-recovery-drafts.mjs")],text=True))
    rev, other_rev = b["seed"]()
    # Keep the old SQL signature inaccessible in the reconciled fixture.
    for role in ("anon","authenticated","service_role"):
        assert value(f"""SELECT has_function_privilege('{role}',
          'public.kg_chart_f2_save_restricted_quiz(bigint,uuid,text,text,text,int,int,smallint,timestamptz,timestamptz,jsonb,text,boolean)','EXECUTE');""") == "f"
    for role in ("anon","service_role"):
        assert value(f"SELECT has_function_privilege('{role}','{RPC}(bigint,jsonb)','EXECUTE');") == "f"
    for name in ("word","sentence","copy","dev","memory"):
        d = ds[name]
        assert all("created_at" not in x for x in d["answers"])
        save(d,rev)
        save(json.loads(json.dumps(d)),rev)
        verify(d)
        changed = copy.deepcopy(d)
        changed["answers"][1]["answer_text"] = "different answer"
        denied(IDENTITY+call(changed,rev),"23505")
        verify(d)
    # Equivalent timestamp offsets and answer ordering preserve identity.
    replay = copy.deepcopy(ds["word"])
    replay["answers"].reverse()
    replay["answers"][0]["answered_at"] = replay["answers"][0]["answered_at"].replace("10:00:02.000Z","19:00:02+09:00")
    save(replay,rev)
    verify(ds["word"])
    changed = copy.deepcopy(ds["copy"])
    changed["session"]["quiz_level"] = "memory"
    denied(IDENTITY+call(changed,rev),"23505")
    verify(ds["copy"])
    denied(IDENTITY+call(ds["unknown"],rev),"22023")
    absent(ds["unknown"])
    print("F2D3A_REAL_F1_WORD_SENTENCE_LEVEL_AND_TIMESTAMP_REPLAY_PASS")

    partial = ds["partial"]
    metadata = old_partial(partial)
    save(partial,rev)
    save(partial,rev)
    verify(partial,metadata)
    d = ds["legacyOmission"]
    old_partial(d, omitted_answered_at=True)
    d["omittedColumns"]["answers"] = ["answered_at"]
    denied(IDENTITY+call(d,rev),"23505")
    assert value(f"SELECT count(*) FROM {A} WHERE session_id={literal(d['id'])};") == "1"
    assert value(f"SELECT count(*) FROM {A} WHERE id={literal(d['answers'][0]['id'])} AND answered_at IS NULL;") == "1"
    print("F2D3A_HISTORICAL_METADATA_PRESERVED_UNPROVEN_OMISSION_HELD_PASS")

    d = ds["conflict"]
    for mutate in (
        lambda x: x.update(sealed=False),
        lambda x: x.update(version=2),
        lambda x: x.update(kind="sentence"),
        lambda x: x["answers"][0].update(session_id=ds["word"]["id"]),
        lambda x: x["answers"][0].update(created_at=x["answers"][0]["answered_at"]),
        lambda x: x["answers"][1].pop("answered_at"),
        lambda x: x["answers"][1].update(id=x["answers"][0]["id"]),
        lambda x: x["session"].update(correct_answers=2),
        lambda x: x["session"].update(quiz_level="invalid"),
    ):
        bad = copy.deepcopy(d)
        mutate(bad)
        denied(IDENTITY+call(bad,rev),"22023")
        absent(d)
    denied(OTHER_IDENTITY+call(d,other_rev),"42501")
    denied(IDENTITY+call(d,rev-1),"40001")
    absent(d)
    bad = copy.deepcopy(d)
    bad["answers"][1]["vocabulary_id"] = b["OTHER_WORD"]
    denied(IDENTITY+call(bad,rev),"42501")
    absent(d)
    save(d,rev)
    verify(d)
    query(IDENTITY+"BEGIN;"+call(ds["rollback"],rev)+"ROLLBACK;")
    absent(ds["rollback"])
    print("F2D3A_INVALID_FOREIGN_STALE_AND_ATOMIC_ROLLBACK_PASS")

    # Deterministic concurrent replay with the actual recovery payload.
    holder = retry = None
    try:
        d = ds["race"]
        holder = start("f2d3a_holder",IDENTITY+"BEGIN;"+call(d,rev)+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        retry = start("f2d3a_retry",IDENTITY+"BEGIN;"+call(d,rev)+"COMMIT;")
        wait_blocked("f2d3a_retry","f2d3a_holder")
        absent(d)
        finish(holder,"COMMIT;")
        finish(retry)
        verify(d)
    finally:
        clean(retry,holder)
    query(ADMIN+publish(rev,NONE))
    denied(IDENTITY+call(ds["denied"],rev),"40001")
    denied(IDENTITY+call(ds["denied"],rev+1),"42501")
    denied(IDENTITY+call(ds["word"],rev+1),"42501")
    absent(ds["denied"])
    verify(ds["word"])
    query(ADMIN+publish(rev+1,GRANTS))
    save(ds["denied"],rev+2)
    verify(ds["denied"])
    print("F2D3A_CONCURRENT_RETRY_REVOCATION_REGRANT_PASS")
    print("F2D3A_FIXTURE_ONLY_PASS: no app or production activation")

if __name__ == "__main__":
    main()
