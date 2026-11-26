#!/usr/bin/env python3
"""U4B2B-3B: vocabulary ratings in the disposable KG CI fixture only."""
import runpy
import subprocess
from pathlib import Path

base = runpy.run_path(str(Path(__file__).with_name("u4b2b-revocation-race.py")))
query, value, wait_lock = (base[k] for k in ("query", "value", "wait_lock"))
CMD, UID, EMAIL, IDENTITY = (base[k] for k in ("CMD", "UID", "EMAIL", "IDENTITY"))
OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
OTHER_EMAIL = "student2@example.invalid"
OTHER_IDENTITY = IDENTITY.replace(UID, OTHER)
WORD = "10000000-0000-4000-8000-000000000001"
OLD_WORD = "10000000-0000-4000-8000-000000000003"
TABLE = "public.kg_chart_user_ratings"
KEY = f"user_id='{UID}' AND vocabulary_id='{WORD}' AND language_code='my'"
OTHER_KEY = KEY.replace(UID, OTHER)

def upsert(owner, rating):
    return f"""INSERT INTO {TABLE}(user_id,vocabulary_id,language_code,rating)
      VALUES ('{owner}','{WORD}','my',{rating})
      ON CONFLICT(user_id,vocabulary_id,language_code) DO UPDATE SET rating=excluded.rating;"""

def grant(email, revision):
    query(f"""BEGIN;
      UPDATE public.kg_chart_access_profiles SET mode='restricted',revision={revision} WHERE email='{email}';
      INSERT INTO public.kg_chart_access_languages(email,language_code)
        VALUES ('{email}','my') ON CONFLICT DO NOTHING;
      INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
        VALUES ('{email}','my','food') ON CONFLICT DO NOTHING;
      INSERT INTO public.kg_chart_access_features(email,feature_key)
        VALUES ('{email}','quiz.words') ON CONFLICT DO NOTHING;
      COMMIT;""")

def expect_denied(sql):
    result = query(sql, check=False)
    if result.returncode == 0 or not any(msg in result.stderr.lower() for msg in (
        "row-level security", "unverified rating owner", "revoked rating authorization"
    )):
        raise RuntimeError("Expected rating authorization rejection: " + result.stderr)

def assert_saved(own=4, other=2):
    assert value(f"SELECT rating FROM {TABLE} WHERE {KEY};") == str(own)
    assert value(f"SELECT rating FROM {TABLE} WHERE {OTHER_KEY};") == str(other)
    assert value(f"SELECT rating FROM {TABLE} WHERE user_id='{OTHER}' AND vocabulary_id='{OLD_WORD}' AND language_code='ja';") == "3"

def check_revision(operation, revision):
    grant(EMAIL, revision)
    blocker = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True)
    writer = None
    try:
        blocker.stdin.write("SELECT pg_advisory_lock(403291); SELECT 'ready';\n")
        blocker.stdin.flush()
        while blocker.stdout.readline().strip() != "ready":
            if blocker.poll() is not None:
                raise RuntimeError("Rating barrier connection failed")
        writer = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        writer.stdin.write(f"""SET application_name='kg_u4b2b_writer';
        {IDENTITY}
        BEGIN ISOLATION LEVEL REPEATABLE READ;
        DO $$ BEGIN
          IF public.kg_chart_u3b2_can_rating('my','{WORD}') IS DISTINCT FROM true
          THEN RAISE EXCEPTION 'Expected initially permitted rating'; END IF;
        END $$;
        SELECT pg_advisory_xact_lock(403291);
        {operation}
        COMMIT;""")
        writer.stdin.close()
        writer.stdin = None
        wait_lock()
        query(f"""BEGIN;
          DELETE FROM public.kg_chart_access_topics WHERE email='{EMAIL}' AND language_code='my' AND topic_id='food';
          UPDATE public.kg_chart_access_profiles SET revision={revision+1} WHERE email='{EMAIL}';
          COMMIT;""")
        blocker.stdin.write("SELECT pg_advisory_unlock(403291);\n")
        blocker.stdin.flush()
        _, err = writer.communicate(timeout=20)
        if writer.returncode == 0 or not any(msg in err.lower() for msg in (
            "could not serialize", "row-level security", "revoked rating authorization"
        )):
            raise RuntimeError("Expected stale rating rejection: " + err)
        assert_saved()
    finally:
        for proc in (writer, blocker):
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.wait(timeout=10)

def main():
    assert value("SELECT current_database();") == "kg_u4b2_fixture"
    grant(EMAIL, 50)
    grant(OTHER_EMAIL, 50)
    # Both learners may rate exactly the same granted word independently.
    query(IDENTITY + upsert(UID, 1))
    query(OTHER_IDENTITY + upsert(OTHER, 2))
    query(IDENTITY + f"UPDATE {TABLE} SET rating=3 WHERE {KEY};")
    query(IDENTITY + upsert(UID, 4))
    assert_saved()
    for identity, owner_key, other_key, expected in (
        (IDENTITY, KEY, OTHER_KEY, "4"), (OTHER_IDENTITY, OTHER_KEY, KEY, "2")
    ):
        assert value(identity + f"SELECT rating FROM {TABLE} WHERE {owner_key};") == expected
        assert value(identity + f"SELECT count(*) FROM {TABLE} WHERE {other_key};") == "0"
    # A foreign owner is never a valid destination; a foreign existing row is invisible.
    expect_denied(IDENTITY + upsert(OTHER, 5))
    expect_denied(IDENTITY + f"UPDATE {TABLE} SET user_id='{OTHER}' WHERE {KEY};")
    query(IDENTITY + f"UPDATE {TABLE} SET rating=5 WHERE {OTHER_KEY}; DELETE FROM {TABLE} WHERE {OTHER_KEY};")
    assert_saved()
    # An ordinary same-owner deletion remains available and rollback retains the rating.
    assert value(IDENTITY + f"BEGIN; DELETE FROM {TABLE} WHERE {KEY} RETURNING rating; ROLLBACK;") == "4"
    assert_saved()
    print("U4B2_3B_INDEPENDENT_RATINGS_PASS")
    for name, operation, revision in (
        ("UPDATE", f"UPDATE {TABLE} SET rating=5 WHERE {KEY};", 52),
        ("UPSERT", upsert(UID, 5), 54),
        ("DELETE", f"DELETE FROM {TABLE} WHERE {KEY};", 56),
    ):
        check_revision(operation, revision)
        print("U4B2_3B_" + name + "_REVISION_PASS")
    # Fresh revoked writes do not alter history; SELECT remains owner-scoped.
    expect_denied(IDENTITY + upsert(UID, 5))
    query(IDENTITY + f"UPDATE {TABLE} SET rating=5 WHERE {KEY}; DELETE FROM {TABLE} WHERE {KEY};")
    assert value(IDENTITY + f"SELECT rating FROM {TABLE} WHERE {KEY};") == "4"
    assert_saved()
    # The unaffected learner can keep studying; restore only the synthetic grant.
    query(OTHER_IDENTITY + upsert(OTHER, 3))
    assert_saved(other=3)
    grant(EMAIL, 58)
    query(IDENTITY + upsert(UID, 5))
    assert_saved(own=5, other=3)
    print("U4B2_3B_HISTORY_AND_INDEPENDENT_PROGRESS_PASS")
    print("U4B2_3B_FIXTURE_ONLY_NO_GO_FOR_RELEASE")

if __name__ == "__main__":
    main()
