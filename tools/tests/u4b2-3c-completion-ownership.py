#!/usr/bin/env python3
"""U4B2B-3C: topic completions in the disposable KG CI fixture only."""
import runpy
import subprocess
from pathlib import Path

base = runpy.run_path(str(Path(__file__).with_name("u4b2b-revocation-race.py")))
query, value, wait_lock = (base[k] for k in ("query", "value", "wait_lock"))
CMD, UID, EMAIL, IDENTITY = (base[k] for k in ("CMD", "UID", "EMAIL", "IDENTITY"))
OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
OTHER_EMAIL = "student2@example.invalid"
OTHER_IDENTITY = IDENTITY.replace(UID, OTHER)
TABLE = "public.kg_chart_topic_completions"
KEY = f"user_id='{UID}' AND language_code='my' AND topic_id='food'"
OTHER_KEY = KEY.replace(UID, OTHER)
OLD_KEY = f"user_id='{OTHER}' AND language_code='ja' AND topic_id='animals'"
D1 = "2026-01-01T10:00:00Z"
D2 = "2026-01-02T10:00:00Z"
D3 = "2026-01-03T10:00:00Z"
D4 = "2026-01-04T10:00:00Z"
D5 = "2026-01-05T10:00:00Z"

def completion(owner, date, topic="food", upsert=True):
    sql = f"""INSERT INTO {TABLE}(user_id,language_code,topic_id,completed_at)
      VALUES ('{owner}','my','{topic}','{date}')"""
    if upsert:
        sql += " ON CONFLICT(user_id,language_code,topic_id) DO UPDATE SET completed_at=excluded.completed_at"
    return sql + ";"

def grant(email, revision, topic="food"):
    query(f"""BEGIN;
      UPDATE public.kg_chart_access_profiles SET mode='restricted',revision={revision} WHERE email='{email}';
      INSERT INTO public.kg_chart_access_languages(email,language_code)
        VALUES ('{email}','my') ON CONFLICT DO NOTHING;
      INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
        VALUES ('{email}','my','{topic}') ON CONFLICT DO NOTHING;
      INSERT INTO public.kg_chart_access_features(email,feature_key)
        VALUES ('{email}','quiz.words') ON CONFLICT DO NOTHING;
      COMMIT;""")

def expect_denied(sql):
    result = query(sql, check=False)
    if result.returncode == 0 or not any(msg in result.stderr.lower() for msg in (
        "row-level security", "unverified completion owner", "revoked completion authorization"
    )):
        raise RuntimeError("Expected completion authorization rejection: " + result.stderr)

def assert_saved(history, own=D3, other=D2):
    assert value(f"SELECT count(*) FROM {TABLE} WHERE {KEY} AND completed_at='{own}'::timestamptz;") == "1"
    assert value(f"SELECT count(*) FROM {TABLE} WHERE {OTHER_KEY} AND completed_at='{other}'::timestamptz;") == "1"
    assert value(f"SELECT to_jsonb(c)::text FROM {TABLE} c WHERE {OLD_KEY};") == history

def check_revision(operation, revision, topic, history):
    grant(EMAIL, revision, topic)
    blocker = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True)
    writer = None
    try:
        blocker.stdin.write("SELECT pg_advisory_lock(403291); SELECT 'ready';\n")
        blocker.stdin.flush()
        while blocker.stdout.readline().strip() != "ready":
            if blocker.poll() is not None:
                raise RuntimeError("Completion barrier connection failed")
        writer = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        writer.stdin.write(f"""SET application_name='kg_u4b2b_writer';
        {IDENTITY}
        BEGIN ISOLATION LEVEL REPEATABLE READ;
        DO $$ BEGIN
          IF public.kg_chart_u3b2_can_completion('my','{topic}') IS DISTINCT FROM true
          THEN RAISE EXCEPTION 'Expected initially permitted completion'; END IF;
        END $$;
        SELECT pg_advisory_xact_lock(403291);
        {operation}
        COMMIT;""")
        writer.stdin.close()
        writer.stdin = None
        wait_lock()
        query(f"""BEGIN;
          DELETE FROM public.kg_chart_access_topics WHERE email='{EMAIL}' AND language_code='my' AND topic_id='{topic}';
          UPDATE public.kg_chart_access_profiles SET revision={revision+1} WHERE email='{EMAIL}';
          COMMIT;""")
        blocker.stdin.write("SELECT pg_advisory_unlock(403291);\n")
        blocker.stdin.flush()
        _, err = writer.communicate(timeout=20)
        if writer.returncode == 0 or not any(msg in err.lower() for msg in (
            "could not serialize", "row-level security", "revoked completion authorization"
        )):
            raise RuntimeError("Expected stale completion rejection: " + err)
        assert_saved(history)
    finally:
        for proc in (writer, blocker):
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.wait(timeout=10)

