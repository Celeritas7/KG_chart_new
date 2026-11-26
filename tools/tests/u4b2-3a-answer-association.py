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
OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
OTHER_EMAIL = "student2@example.invalid"
OTHER_IDENTITY = IDENTITY.replace(UID, OTHER)
OTHER_SESSION = "99100000-0000-4000-8000-000000000004"
OTHER_HISTORY = "99100000-0000-4000-8000-000000000005"
CROSS_A = "99100000-0000-4000-8000-000000000006"
CROSS_B = "99100000-0000-4000-8000-000000000007"

def answer(aid, session=SESSION):
    return f"""INSERT INTO public.kg_chart_quiz_answers(id,session_id,vocabulary_id,is_correct)
    VALUES ('{aid}','{session}','{WORD}',true);"""

def expect_denied(sql):
    r = query(sql, check=False)
    if r.returncode == 0 or not any(s in r.stderr.lower() for s in (
        "row-level security", "unverified answer owner", "revoked answer authorization"
    )):
        raise RuntimeError("Expected answer authorization rejection: " + r.stderr)

def expect_owner_denied(identity, aid, parent):
    # Demand the precise guard failure, not an unrelated grant, FK or duplicate error.
    result = query("\\set VERBOSITY verbose\n" + identity + answer(aid, parent), check=False)
    err = result.stderr.lower()
    if result.returncode == 0 or "42501" not in err or "unverified answer owner" not in err:
        raise RuntimeError("Expected exact foreign-parent ownership rejection: " + result.stderr)
    assert value(f"SELECT count(*) FROM public.kg_chart_quiz_answers WHERE id='{aid}';") == "0"

def own_answer_count(aid, parent):
    return value(f"SELECT count(*) FROM public.kg_chart_quiz_answers WHERE id='{aid}' AND session_id='{parent}';")

def main():
    assert value("SELECT current_database();") == "kg_u4b2_fixture"
    query(f"""BEGIN;
      UPDATE public.kg_chart_access_profiles SET mode='restricted',revision=40
        WHERE email IN ('{EMAIL}','{OTHER_EMAIL}');
      INSERT INTO public.kg_chart_access_languages(email,language_code)
        VALUES ('{EMAIL}','my'),('{OTHER_EMAIL}','my');
      INSERT INTO public.kg_chart_access_topics(email,language_code,topic_id)
        VALUES ('{EMAIL}','my','food'),('{OTHER_EMAIL}','my','food');
      INSERT INTO public.kg_chart_access_features(email,feature_key)
        VALUES ('{EMAIL}','quiz.words'),('{OTHER_EMAIL}','quiz.words');
      COMMIT;""")
    # Create two genuine, independently authorized parent sessions with
    # identical language, topic and quiz mode. The same public word is valid
    # for each caller. No pre-existing Japanese/animals grant can mask ownership.
    for identity, uid, parent, history in (
        (IDENTITY, UID, SESSION, HISTORY),
        (OTHER_IDENTITY, OTHER, OTHER_SESSION, OTHER_HISTORY),
    ):
        assert value(identity + "SELECT public.kg_chart_u3b2_can_quiz_session('my','food','native_to_image');") == "t"
        assert value(identity + f"SELECT public.kg_chart_u3b1_can_vocab_translation('my','{WORD}');") == "t"
        query(identity + f"""INSERT INTO public.kg_chart_quiz_sessions(id,user_id,language_code,topic_id,quiz_type)
          VALUES ('{parent}',auth.uid(),'my','food','native_to_image');""")
        assert value(f"""SELECT count(*) FROM public.kg_chart_quiz_sessions
          WHERE id='{parent}' AND user_id='{uid}' AND language_code='my'
            AND topic_id='food' AND quiz_type='native_to_image';""") == "1"
        assert value(identity + f"SELECT public.kg_chart_u3b2_can_answer('{parent}','{WORD}',NULL);") == "t"
        assert value(identity + f"SELECT public.kg_chart_u3b3b1_can_private_answer('{parent}','{WORD}',NULL);") == "t"
        query(identity + answer(history, parent))
        assert own_answer_count(history, parent) == "1"

    for identity, foreign_parent, own_parent, aid in (
        (IDENTITY, OTHER_SESSION, SESSION, CROSS_A),
        (OTHER_IDENTITY, SESSION, OTHER_SESSION, CROSS_B),
    ):
        expect_owner_denied(identity, aid, foreign_parent)
        # Exact same ID, word and result, with only the parent changed:
        # a fresh authorized write must succeed, so the denial is discriminating.
        query(identity + answer(aid, own_parent))
        assert own_answer_count(aid, own_parent) == "1"
        assert own_answer_count(aid, foreign_parent) == "0"
    assert own_answer_count(HISTORY, SESSION) == "1"
    assert own_answer_count(OTHER_HISTORY, OTHER_SESSION) == "1"
    print("U4B2_F5_SAME_SCOPE_FOREIGN_PARENT_REJECTED_BOTH_DIRECTIONS")
    # Keep the historical different-scope negative case as a separate check.
    expect_denied(IDENTITY + answer(PENDING, "50000000-0000-4000-8000-000000000001"))
    assert own_answer_count(HISTORY, SESSION) == "1"
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
        assert own_answer_count(CROSS_A, SESSION) == "1"
        assert own_answer_count(OTHER_HISTORY, OTHER_SESSION) == "1"
        assert own_answer_count(CROSS_B, OTHER_SESSION) == "1"
        print("U4B2_3A_REVOKED_ANSWER_REJECTED_HISTORY_PRESERVED")
    finally:
        for proc in (writer, blocker):
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.wait(timeout=10)
    print("U4B2_3A_FIXTURE_ONLY_NO_GO_FOR_RELEASE")

if __name__ == "__main__":
    main()
