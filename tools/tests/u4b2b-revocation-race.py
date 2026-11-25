#!/usr/bin/env python3
"""Characterize existing RLS concurrency on disposable, network-disabled CI DB.
A reproduced race is a release blocker, NOT a security pass.
Never accepts a connection string, host, password or arbitrary container name.
"""
import subprocess
import time
import argparse

CMD = ["docker", "exec", "-i", "kg-u4b2-test-db", "psql", "-X", "-qAt",
       "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "kg_u4b2_fixture"]
UID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
EMAIL = "student1@example.invalid"
SID = "99000000-0000-4000-8000-000000000001"
IDENTITY = f"""SET ROLE authenticated;
SELECT set_config('kg_u1_test.admin','no',false);
SELECT set_config('kg_u3_test.uid','{UID}',false);
"""
WRITE = f"""INSERT INTO public.kg_chart_quiz_sessions(id,user_id,language_code,topic_id,quiz_type)
VALUES ('{SID}',auth.uid(),'my','food','native_to_image');"""
REVOKE = f"""BEGIN;
DELETE FROM public.kg_chart_access_topics WHERE email='{EMAIL}';
UPDATE public.kg_chart_access_profiles SET revision=31 WHERE email='{EMAIL}';
COMMIT;"""

def query(sql, check=True):
    return subprocess.run(CMD, input=sql, text=True, capture_output=True,
                          check=check, timeout=20)

def value(sql):
    return query(sql).stdout.strip().splitlines()[-1]

def wait_lock():
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if value("""SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a
          ON a.pid=l.pid WHERE a.application_name='kg_u4b2b_writer'
          AND l.locktype='advisory' AND NOT l.granted;""") == "1":
            return
        time.sleep(.1)
    raise RuntimeError("Writer did not reach deterministic barrier")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--require-rejection', action='store_true')
    args = parser.parse_args()
    # Disposable fixture sentinel; never connect to hosted infrastructure.
    assert value("SELECT current_database();") == "kg_u4b2_fixture"
    query(f"""UPDATE public.kg_chart_access_profiles SET mode='restricted',revision=30
      WHERE email='{EMAIL}';
      INSERT INTO public.kg_chart_access_languages(email,language_code) VALUES ('{EMAIL}','my');
      INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id) VALUES ('{EMAIL}','my','food');
      INSERT INTO public.kg_chart_access_features(email,feature_key) VALUES ('{EMAIL}','quiz.words');
      """)
    # Hold a test-only advisory barrier. The writer uses REPEATABLE READ to
    # make the previously authorized snapshot explicit and reproducible.
    blocker = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True)
    writer = None
    try:
        blocker.stdin.write("SELECT pg_advisory_lock(403291); SELECT 'ready';\n")
        blocker.stdin.flush()
        while blocker.stdout.readline().strip() != "ready":
            if blocker.poll() is not None:
                raise RuntimeError("Barrier connection failed")
        writer = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        writer.stdin.write(f"""SET application_name='kg_u4b2b_writer';
        {IDENTITY}
        BEGIN ISOLATION LEVEL REPEATABLE READ;
        DO $$ BEGIN
          IF public.kg_chart_u3b1_can_topic('my','food') IS DISTINCT FROM true
          THEN RAISE EXCEPTION 'Expected initial grant'; END IF;
        END $$;
        SELECT pg_advisory_xact_lock(403291);
        {WRITE}
        COMMIT;
        """)
        writer.stdin.close()
        writer.stdin = None
        wait_lock()
        query(REVOKE)
        blocker.stdin.write("SELECT pg_advisory_unlock(403291);\n")
        blocker.stdin.flush()
        out, err = writer.communicate(timeout=20)
        # Current staged SQL does not coordinate authorization revisions
        # with data writes. Record the result without granting release.
        persisted = value(f"SELECT count(*) FROM public.kg_chart_quiz_sessions WHERE id='{SID}';")
        if writer.returncode == 0 and persisted == "1":
            print("U4B2B_RACE_REPRODUCED: stale transaction committed after revocation")
            if args.require_rejection:
                raise RuntimeError("Prototype failed to reject stale transaction")
        elif writer.returncode != 0 and persisted == "0" and (
            "row-level security" in err.lower() or "could not serialize" in err.lower() or "revoked quiz authorization" in err.lower()
        ):
            print("U4B2B_RACE_REJECTED: tested stale transaction denied")
        else:
            raise RuntimeError("Unexpected concurrency outcome: " + err)
        # Fresh transactions must deny the same topic immediately.
        denied = query(IDENTITY + f"""INSERT INTO public.kg_chart_quiz_sessions(user_id,language_code,topic_id,quiz_type)
          VALUES (auth.uid(),'my','food','native_to_image');""", check=False)
        if denied.returncode == 0 or not any(message in denied.stderr.lower() for message in ("row-level security", "revoked quiz authorization")):
            raise RuntimeError("Fresh revoked write was not rejected by RLS")
        print("U4B2B_FRESH_REVOCATION_PASS")
        print("U4B2B_RELEASE_NO_GO: narrow existing-profile quiz experiment only")
        query(f"""DELETE FROM public.kg_chart_quiz_sessions WHERE id='{SID}';
          DELETE FROM public.kg_chart_access_features WHERE email='{EMAIL}' AND feature_key='quiz.words';
          DELETE FROM public.kg_chart_access_languages WHERE email='{EMAIL}' AND language_code='my';""")
    finally:
        for proc in (writer, blocker):
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.wait(timeout=10)

if __name__ == "__main__":
    main()
