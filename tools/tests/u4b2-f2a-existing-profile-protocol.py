#!/usr/bin/env python3
"""F2A tests: existing profiles and explicit session revision only, disposable CI DB."""
import runpy
import subprocess
import time
from pathlib import Path

base = runpy.run_path(str(Path(__file__).with_name("u4b2b-revocation-race.py")))
query, value, CMD, UID, EMAIL, IDENTITY = (
    base[k] for k in ("query", "value", "CMD", "UID", "EMAIL", "IDENTITY"))
OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
OTHER_EMAIL = "student2@example.invalid"
OTHER_IDENTITY = IDENTITY.replace(UID, OTHER)
ADMIN = IDENTITY.replace(UID, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").replace("'no'", "'yes'")
VERBOSE = "\\set VERBOSITY verbose\n"
TABLE = "public.kg_chart_quiz_sessions"
STAMP = "2026-01-10T10:00:00Z"
TOPICS = """'[{"language_code":"my","topic_id":"food"}]'::jsonb"""
GRANT = f"ARRAY['my'],{TOPICS},ARRAY['quiz.words']"
NONE = "ARRAY[]::text[],'[]'::jsonb,ARRAY[]::text[]"

def sid(n):
    return f"99700000-0000-4000-8000-{n:012d}"

def session(n, revision, correct=1, topic="food"):
    return (f"SELECT public.kg_chart_f2_save_restricted_session({revision},'{sid(n)}',"
            f"'my','{topic}','native_to_image',1,{correct},NULL::smallint,"
            f"'{STAMP}'::timestamptz,'{STAMP}'::timestamptz);")

def publish(revision, grants=GRANT, email=EMAIL):
    return f"SELECT public.kg_chart_f2_replace_restricted_grants('{email}',{grants},{revision});"

def draft(revision, email=OTHER_EMAIL):
    return f"SELECT public.kg_chart_u2_save_access_draft('{email}',{GRANT},{revision});"

def revision(email=EMAIL):
    return value(f"SELECT revision FROM public.kg_chart_access_profiles WHERE email='{email}';")

def saved(n, owner=UID):
    return value(f"SELECT count(*) FROM {TABLE} WHERE id='{sid(n)}' AND user_id='{owner}';")

def absent(n):
    assert value(f"SELECT count(*) FROM {TABLE} WHERE id='{sid(n)}';") == "0"

def denied(sql, state):
    result = query(VERBOSE + sql, check=False)
    assert result.returncode != 0 and state in result.stderr, result.stderr

def start(name, script, hold=False):
    proc = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True)
    proc.stdin.write(VERBOSE + f"SET application_name='{name}';\n" + script + "\n")
    proc.stdin.flush()
    if not hold:
        proc.stdin.close()
        proc.stdin = None
    return proc

def ready(proc):
    while True:
        line = proc.stdout.readline()
        if line.strip() == "f2_ready":
            return
        if not line:
            raise RuntimeError("Holder failed before barrier: " + proc.stderr.read())

def wait_blocked(waiter, holder):
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        if value(f"""SELECT count(*) FROM pg_stat_activity w
          JOIN pg_stat_activity h ON h.application_name='{holder}'
          WHERE w.application_name='{waiter}' AND h.pid=ANY(pg_blocking_pids(w.pid));""") == "1":
            return
        time.sleep(.1)
    raise RuntimeError(f"{waiter} did not block on {holder}")

def finish(proc, sql=None, state=None):
    if sql:
        proc.stdin.write(sql + "\n")
        proc.stdin.flush()
        proc.stdin.close()
        proc.stdin = None
    out, err = proc.communicate(timeout=25)
    if state:
        assert proc.returncode != 0 and state in err, (out, err)
    else:
        assert proc.returncode == 0, (out, err)

def clean(*procs):
    for p in procs:
        if p is not None and p.poll() is None:
            p.kill()
            p.wait(timeout=10)

def seed():
    # F3 will establish enrollment/lifecycle; create existing profiles via
    # fixture owner only. Never use this setup as a proposed application path.
    query(f"""BEGIN;
      UPDATE public.kg_chart_access_profiles SET mode='restricted',revision=100
        WHERE email IN ('{EMAIL}','{OTHER_EMAIL}');
      DELETE FROM public.kg_chart_access_languages WHERE email IN ('{EMAIL}','{OTHER_EMAIL}');
      DELETE FROM public.kg_chart_access_features WHERE email IN ('{EMAIL}','{OTHER_EMAIL}');
      INSERT INTO public.kg_chart_access_languages VALUES ('{EMAIL}','my'),('{OTHER_EMAIL}','my');
      INSERT INTO public.kg_chart_access_topics VALUES ('{EMAIL}','my','food'),('{OTHER_EMAIL}','my','food');
      INSERT INTO public.kg_chart_access_features VALUES ('{EMAIL}','quiz.words'),('{OTHER_EMAIL}','quiz.words');
      COMMIT;""")

