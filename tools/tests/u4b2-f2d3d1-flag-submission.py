#!/usr/bin/env python3
"""F2D3D1: synthetic flag ownership, exact retry and atomic batches."""
import copy
import json
import runpy
from pathlib import Path

root=Path(__file__).parent
a=runpy.run_path(str(root/"u4b2-f2a-existing-profile-protocol.py"))
b=runpy.run_path(str(root/"u4b2-f2d3b2-colour-evidence.py"))
query,value,denied,start,ready,wait_blocked,finish,clean=(
    a[k] for k in ("query","value","denied","start","ready","wait_blocked","finish","clean"))
UID,OTHER,EMAIL,OTHER_EMAIL,IDENTITY,OTHER_IDENTITY,ADMIN,NONE=(
    a[k] for k in ("UID","OTHER","EMAIL","OTHER_EMAIL","IDENTITY","OTHER_IDENTITY","ADMIN","NONE"))
publish,revision=a["publish"],a["revision"]
literal=b["literal"]
F="public.kg_chart_flags"
R="kg_u4b2b_test_private.f2d3d1_flag_receipts"
RPC="public.kg_chart_f2_submit_flags"
WORD=b["FOOD"]
PRIVATE=b["FRIEND"]
PHRASE=b["P1"]
SENT="20000000-0000-4000-8000-000000000001"
UNMAPPED="87000000-0000-4000-8000-000000000001"
HISTORICAL="40000000-0000-4000-8000-000000000001"
TOPICS=json.dumps([{"language_code":"my","topic_id":t} for t in ("food","colours","friends_names")])
GRANTS=f"ARRAY['my'],'{TOPICS}'::jsonb,ARRAY['quiz.words','quiz.sentences','quiz.colours']"
FOOD_ONLY=a["GRANT"] # word feature and food only

def fid(n):
    return f"99945000-0000-4000-8000-{n:012d}"

def report(n,kind="word",reason="pronunciation",**extra):
    d=dict(id=fid(n),language_code="my",vocabulary_id=None,sentence_id=None,
      colour_phrase_id=None,reason=reason,notes="synthetic learner's report",
      status="open",shown_devanagari="परीक्षा",suggestion="सुधार" if reason=="pronunciation" else None)
    d[{"word":"vocabulary_id","sentence":"sentence_id","colour":"colour_phrase_id"}[kind]]=(
        {"word":WORD,"sentence":SENT,"colour":PHRASE}[kind])
    d.update(extra)
    return d

def call(rows,rev,owner=UID):
    return f"SELECT {RPC}({rev},'{owner}',{literal(json.dumps(rows,ensure_ascii=False))}::jsonb);"

def absent(*rows):
    for d in rows:
        assert value(f"SELECT count(*) FROM {F} WHERE id='{d['id']}';")=="0"
        assert value(f"SELECT count(*) FROM {R} WHERE flag_id='{d['id']}';")=="0"

def saved(d,owner=UID,status="open"):
    checks=[f"reporter_id='{owner}'",f"status='{status}'"]
    checks.extend(f"{k} IS NOT DISTINCT FROM {literal(v)}" for k,v in d.items() if k!="status")
    assert value(f"SELECT count(*) FROM {F} WHERE "+" AND ".join(checks)+";")=="1"
    assert value(f"SELECT count(*) FROM {R} WHERE flag_id='{d['id']}' AND reporter_id='{owner}';")=="1"

def submit(rows,rev,identity=IDENTITY,owner=UID):
    ack=json.loads(value(identity+call(rows,rev,owner)))
    assert ack==dict(flag_ids=sorted(d["id"] for d in rows),count=len(rows),expected_revision=rev),ack

