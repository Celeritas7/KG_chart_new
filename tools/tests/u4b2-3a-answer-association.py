#!/usr/bin/env python3
"""U4B2B-3A: quiz-answer association tests in the disposable KG fixture only."""
import runpy
import subprocess
from pathlib import Path

base = runpy.run_path(str(Path(__file__).with_name("u4b2b-revocation-race.py")))
query, value, wait_lock = (base[k] for k in ("query", "value", "wait_lock"))
CMD, UID, EMAIL, IDENTITY = (base[k] for k in ("CMD", "UID", "EMAIL", "IDENTITY"))
SESSION = "99100000-0000-4000-8000-000000000001"
HISTORY = "99100000-0000-4000-8000-000000000002"
PENDING = "99100000-0000-4000-8000-000000000003"
WORD = "10000000-0000-4000-8000-000000000001"

def answer(aid, session=SESSION):
    return f"""INSERT INTO public.kg_chart_quiz_answers(id,session_id,vocabulary_id,is_correct)
    VALUES ('{aid}','{session}','{WORD}',true);"""

def expect_denied(sql):
    r = query(sql, check=False)
    if r.returncode == 0 or not any(s in r.stderr.lower() for s in (
        "row-level security", "unverified answer owner", "revoked answer authorization"
    )):
        raise RuntimeError("Expected answer authorization rejection: " + r.stderr)

def main():
    assert value("SELECT current_database();") == "kg_u4b2_fixture"
    query(f"""BEGIN;
      UPDATE public.kg_chart_access_profiles SET mode='restricted',revision=40 WHERE email='{EMAIL}';
      INSERT INTO public.kg_chart_access_languages(email,language_code) VALUES ('{EMAIL}','my');
      INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id) VALUES ('{EMAIL}','my','food');
      INSERT INTO public.kg_chart_access_features(email,feature_key) VALUES ('{EMAIL}','quiz.words');
      COMMIT;""")
    query(IDENTITY + f"""INSERT INTO public.kg_chart_quiz_sessions(id,user_id,language_code,topic_id,quiz_type)
      VALUES ('{SESSION}',auth.uid(),'my','food','native_to_image');""" + answer(HISTORY))
    # Other learner's existing synthetic parent session.
    expect_denied(IDENTITY + answer(PENDING, "50000000-0000-4000-8000-000000000001"))
    assert value(f"SELECT count(*) FROM public.kg_chart_quiz_answers WHERE id='{HISTORY}' AND session_id='{SESSION}';") == "1"
    print("U4B2_3A_OWN_ANSWER_PASS")
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
        IF public.kg_chart_u3b2_can_answer('{SESSION}','{WORD}',NULL) IS DISTINCT FROM true
          THEN RAISE EXCEPTION 'Expected initially permitted answer'; END IF;
        END $$;
        SELECT pg_advisory_xact_lock(403291);
        {answer(PENDING)}
        COMMIT;""")
        writer.stdin.close()
        writer.stdin = None
        wait_lock()
        query(f"""BEGIN;
          DELETE FROM public.kg_chart_access_topics WHERE email='{EMAIL}';
          UPDATE public.kg_chart_access_profiles SET revision=41 WHERE email='{EMAIL}';
          COMMIT;""")
        blocker.stdin.write("SELECT pg_advisory_unlock(403291);\n")
        blocker.stdin.flush()
        _, err = writer.communicate(timeout=20)
        if writer.returncode == 0 or not any(s in err.lower() for s in (
            "could not serialize", "row-level security", "revoked answer authorization"
        )):
            raise RuntimeError("Expected stale answer rejection: " + err)
        assert value(f"SELECT count(*) FROM public.kg_chart_quiz_answers WHERE id='{PENDING}';") == "0"
        expect_denied(IDENTITY + answer(PENDING))
        assert value(f"SELECT count(*) FROM public.kg_chart_quiz_answers WHERE id='{HISTORY}' AND session_id='{SESSION}';") == "1"
        print("U4B2_3A_REVOKED_ANSWER_REJECTED_HISTORY_PRESERVED")
    finally:
        for proc in (writer, blocker):
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.wait(timeout=10)
    print("U4B2_3A_FIXTURE_ONLY_NO_GO_FOR_RELEASE")

if __name__ == "__main__":
    main()