def main():
    assert value("SELECT current_database();") == "kg_u4b2_fixture"
    history = value(f"SELECT to_jsonb(c)::text FROM {TABLE} c WHERE {OLD_KEY};")
    grant(EMAIL, 60)
    grant(OTHER_EMAIL, 60)
    query(IDENTITY + completion(UID, D1, upsert=False))
    query(OTHER_IDENTITY + completion(OTHER, D2, upsert=False))
    query(IDENTITY + f"UPDATE {TABLE} SET completed_at='{D2}' WHERE {KEY};")
    query(IDENTITY + completion(UID, D3))
    # A repeated completion at the same timestamp must not duplicate the row.
    query(IDENTITY + completion(UID, D3))
    assert_saved(history)
    for identity, own_key, other_key in (
        (IDENTITY, KEY, OTHER_KEY), (OTHER_IDENTITY, OTHER_KEY, KEY)
    ):
        assert value(identity + f"SELECT count(*) FROM {TABLE} WHERE {own_key};") == "1"
        assert value(identity + f"SELECT count(*) FROM {TABLE} WHERE {other_key};") == "0"
    expect_denied(IDENTITY + completion(OTHER, D5))
    expect_denied(IDENTITY + f"UPDATE {TABLE} SET user_id='{OTHER}' WHERE {KEY};")
    expect_denied(IDENTITY + completion(UID, D5, "friends_names", upsert=False))
    query(IDENTITY + f"UPDATE {TABLE} SET completed_at='{D5}' WHERE {OTHER_KEY};")
    # Keep the existing no-delete policy, including for the caller's own history.
    query(IDENTITY + f"DELETE FROM {TABLE} WHERE {KEY} OR {OTHER_KEY};")
    query(IDENTITY + f"BEGIN; UPDATE {TABLE} SET completed_at='{D4}' WHERE {KEY}; ROLLBACK;")
    assert_saved(history)
    print("U4B2_3C_INDEPENDENT_COMPLETIONS_PASS")
    for name, operation, revision in (
        ("UPDATE", f"UPDATE {TABLE} SET completed_at='{D4}' WHERE {KEY};", 62),
        ("UPSERT", completion(UID, D4), 64),
    ):
        check_revision(operation, revision, "food", history)
        print("U4B2_3C_" + name + "_REVISION_PASS")
    expect_denied(IDENTITY + completion(UID, D4))
    query(IDENTITY + f"UPDATE {TABLE} SET completed_at='{D4}' WHERE {KEY};")
    assert value(IDENTITY + f"SELECT count(*) FROM {TABLE} WHERE {KEY} AND completed_at='{D3}'::timestamptz;") == "1"
    # Check a genuinely new completion separately from an existing-row retry.
    colours_key = f"user_id='{UID}' AND language_code='my' AND topic_id='colours'"
    assert value(f"SELECT count(*) FROM {TABLE} WHERE {colours_key};") == "0"
    check_revision(completion(UID, D4, "colours", upsert=False), 66, "colours", history)
    assert value(f"SELECT count(*) FROM {TABLE} WHERE {colours_key};") == "0"
    expect_denied(IDENTITY + completion(UID, D4, "colours", upsert=False))
    print("U4B2_3C_NEW_COMPLETION_REVISION_PASS")
    # Other learner continues; only a fresh permitted operation changes the first.
    query(OTHER_IDENTITY + completion(OTHER, D4))
    assert_saved(history, other=D4)
    grant(EMAIL, 68)
    query(IDENTITY + completion(UID, D5))
    assert_saved(history, own=D5, other=D4)
    print("U4B2_3C_HISTORY_AND_INDEPENDENT_PROGRESS_PASS")
    print("U4B2_3C_FIXTURE_ONLY_NO_GO_FOR_RELEASE")

if __name__ == "__main__":
    main()