def main():
    assert value("SELECT current_database();")=="kg_u4b2_fixture"
    rev,other=int(revision()),int(revision(OTHER_EMAIL))
    query(ADMIN+publish(rev,GRANTS)+publish(other,GRANTS,OTHER_EMAIL))
    rev+=1; other+=1
    for role in ("anon","service_role"):
        assert value(f"SELECT has_function_privilege('{role}','{RPC}(bigint,uuid,jsonb)','EXECUTE');")=="f"
    for role in ("anon","authenticated","service_role"):
        assert value(f"SELECT has_table_privilege('{role}','{R}','SELECT,INSERT,UPDATE,DELETE');")=="f"
    assert value(f"SELECT reporter_id IS NULL FROM {F} WHERE id='{HISTORICAL}';")=="t"
    denied(IDENTITY+f"INSERT INTO {F}(id,language_code,vocabulary_id,status) VALUES('{fid(90)}','my','{WORD}','open');","42501")
    w,s,c=report(1),report(2,"sentence"),report(3,"colour","missing_image")
    submit([c,s,w],rev)
    submit([w,c,s],rev)
    for d in (w,s,c): saved(d)
    # Omitted optional NULL fields and exact subset retries do not add rows.
    same={k:v for k,v in w.items() if v is not None}
    submit([same],rev)
    # Identical authored content with a new intentional ID is a second flag.
    second=dict(w,id=fid(4))
    submit([second],rev); saved(second)
    changed=dict(w,notes="different report")
    denied(IDENTITY+call([changed],rev),"23505")
    denied(OTHER_IDENTITY+call([w],other,OTHER),"23505")
    denied(OTHER_IDENTITY+call([report(5)],other,UID),"42501")
    independent=report(5)
    submit([independent],other,OTHER_IDENTITY,OTHER); saved(independent,OTHER)
    assert value(IDENTITY+f"SELECT count(*) FROM {F} WHERE id IN ('{independent['id']}','{HISTORICAL}');")=="0"
    assert value(OTHER_IDENTITY+f"SELECT count(*) FROM {F} WHERE id='{w['id']}';")=="0"
    # Moderator resolution does not make a lost-response retry reopen it.
    query(ADMIN+f"UPDATE {F} SET status='resolved',resolved_at='2026-11-26T18:00:00Z' WHERE id='{w['id']}';")
    submit([w],rev); saved(w,status="resolved")
    query(IDENTITY+f"UPDATE {F} SET status='open',resolved_at=NULL WHERE id='{w['id']}';")
    saved(w,status="resolved")
    assert value(f"SELECT resolved_at='2026-11-26T18:00:00Z'::timestamptz FROM {F} WHERE id='{w['id']}';")=="t"
    print("F2D3D1_OWNER_DISTINCT_REPORTS_REPLAY_AND_MODERATION_PASS")

    # All second-row failures roll back the first flag and its receipt.
    good=report(10)
    cases=[
      (report(11,vocabulary_id=PRIVATE),"42501"),
      (report(11,"sentence",sentence_id=UNMAPPED),"42501"),
      (report(11,"colour",colour_phrase_id=b["NO_TRANSLATION"]),"42501"),
      (report(11,language_code="ja"),"42501"),
      (report(11,reporter_id=OTHER),"22023"),
      (report(11,status="resolved"),"22023"),
      (report(11,sentence_id=SENT),"22023"),
      (report(11,vocabulary_id=None),"22023"),
      (report(11,reason="unknown"),"22023"),
      (report(11,notes="a"*16385),"22023"),
      (report(11,"sentence","missing_image"),"22023"),
      (report(11,"colour","missing_translation"),"22023"),
      (dict(good),"22023"),
    ]
    for bad,code in cases:
        denied(IDENTITY+call([good,bad],rev),code)
        absent(good,bad)
    denied(IDENTITY+call([],rev),"22023")
    denied(IDENTITY+call([report(30+i) for i in range(11)],rev),"22023")
    denied(IDENTITY+call([good],rev-1),"40001"); absent(good)
    # Old unowned ID cannot acquire an invented reporter or receipt.
    denied(IDENTITY+call([good,dict(report(11),id=HISTORICAL)],rev),"23505")
    absent(good)
    assert value(f"SELECT reporter_id IS NULL FROM {F} WHERE id='{HISTORICAL}';")=="t"
    assert value(f"SELECT count(*) FROM {R} WHERE flag_id='{HISTORICAL}';")=="0"
    query(IDENTITY+"BEGIN;"+call([good],rev)+"ROLLBACK;")
    absent(good)
    # A removed report's receipt prevents recreation by retry. Only
    # fixture owner simulates deletion; no real delete path is added.
    removed=report(12)
    submit([removed],rev)
    query(f"DELETE FROM {F} WHERE id='{removed['id']}';")
    denied(IDENTITY+call([good,removed],rev),"23505")
    absent(good)
    assert value(f"SELECT count(*) FROM {F} WHERE id='{removed['id']}';")=="0"
    assert value(f"SELECT count(*) FROM {R} WHERE flag_id='{removed['id']}';")=="1"
    print("F2D3D1_ATOMIC_BATCH_INVALID_PRIVATE_HISTORICAL_AND_ROLLBACK_PASS")

    holder=retry=None
    try:
        pair=[report(20),report(21,"sentence")]
        holder=start("f2d3d1_holder",IDENTITY+"BEGIN;"+call(pair,rev)+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        retry=start("f2d3d1_retry",IDENTITY+"BEGIN;"+call(list(reversed(pair)),rev)+"COMMIT;")
        wait_blocked("f2d3d1_retry","f2d3d1_holder")
        absent(*pair)
        finish(holder,"COMMIT;"); finish(retry)
        for d in pair: saved(d)
    finally:
        clean(retry,holder)
    holder=retry=None
    try:
        blocked=report(22,"colour")
        holder=start("f2d3d1_revoke",ADMIN+"BEGIN;"+publish(rev,FOOD_ONLY)+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        retry=start("f2d3d1_writer",IDENTITY+"BEGIN;"+call([blocked],rev)+"COMMIT;")
        wait_blocked("f2d3d1_writer","f2d3d1_revoke")
        finish(holder,"COMMIT;"); finish(retry,state="40001")
    finally:
        clean(retry,holder)
    rev+=1
    denied(IDENTITY+call([blocked],rev),"42501"); absent(blocked)
    denied(IDENTITY+call([c],rev),"42501")
    saved(c); saved(independent,OTHER)
    submit([w],rev); saved(w,status="resolved")
    query(ADMIN+publish(rev,GRANTS)); rev+=1
    submit([blocked],rev); saved(blocked)
    # Legacy direct submission is still allowed through old RLS/stamp path.
    query(f"""BEGIN;
      UPDATE public.kg_chart_access_profiles SET mode='legacy' WHERE email='{EMAIL}';
      {IDENTITY}
      INSERT INTO {F}(id,language_code,vocabulary_id,reason,status)
        VALUES('{fid(91)}','my','{WORD}','needs_review','open');
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM {F} WHERE id='{fid(91)}' AND reporter_id=auth.uid())
          THEN RAISE EXCEPTION 'legacy report not stamped'; END IF;
      END $$;
      ROLLBACK;""")
    absent(report(91))
    print("F2D3D1_CONCURRENT_RETRY_REVOCATION_REGRANT_AND_LEGACY_PASS")
    print("F2D3D1_FIXTURE_ONLY_PASS: no live permission activation")

if __name__=="__main__":
    main()
