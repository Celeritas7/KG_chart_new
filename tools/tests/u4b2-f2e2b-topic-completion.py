#!/usr/bin/env python3
"""F2E2b final fixture: completion evidence, original receipt and reset chronology."""
import copy
import json
import runpy
import subprocess
from datetime import datetime
from pathlib import Path

root=Path(__file__).parent
a=runpy.run_path(str(root/"u4b2-f2a-existing-profile-protocol.py"))
d=runpy.run_path(str(root/"u4b2-f2d3e2-admin-path-controls.py"))
l=runpy.run_path(str(root/"u4b2-f2d3c-difficulty-unlocks.py"))
c=runpy.run_path(str(root/"u4b2-f2c-versioned-progress.py"))
t=runpy.run_path(str(root/"u4b2-f2d3b1-timed-quizzes.py"))
recovery=runpy.run_path(str(root/"u4b2-f2d3a-recovery-contract.py"))
query,value,denied=(a[k] for k in ("query","value","denied"))
UID,IDENTITY,ADMIN,OTHER_EMAIL,OTHER_IDENTITY=(a[k] for k in ("UID","IDENTITY","ADMIN","OTHER_EMAIL","OTHER_IDENTITY"))
revision=a["revision"]
lit=l["literal"]
E="kg_u4b2b_test_private.f2e2b_path_evidence"
C="public.kg_chart_topic_completions"
R="kg_u4b2b_test_private.f2e2b_completion_events"
RESETS="public.kg_chart_progress_resets"
RECEIPTS="kg_u4b2b_test_private.f2c_receipts"
CLAIMS=IDENTITY.replace("SET ROLE authenticated;","")
def read(rev,who=IDENTITY):
    return json.loads(value(who+f"SELECT public.kg_chart_f2_my_completion_path({rev},'my');"))
def food(s): return next(t for t in s["topics"] if t["topic_id"]=="food")
def event(n):return f"99949500-0000-4000-8000-{n:012d}"
def complete(n,rev,row,reset,at=None):
    stamp=at if at is not None else row["eligible_at"]
    return f"SELECT public.kg_chart_f2_complete_topic({rev},'{event(n)}',{row['version']},'my','food',{lit(reset)},{lit(stamp)});"
def timestamp():
    return value("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")
def fresh_word(template,n,rev):
    draft=l["payload"](template,n,1,correct=0,count=1)
    now=timestamp();draft["session"].update(created_at=now,completed_at=now)
    for ans in draft["answers"]:ans["answered_at"]=now
    l["save"](draft,rev)
    recovery["verify"](draft)
    return draft
def boundary_snapshot(rev,cutoff,extra="",event_reset="2020-01-02T12:00:01.123000Z"):
    # Change only synthetic rows in a rolled-back transaction. The fully
    # assembled public snapshot, authorization functions and triggers run
    # unchanged; there are no positive authorization stubs here.
    stamp="2020-01-02T12:00:01.123100Z"
    return json.loads(value(f"""BEGIN;
      {CLAIMS}
      UPDATE {C} SET completed_at={lit(stamp)} WHERE {c['ckey']()};
      UPDATE {RESETS} SET reset_at={lit(cutoff)}
        WHERE (email='{a['EMAIL']}' OR email IS NULL) AND language_code IN ('my','*');
      UPDATE {R} SET evidence_at={lit(stamp)},reset_at={lit(event_reset)}
        WHERE owner_id='{UID}' AND event_id='{event(2)}';
      UPDATE {RECEIPTS} SET request=jsonb_set(request,'{{completed_at}}',to_jsonb({lit(stamp)}::timestamptz))
        WHERE owner_id='{UID}' AND event_id='{event(2)}';
      {extra}
      {IDENTITY}
      SELECT public.kg_chart_f2_my_completion_path({rev},'my');
      ROLLBACK;"""))
