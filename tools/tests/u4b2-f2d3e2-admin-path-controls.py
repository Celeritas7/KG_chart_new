#!/usr/bin/env python3
"""F2D3E2: admin path controls, exact event audit, stale writes and history."""
import copy
import json
import runpy
import subprocess
from pathlib import Path

root=Path(__file__).parent
a=runpy.run_path(str(root/"u4b2-f2a-existing-profile-protocol.py"))
c=runpy.run_path(str(root/"u4b2-f2c-versioned-progress.py"))
l=runpy.run_path(str(root/"u4b2-f2d3c-difficulty-unlocks.py"))
d=runpy.run_path(str(root/"u4b2-f2d1-shared-authorization.py"))
query,value,denied,start,ready,wait_blocked,finish,clean=(
    a[k] for k in ("query","value","denied","start","ready","wait_blocked","finish","clean"))
UID,OTHER,EMAIL,OTHER_EMAIL,IDENTITY,OTHER_IDENTITY,ADMIN,NONE=(
    a[k] for k in ("UID","OTHER","EMAIL","OTHER_EMAIL","IDENTITY","OTHER_IDENTITY","ADMIN","NONE"))
publish,revision=a["publish"],a["revision"]
U="public.kg_chart_topic_unlocks"
R="public.kg_chart_progress_resets"
L=l["L"]
E="kg_u4b2b_test_private.f2d3e2_admin_events"
B="kg_u4b2b_test_private.f2d3e2_bypass_version"
RPC="public.kg_chart_f2_admin_path_control"
READ="public.kg_chart_f2_my_path_controls"
BYPASS="public.kg_chart_f2_admin_bypass_state"
SETTINGS="public.kg_chart_settings"
ADMIN_ID="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
TOPICS=json.dumps([{"language_code":"my","topic_id":t} for t in ("food","colours","friends_names")])
GRANTS=f"ARRAY['my'],'{TOPICS}'::jsonb,ARRAY['quiz.words','quiz.sentences','quiz.typing']"
FOOD_ONLY=a["GRANT"]

def event(n):return f"99949000-0000-4000-8000-{n:012d}"
def lit(v):return "'"+str(v).replace("'","''")+"'"
def target(rev,owner=UID,lang="my",**extra):
    return dict(owner_id=owner,expected_revision=rev,language_code=lang,**extra)
def unlock(rev,owner=UID,lang="my",topic="food",enabled=True):
    return target(rev,owner,lang,topic_id=topic,enabled=enabled)
def call(n,op,items):
    return f"SELECT {RPC}('{event(n)}',{lit(op)},{lit(json.dumps(items))}::jsonb);"
def ack(sql,who=ADMIN):
    return json.loads(value(who+sql))
def path(rev,lang="my",who=IDENTITY):
    return ack(f"SELECT {READ}({rev},{lit(lang)});",who)
def absent(n):
    assert value(f"SELECT count(*) FROM {E} WHERE event_id='{event(n)}';")=="0"
def receipt(n):
    return json.loads(value(f"SELECT results FROM {E} WHERE event_id='{event(n)}' AND actor_id='{ADMIN_ID}';"))
def save(n,op,items):
    x=ack(call(n,op,items))
    assert x["event_id"]==event(n) and x["operation"]==op and x["replayed"] is False,x
    assert receipt(n)==x["results"]
    return x
def replay(n,op,items,original):
    assert ack(call(n,op,items))==dict(original,replayed=True)
def row_count(table,where="true"):return int(value(f"SELECT count(*) FROM {table} WHERE {where};"))
def history():
    return {t:value(f"SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'[]')) FROM {t} x;")
      for t in (l["S"],l["A"],"public.kg_chart_user_ratings","public.kg_chart_topic_completions")}
def level(rev,who=IDENTITY):return l["state"](rev,who)