def grant_tests():
    # Actual admin UI RPC remains legacy-only, including first draft and audit.
    query(f"""BEGIN;
      DELETE FROM public.kg_chart_access_profiles WHERE email='{OTHER_EMAIL}';
      {ADMIN}
      {draft(0)}
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM public.kg_chart_access_profiles
          WHERE email='{OTHER_EMAIL}' AND mode='legacy' AND revision=1)
           OR NOT EXISTS (SELECT 1 FROM public.kg_chart_access_draft_audit
          WHERE email='{OTHER_EMAIL}' AND revision=1 AND snapshot->>'publication'='not_authorized')
          THEN RAISE EXCEPTION 'Draft or audit not preserved'; END IF;
      END $$;
      {draft(1)}
      ROLLBACK;""")
    assert revision(OTHER_EMAIL) == "100"
    denied(ADMIN + draft(100, EMAIL), "42501")
    denied(IDENTITY + publish(100), "42501")
    denied(ADMIN + publish(99), "40001")
    denied(ADMIN + publish(100, "ARRAY['my'],'[{}]'::jsonb,ARRAY['quiz.words']"), "P0001")
    denied("SET ROLE anon; " + publish(100), "42501")
    for table in ("profiles","languages","topics","features","draft_audit"):
        for role in ("authenticated","service_role","anon"):
            for privilege in ("INSERT","UPDATE","DELETE","TRUNCATE"):
                assert value(f"SELECT has_table_privilege('{role}','public.kg_chart_access_{table}','{privilege}');") == "f"
    denied(ADMIN + f"DELETE FROM public.kg_chart_access_topics WHERE email='{EMAIL}';", "42501")
    denied("SET ROLE service_role; " + f"UPDATE public.kg_chart_access_profiles SET revision=9 WHERE email='{EMAIL}';", "42501")
    assert revision() == "100"
    query(ADMIN + "BEGIN;" + publish(100, NONE) + "ROLLBACK;")
    assert revision() == "100"
    assert value(f"SELECT count(*) FROM public.kg_chart_access_topics WHERE email='{EMAIL}';") == "1"
    print("F2A_DRAFT_COMPATIBILITY_DIRECT_GRANT_BYPASS_AND_ROLLBACK_PASS")

def session_tests():
    denied(IDENTITY + session(1, "NULL"), "40001")
    denied(IDENTITY + session(1, 99), "40001")
    denied(IDENTITY + session(1, 100, topic="friends_names"), "42501")
    absent(1)
    denied(IDENTITY + f"""INSERT INTO {TABLE}(id,user_id,language_code,topic_id,quiz_type)
        VALUES('{sid(1)}',auth.uid(),'my','food','native_to_image');""", "42501")
    query(IDENTITY + session(1, 100))
    query(IDENTITY + session(1, 100))
    assert saved(1) == "1"
    denied(IDENTITY + session(1, 100, correct=0), "23505")
    denied(OTHER_IDENTITY + session(1, 100), "23505")
    assert saved(1) == "1"
    print("F2A_EXPECTED_REVISION_DIRECT_INSERT_AND_EXACT_REPLAY_PASS")

def revoke_first():
    holder = writer = None
    try:
        holder = start("f2_revoker", ADMIN + "BEGIN;" + publish(100, NONE)
                       + "SELECT 'f2_ready';", hold=True)
        ready(holder)
        writer = start("f2_writer", IDENTITY + "BEGIN ISOLATION LEVEL READ COMMITTED;"
                       + session(2, 100) + "COMMIT;")
        wait_blocked("f2_writer", "f2_revoker")
        # Separate learner is not serialized behind this profile.
        query(OTHER_IDENTITY + session(3, 100))
        assert saved(3, OTHER) == "1"
        finish(holder, "COMMIT;")
        finish(writer, state="40001")
        absent(2)
        assert revision() == "101" and saved(1) == "1"
        assert revision(OTHER_EMAIL) == "100"
        denied(IDENTITY + session(2, 101), "42501")
        query(ADMIN + publish(101))
        denied(IDENTITY + session(2, 100), "40001")
        query(IDENTITY + session(2, 102))
        assert saved(2) == "1"
        print("F2A_READ_COMMITTED_REVOKER_FIRST_INDEPENDENT_REGRANT_PASS")
    finally:
        clean(writer, holder)

def write_first():
    holder = revoker = None
    try:
        holder = start("f2_writer", IDENTITY + "BEGIN ISOLATION LEVEL READ COMMITTED;"
                       + session(4, 102) + "SELECT 'f2_ready';", hold=True)
        ready(holder)
        revoker = start("f2_revoker", ADMIN + "BEGIN;" + publish(102, NONE) + "COMMIT;")
        wait_blocked("f2_revoker", "f2_writer")
        assert saved(4) == "0"
        finish(holder, "COMMIT;")
        finish(revoker)
        assert revision() == "103" and saved(4) == "1"
        denied(IDENTITY + session(5, 102), "40001")
        denied(IDENTITY + session(5, 103), "42501")
        absent(5)
        query(ADMIN + publish(103))
        print("F2A_READ_COMMITTED_WRITER_FIRST_HISTORY_PASS")
    finally:
        clean(revoker, holder)

def repeatable_read():
    holder = writer = None
    try:
        holder = start("f2_revoker", ADMIN + "BEGIN;" + publish(104, NONE)
                       + "SELECT 'f2_ready';", hold=True)
        ready(holder)
        writer = start("f2_writer", IDENTITY + "BEGIN ISOLATION LEVEL REPEATABLE READ;"
                       + "SELECT public.kg_chart_u3b1_can_topic('my','food');"
                       + session(6, 104) + "COMMIT;")
        wait_blocked("f2_writer", "f2_revoker")
        finish(holder, "COMMIT;")
        finish(writer, state="40001")
        absent(6)
        assert revision() == "105" and saved(1) == "1" and saved(4) == "1"
        query(ADMIN + publish(105))
        query(IDENTITY + session(6, 106))
        assert saved(6) == "1"
        print("F2A_REPEATABLE_READ_STALE_SNAPSHOT_PASS")
    finally:
        clean(writer, holder)

def main():
    assert value("SELECT current_database();") == "kg_u4b2_fixture"
    # Seed must run before the candidate ACLs take effect, but the fixture
    # owner intentionally retains setup authority. No real API role does.
    seed()
    grant_tests()
    session_tests()
    revoke_first()
    write_first()
    repeatable_read()
    print("F2A_FIXTURE_ONLY_PASS: other write paths, lifecycle and live API remain NO-GO")

if __name__ == "__main__":
    main()