def test_boundaries_and_provenance(rev):
    # Earlier/equal/later exact cutoffs all share one millisecond. Equality
    # is invalidated too: qualifying evidence must be strictly after reset.
    for fraction,expected in (("123000",True),("123100",False),("123900",False)):
        snap=boundary_snapshot(rev,f"2020-01-02T12:00:01.{fraction}Z")
        assert food(snap)["complete"] is expected,(fraction,snap)
        assert datetime.fromisoformat(food(snap)["completed_at"]).microsecond==123100
    cutoff="2020-01-02T12:00:01.123000Z"
    # A valid timestamp or an old F2C receipt alone is insufficient. All
    # associations must describe the current version of this exact topic.
    corruptions=[
        f"DELETE FROM {R} WHERE owner_id='{UID}' AND event_id='{event(2)}';",
        f"UPDATE {RECEIPTS} SET event_version=event_version+1 WHERE owner_id='{UID}' AND event_id='{event(2)}';",
        f"UPDATE {RECEIPTS} SET owner_id='{a['OTHER']}' WHERE owner_id='{UID}' AND event_id='{event(2)}';",
    ]
    for field,bad in (("operation","rating_upsert"),("language_code","ja"),("target","colours"),
                      ("completed_at","2020-01-02T12:00:01.123900Z"),("expected_version",99999)):
        corruptions.append(f"UPDATE {RECEIPTS} SET request=jsonb_set(request,'{{{field}}}',{lit(json.dumps(bad))}::jsonb) "
                           f"WHERE owner_id='{UID}' AND event_id='{event(2)}';")
    for extra in corruptions:
        assert food(boundary_snapshot(rev,cutoff,extra))["complete"] is False,extra
    assert food(boundary_snapshot(rev,cutoff,event_reset=None))["complete"] is False
    # No-reset legacy state also cannot claim future/nonfinite completion.
    future=value("SELECT clock_timestamp()+interval '10 years';")
    for stamp in ("infinity",future):
        extra=f"DELETE FROM {RESETS}; UPDATE {C} SET completed_at={lit(stamp)} WHERE {c['ckey']()};"
        assert food(boundary_snapshot(rev,cutoff,extra))["complete"] is False,stamp
    print("F2E2BR1_EXACT_RESET_BOUNDARIES_AND_RECEIPT_PROVENANCE_PASS")
def test_final_wrappers(rev,template):
    # Existing pre-F2E2b history must not gain a path receipt on replay,
    # even when a public wrapper confirms the original complete payload.
    historical=l["payload"](template,51,1,correct=0,count=1)
    old_created=recovery["old_partial"](historical)
    l["save"](historical,rev)
    recovery["verify"](historical,old_created)
    assert value(f"SELECT count(*) FROM {E} WHERE session_id='{historical['id']}';")=="0"
    old_recall=t["payload"](2,"typing_recall")
    t["save"](old_recall,rev)
    assert value(f"SELECT count(*) FROM {E} WHERE session_id='{old_recall[0]['id']}';")=="0"
    # The final timed wrapper still supports recall with exact duration and
    # answer IDs; an exact retry never renews its confirmation timestamp.
    recall=t["payload"](490,"typing_recall")
    now=timestamp();recall[0].update(created_at=now,completed_at=now,time_spent_seconds=0)
    for ans in recall[1]:ans["answered_at"]=now
    t["save"](recall,rev)
    original=value(f"SELECT to_jsonb(e) FROM {E} e WHERE session_id='{recall[0]['id']}';")
    t["save"](recall,rev)
    assert value(f"SELECT to_jsonb(e) FROM {E} e WHERE session_id='{recall[0]['id']}';")==original
    bad=copy.deepcopy(recall);bad[0]["time_spent_seconds"]=1
    denied(IDENTITY+t["call"](bad,rev),"23505")
    # Final-schema rating facade retains upsert, delete tombstones, current
    # readback and original receipt replay while completion_upsert is closed.
    baseline=c["state"](rev)["version"]
    rate=c["rate"](9902,rev,baseline,3,timestamp())
    c["ack"](IDENTITY,rate,9902,baseline+1,baseline+1)
    assert c["state"](rev)["state"]["rating"]==3
    c["ack"](IDENTITY,c["remove"](9903,rev,baseline+1),9903,baseline+2,baseline+2)
    c["ack"](IDENTITY,rate,9902,baseline+1,baseline+2,True)
    assert c["state"](rev)==dict(version=baseline+2,state=None,permission_revision=rev)
    denied(IDENTITY+c["complete"](9904,rev,food(read(rev))["version"],timestamp()),"42501")
    for role in ("anon","authenticated","service_role"):
        for signature in ("public.kg_chart_f2e2b_recovery_internal(bigint,jsonb)",
                          "public.kg_chart_f2e2b_timed_internal(bigint,jsonb,jsonb)",
                          "public.kg_chart_f2e2b_progress_internal(bigint,uuid,bigint,text,text,uuid,text,int,timestamptz,timestamptz,timestamptz)"):
            assert value(f"SELECT has_function_privilege('{role}','{signature}','EXECUTE');")=="f"
    print("F2E2BR1_FINAL_WORD_RECALL_RATING_WRAPPERS_AND_NO_BACKFILL_PASS")