def main():
    assert value("SELECT current_database();")=="kg_u4b2_fixture"
    rev,other=int(revision()),int(revision(OTHER_EMAIL))
    query(ADMIN+publish(rev,GRANTS)+publish(other,GRANTS,OTHER_EMAIL));rev+=1;other+=1
    # Synthetic legacy history: existing global reset and an out-of-scope
    # manual private unlock. Do not invent or delete its owner on upgrade.
    query(f"""INSERT INTO {R}(email,language_code,reset_at) VALUES(NULL,'*','2020-01-01T00:00:00Z');
      INSERT INTO {U}(email,language_code,topic_id) VALUES('{EMAIL}','*','friends_names');""")
    hist=history()
    epoch=d["epoch"]()
    for role in ("anon","service_role"):
        assert value(f"SELECT has_function_privilege('{role}','{RPC}(uuid,text,jsonb)','EXECUTE');")=="f"
    for role in ("anon","authenticated","service_role"):
        for tab in (E,B):
            assert value(f"SELECT has_table_privilege('{role}','{tab}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE');")=="f"
        for tab in (U,R):
            assert value(f"SELECT has_table_privilege('{role}','{tab}','INSERT,UPDATE,DELETE,TRUNCATE');")=="f"
    denied(IDENTITY+call(1,"manual_unlock",[unlock(rev)]),"42501")
    # Fake admin boolean alone is not a verified admin identity.
    denied(IDENTITY.replace("'no'","'yes'")+call(1,"manual_unlock",[unlock(rev)]),"42501")
    denied("SET ROLE service_role;"+call(1,"manual_unlock",[unlock(rev)]),"42501")
    absent(1)
    query(f"CREATE POLICY synthetic_bad_unlock_read ON {U} FOR SELECT TO authenticated USING(true);"
          f"CREATE POLICY synthetic_bad_reset_read ON {R} FOR SELECT TO authenticated USING(true);")
    assert value(IDENTITY+f"SELECT count(*) FROM {U};")=="0"
    assert value(IDENTITY+f"SELECT count(*) FROM {R};")=="0"
    assert path(rev)["unlocks"]==[] and path(rev)["bypass"] is False
    assert path(rev)["reset_at"].startswith("2020-01-01")
    denied(IDENTITY+f"SELECT {READ}({rev},'ja');","42501")
    denied(IDENTITY+f"SELECT {READ}({rev},'*');","42501")
    denied(ADMIN+call(1,"manual_unlock",[unlock(rev,topic="friends_names")]),"42501")
    denied(ADMIN+call(1,"manual_unlock",[unlock(rev,lang="ja")]),"42501")
    absent(1)
    # Atomic batch: valid first target + invalid second baseline rolls back.
    pair=[unlock(rev,lang="*"),unlock(other-1,OTHER,topic="colours")]
    denied(ADMIN+call(2,"manual_unlock",pair),"40001")
    absent(2)
    assert row_count(U,f"email='{EMAIL}' AND topic_id='food'")==0
    assert (int(revision()),int(revision(OTHER_EMAIL)))==(rev,other)
    pair=[unlock(rev,lang="*"),unlock(other,OTHER,topic="colours")]
    x=save(2,"manual_unlock",pair);rev+=1;other+=1
    assert [z["permission_revision"] for z in x["results"]]==[rev,other]
    replay(2,"manual_unlock",pair,x)
    denied(ADMIN+call(2,"manual_unlock",[unlock(rev)]),"23505")
    assert path(rev)["unlocks"]==["food"]
    assert path(other,who=OTHER_IDENTITY)["unlocks"]==["colours"]
    assert value(ADMIN+f"SELECT count(*) FROM {U};")=="3"
    x=save(3,"manual_unlock",[unlock(rev,lang="*")])
    assert x["results"][0]["changed"] is False and int(revision())==rev
    # Adding wildcard does not grant other languages, and a revoked topic
    # stays hidden while its historical manual override remains stored.
    query(ADMIN+publish(rev,NONE));rev+=1
    denied(IDENTITY+f"SELECT {READ}({rev-1},'my');","40001")
    denied(IDENTITY+f"SELECT {READ}({rev},'my');","42501")
    assert row_count(U,f"email='{EMAIL}' AND topic_id='food'")==1
    # Removing an old out-of-scope row remains possible; no latent grant.
    x=save(4,"manual_unlock",[unlock(rev,lang="*",topic="friends_names",enabled=False)]);rev+=1
    query(ADMIN+publish(rev,GRANTS));rev+=1
    assert path(rev)["unlocks"]==["food"]
    assert int(revision(OTHER_EMAIL))==other
    print("F2D3E2_ADMIN_SCOPE_ATOMIC_MANUAL_BATCH_AND_REVOCATION_PASS")

    # A reset is append-only server time. Exact retries do not append again,
    # nor erase history or another learner's controls.
    items=[target(rev,lang="*")]
    x=save(5,"path_reset",items);rev+=1
    cutoff=x["results"][0]["after"]["reset_at"]
    assert path(rev)["reset_at"]==cutoff
    assert path(other,who=OTHER_IDENTITY)["reset_at"].startswith("2020-01-01")
    replay(5,"path_reset",items,x)
    assert row_count(R,f"email='{EMAIL}'")==1
    assert history()==hist
    assert path(rev)["unlocks"]==["food"]
    denied(ADMIN+call(6,"path_reset",[target(rev,lang="ja")]),"42501")
    denied(ADMIN+call(6,"path_reset",[target(rev,owner=ADMIN_ID)]),"42501")
    denied(ADMIN+call(6,"path_reset",[target(rev,reset_at="2020-01-01")]),"22023")
    absent(6)
    denied(IDENTITY+f"INSERT INTO {R}(email,language_code) VALUES('{OTHER_EMAIL}','*');","42501")
    # Reset races with a real progress writer. The old revision cannot
    # acknowledge an update after the reset, and rollback preserves both.
    before=c["state"](rev)
    holder=writer=None
    try:
        holder=start("f2e2_admin",ADMIN+"BEGIN;"+call(7,"path_reset",[target(rev)])+"SELECT 'f2_ready';",hold=True)
        ready(holder)
        writer=start("f2e2_learner",IDENTITY+"BEGIN;"+c["rate"](901,rev,before["version"],3)+"COMMIT;")
        wait_blocked("f2e2_learner","f2e2_admin")
        assert row_count(R,f"email='{EMAIL}'")==1
        absent(7)
        finish(holder,"COMMIT;");finish(writer,state="40001")
    finally:
        clean(writer,holder)
    rev+=1
    assert row_count(R,f"email='{EMAIL}'")==2 and c["receipts"](901)=="0"
    assert history()==hist
    query(ADMIN+"BEGIN;"+call(8,"path_reset",[target(rev)])+"ROLLBACK;")
    absent(8)
    assert int(revision())==rev and row_count(R,f"email='{EMAIL}'")==2
    print("F2D3E2_APPEND_ONLY_RESET_IDEMPOTENCY_CONCURRENCY_AND_HISTORY_PASS")

    # Current admin override may lower as well as raise. Old MCQ evidence
    # cannot immediately undo an explicit lowering. Only new atomic evidence
    # completed after the cutoff is considered.
    old_level=level(rev)
    assert old_level["unlocked"]==4
    assert value(ADMIN+f"SELECT count(*) FROM {L} WHERE email='{EMAIL}';")!="0"
    query(f"CREATE POLICY synthetic_bad_level_update ON {L} FOR UPDATE TO authenticated USING(true) WITH CHECK(true);")
    query(ADMIN+f"UPDATE {L} SET unlocked=1,level=1 WHERE email='{EMAIL}' AND language_code='my';")
    assert level(rev)==old_level
    denied(ADMIN+call(9,"level_override",[target(rev,unlocked=1,expected_level_version=old_level["version"]-1)]),"40001")
    absent(9)
    items=[target(rev,unlocked=1,expected_level_version=old_level["version"])]
    x=save(9,"level_override",items);rev+=1
    ver=old_level["version"]+1
    assert level(rev)==dict(level=1,unlocked=1,version=ver)
    assert x["results"][0]["after"]["admin_cutoff_at"] is not None
    replay(9,"level_override",items,x)
    denied(IDENTITY+l["rpc"](l["CHECK"],rev-1,ver),"40001")
    assert l["check"](rev,ver)["evaluated_total"]==0
    template=json.loads(subprocess.check_output(["node",str(root/"u4b2-f2d3a-recovery-drafts.mjs")],text=True))["word"]
    old_draft=l["payload"](template,40,1)
    l["save"](old_draft,rev)
    assert l["check"](rev,ver)["evaluated_total"]==0
    new_draft=l["payload"](template,41,1)
    stamp=value("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")
    new_draft["session"].update(created_at=stamp,completed_at=stamp)
    for ans in new_draft["answers"]:ans["answered_at"]=stamp
    l["save"](new_draft,rev)
    advanced=l["check"](rev,ver)
    assert advanced["unlocked"]==2 and advanced["version"]==ver+1 and advanced["evaluated_total"]==10,advanced
    denied(ADMIN+call(10,"level_override",[target(rev,unlocked=4,expected_level_version=ver)]),"40001")
    absent(10)
    x=save(10,"level_override",[target(rev,unlocked=3,expected_level_version=ver+1)]);rev+=1
    assert level(rev)==dict(level=1,unlocked=3,version=ver+2)
    assert level(other,OTHER_IDENTITY)["unlocked"]==2
    print("F2D3E2_LEVEL_OVERRIDE_VERSION_CUTOFF_FRESH_EVIDENCE_AND_ISOLATION_PASS")

    # Bypass cannot be toggled by raw admin DML, or grant content to a
    # restricted learner. Its own version is independent of target revisions.
    denied(IDENTITY+f"SELECT {BYPASS}();","42501")
    before=ack(f"SELECT {BYPASS}();")
    query(ADMIN+f"UPDATE {SETTINGS} SET value=to_jsonb(NOT (value#>>'{{}}')::boolean) WHERE key='admin_bypass_lock';")
    assert ack(f"SELECT {BYPASS}();")==before
    denied(ADMIN+call(11,"admin_bypass",[dict(expected_version=before["version"]+1,enabled=True)]),"40001")
    absent(11)
    items=[dict(expected_version=before["version"],enabled=not before["enabled"])]
    x=save(11,"admin_bypass",items)
    replay(11,"admin_bypass",items,x)
    assert ack(f"SELECT {BYPASS}();")==dict(enabled=not before["enabled"],version=before["version"]+1)
    assert (int(revision()),int(revision(OTHER_EMAIL)))==(rev,other)
    assert d["epoch"]()==epoch
    assert path(rev)["bypass"] is False and path(other,who=OTHER_IDENTITY)["bypass"] is False
    # Legacy own/global history reads remain available in a rolled-back
    # fictional mode transition; no real enrollment or mode changes.
    query(f"""BEGIN; UPDATE public.kg_chart_access_profiles SET mode='legacy' WHERE email='{EMAIL}';
      {IDENTITY}
      DO $$ BEGIN
        IF (SELECT count(*) FROM {U})<>1 OR (SELECT count(*) FROM {R})<>3
          OR EXISTS(SELECT 1 FROM {U} WHERE email='{OTHER_EMAIL}')
        THEN RAISE EXCEPTION 'legacy path history isolation failed'; END IF;
      END $$; ROLLBACK;""")
    assert row_count(E)==9
    assert row_count(E,f"actor_id='{ADMIN_ID}'")==9
    print("F2D3E2_ADMIN_BYPASS_AUDIT_LEGACY_AND_TARGETED_REVISION_PASS")
    print("F2D3E2_FIXTURE_ONLY_PASS: no live data, admin control or permission changes")

if __name__=="__main__":
    main()
