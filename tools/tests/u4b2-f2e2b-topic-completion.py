#!/usr/bin/env python3
"""F2E2b final fixture: completion evidence, original receipt and reset chronology."""
import copy
import json
import runpy
import subprocess
from pathlib import Path

root=Path(__file__).parent
a=runpy.run_path(str(root/"u4b2-f2a-existing-profile-protocol.py"))
d=runpy.run_path(str(root/"u4b2-f2d3e2-admin-path-controls.py"))
l=runpy.run_path(str(root/"u4b2-f2d3c-difficulty-unlocks.py"))
c=runpy.run_path(str(root/"u4b2-f2c-versioned-progress.py"))
query,value,denied=(a[k] for k in ("query","value","denied"))
UID,IDENTITY,ADMIN,OTHER_EMAIL,OTHER_IDENTITY=(a[k] for k in ("UID","IDENTITY","ADMIN","OTHER_EMAIL","OTHER_IDENTITY"))
revision=a["revision"]
lit=l["literal"]
E="kg_u4b2b_test_private.f2e2b_path_evidence"
C="public.kg_chart_topic_completions"
R="kg_u4b2b_test_private.f2e2b_completion_events"
def read(rev,who=IDENTITY):
    return json.loads(value(who+f"SELECT public.kg_chart_f2_my_completion_path({rev},'my');"))
def food(s): return next(t for t in s["topics"] if t["topic_id"]=="food")
def event(n):return f"99949500-0000-4000-8000-{n:012d}"
def complete(n,rev,row,reset,at=None):
    stamp=at if at is not None else row["eligible_at"]
    return f"SELECT public.kg_chart_f2_complete_topic({rev},'{event(n)}',{row['version']},'my','food',{lit(reset)},{lit(stamp)});"
def timestamp():
    return value("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")
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
    fresh=l["payload"](template,46,1,correct=0,count=1)
    now=timestamp();fresh["session"].update(created_at=now,completed_at=now)
    for ans in fresh["answers"]:ans["answered_at"]=now
    l["save"](fresh,rev)
    count=value(f"SELECT count(*) FROM {E} WHERE session_id='{fresh['id']}';")
    confirmed=value(f"SELECT confirmed_at FROM {E} WHERE session_id='{fresh['id']}';")
    l["save"](fresh,rev)
    assert count=="1" and value(f"SELECT confirmed_at FROM {E} WHERE session_id='{fresh['id']}';")==confirmed
    eligible=read(rev);row=food(eligible)
    assert row["eligible_at"] is not None and not row["complete"],eligible
    sql=complete(2,rev,row,eligible["reset_at"])
    first=json.loads(value(IDENTITY+sql))
    assert first["completed_at"]==row["eligible_at"] and first["replayed"] is False,first
    assert first["event_version"]==row["version"]+1
    assert json.loads(value(IDENTITY+sql))==dict(first,replayed=True)
    saved=food(read(rev));assert saved["complete"] and saved["completed_at"]==row["eligible_at"]
    denied(IDENTITY+complete(3,rev,row,eligible["reset_at"]),"40001")
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
    other=read(int(revision(OTHER_EMAIL)),OTHER_IDENTITY)
    assert other["owner_id"]!=UID and other["reset_at"]!=after["reset_at"]
    print("F2E2B_CONFIRMED_EVIDENCE_RECEIPT_RESET_AND_OWNER_ISOLATION_PASS")
if __name__=="__main__":
    main()