def test_admin_reset_precision(rev):
    before=d["history"]();fractions=[]
    # Exercise the real administrator emitter too. Independent clock
    # samples ensure this catches millisecond truncation without relying on
    # two HTTP/process calls happening to fit inside one millisecond.
    for n in (96,97,98):
        result=d["save"](n,"path_reset",[d["target"](rev,lang="my")]);rev+=1
        cutoff=result["results"][0]["after"]["reset_at"]
        fractions.append(datetime.fromisoformat(cutoff).microsecond%1000)
        assert read(rev)["reset_at"]==cutoff
        assert not food(read(rev))["complete"]
    assert any(fractions),"Administrative reset lost sub-millisecond server precision"
    assert d["history"]()==before
    print("F2E2BR1_ADMIN_RESET_PRESERVES_SERVER_PRECISION_AND_HISTORY_PASS")
    return rev
def main():
    assert value("SELECT current_database();")=="kg_u4b2_fixture"
    # Use the existing final synthetic profile and administrator controls.
    # Narrow rules to a single permitted MCQ type for deterministic evidence.
    query(l["rules"]({"min_attempts":1,"quiz_types":["native_to_image"]}))
    rev=int(revision())
    old=read(rev);row=food(old)
    assert old["reset_at"] is not None and row["eligible_at"] is None and not row["complete"],old
    for role in ("anon","authenticated","service_role"):
        assert value(f"SELECT has_table_privilege('{role}','{E}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE');")=="f"
        assert value(f"SELECT has_table_privilege('{role}','{R}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE');")=="f"
    denied(IDENTITY+c["complete"](9901,rev,row["version"],timestamp()),"42501")
    denied(IDENTITY+complete(1,rev,row,old["reset_at"],timestamp()),"42501")
    assert value(f"SELECT count(*) FROM {R} WHERE event_id='{event(1)}';")=="0"
    template=json.loads(subprocess.check_output(["node",str(root/"u4b2-f2d3a-recovery-drafts.mjs")],text=True))["word"]
    # A newly acknowledged old draft is still old activity. Its receipt
    # must not turn it into post-reset evidence.
    stale=l["payload"](template,45,1,correct=0,count=1)
    l["save"](stale,rev)
    assert food(read(rev))["eligible_at"] is None
    # New atomic session started after the reset, right or wrong counts.
    fresh=fresh_word(template,46,rev)
    count=value(f"SELECT count(*) FROM {E} WHERE session_id='{fresh['id']}';")
    confirmed=value(f"SELECT confirmed_at FROM {E} WHERE session_id='{fresh['id']}';")
    l["save"](fresh,rev)
    assert count=="1" and value(f"SELECT confirmed_at FROM {E} WHERE session_id='{fresh['id']}';")==confirmed
    earlier_evidence=food(read(rev))["eligible_at"]
    fresh_word(template,47,rev)
    eligible=read(rev);row=food(eligible)
    assert row["eligible_at"] is not None and not row["complete"],eligible
    assert row["eligible_at"]!=earlier_evidence
    sql=complete(2,rev,row,eligible["reset_at"])
    first=json.loads(value(IDENTITY+sql))
    assert first["completed_at"]==row["eligible_at"] and first["replayed"] is False,first
    assert first["event_version"]==row["version"]+1
    assert json.loads(value(IDENTITY+sql))==dict(first,replayed=True)
    saved=food(read(rev));assert saved["complete"] and saved["completed_at"]==row["eligible_at"]
    denied(IDENTITY+complete(3,rev,row,eligible["reset_at"]),"40001")
    # p_evidence_at freezes eligibility only. It must not hide a newer
    # current completion and let a fresh event downgrade it at today's
    # version using still-valid but older evidence from the same reset.
    denied(IDENTITY+complete(3,rev,saved,eligible["reset_at"],earlier_evidence),"40001")
    assert food(read(rev))==saved
    test_boundaries_and_provenance(rev)
    # Reset as administrator: history remains, fresh revision is required
    # and no replay may assign the old work a new timestamp.
    prior_count=value(f"SELECT count(*) FROM {C} WHERE user_id='{UID}' AND language_code='my' AND topic_id='food';")
    d["save"](95,"path_reset",[d["target"](rev,lang="my")]);rev+=1
    denied(IDENTITY+sql,"40001")
    after=read(rev);newrow=food(after)
    assert newrow["version"]==saved["version"] and not newrow["complete"] and newrow["eligible_at"] is None,after
    assert value(f"SELECT count(*) FROM {C} WHERE user_id='{UID}' AND language_code='my' AND topic_id='food';")==prior_count
    denied(IDENTITY+complete(4,rev,newrow,after["reset_at"],timestamp()),"42501")
    assert all(x["vocabulary_id"]!=fresh["answers"][0]["vocabulary_id"] for x in after["counts"])
    # Exact old-session replay and delayed upload cannot renew evidence or
    # earn fresh completion after the reset, even with the current revision.
    l["save"](fresh,rev)
    assert value(f"SELECT confirmed_at FROM {E} WHERE session_id='{fresh['id']}';")==confirmed
    l["save"](l["payload"](template,49,1,correct=0,count=1),rev)
    assert food(read(rev))["eligible_at"] is None
    # Future client activity is preserved but held, not counted.
    future=value("SELECT clock_timestamp()+interval '10 years';")
    future_draft=l["payload"](template,50,1,correct=0,count=1)
    future_draft["session"].update(created_at=future,completed_at=future)
    for ans in future_draft["answers"]:ans["answered_at"]=future
    l["save"](future_draft,rev)
    assert food(read(rev))["eligible_at"] is None
    # Preserve the complete original future historical row at reset, then
    # archive it inside the accepted event before fresh progress replaces
    # the current projection. No historical evidence/receipt is fabricated.
    query(CLAIMS+f"UPDATE {C} SET completed_at={lit(future)} WHERE {c['ckey']()};")
    historical=value(f"SELECT to_jsonb(c) FROM {C} c WHERE {c['ckey']()};")
    assert food(read(rev))["complete"] is False
    denied(IDENTITY+complete(5,rev,food(read(rev)),after["reset_at"],timestamp()),"42501")
    assert value(f"SELECT count(*) FROM {R} WHERE event_id='{event(5)}';")=="0"
    assert value(f"SELECT to_jsonb(c) FROM {C} c WHERE {c['ckey']()};")==historical
    fresh_word(template,48,rev)
    fresh_snapshot=read(rev);fresh_row=food(fresh_snapshot)
    assert fresh_row["eligible_at"] is not None and not fresh_row["complete"]
    fresh_sql=complete(5,rev,fresh_row,fresh_snapshot["reset_at"])
    replacement=json.loads(value(IDENTITY+fresh_sql))
    assert replacement["replayed"] is False and food(read(rev))["complete"]
    assert value(f"SELECT prior_completion FROM {R} WHERE owner_id='{UID}' AND event_id='{event(5)}';")==historical
    preserved=value(f"SELECT to_jsonb(e) FROM {R} e WHERE owner_id='{UID}' AND event_id='{event(5)}';")
    assert json.loads(value(IDENTITY+fresh_sql))==dict(replacement,replayed=True)
    assert value(f"SELECT to_jsonb(e) FROM {R} e WHERE owner_id='{UID}' AND event_id='{event(5)}';")==preserved
    print("F2E2BR1_FUTURE_HISTORY_PRESERVED_AND_FRESH_COMPLETION_PASS")
    test_final_wrappers(rev,template)
    rev=test_admin_reset_precision(rev)
    other=read(int(revision(OTHER_EMAIL)),OTHER_IDENTITY)
    assert other["owner_id"]!=UID and other["reset_at"]!=after["reset_at"]
    print("F2E2B_CONFIRMED_EVIDENCE_RECEIPT_RESET_AND_OWNER_ISOLATION_PASS")
if __name__=="__main__":
    main()
