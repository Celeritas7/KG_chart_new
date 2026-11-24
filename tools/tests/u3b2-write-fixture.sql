-- U3B2 synthetic PostgreSQL write/policy fixture. No live learner data.
-- Run after U1 + U3A auth + U3B1 content fixtures and U3B1 SQL.
CREATE TABLE public.kg_chart_quiz_sessions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  language_code varchar NOT NULL,
  topic_id varchar,
  quiz_type varchar NOT NULL,
  total_questions int NOT NULL DEFAULT 0,
  correct_answers int NOT NULL DEFAULT 0,
  difficulty smallint,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.kg_chart_quiz_answers(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.kg_chart_quiz_sessions(id),
  vocabulary_id uuid REFERENCES public.kg_chart_vocabulary(id),
  sentence_id uuid REFERENCES public.kg_chart_sentences(id),
  selected_vocabulary_id text,
  is_correct boolean,
  answer_text text,
  answered_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.kg_chart_user_ratings(
  user_id uuid NOT NULL,
  vocabulary_id uuid NOT NULL REFERENCES public.kg_chart_vocabulary(id),
  language_code varchar NOT NULL,
  rating integer,
  PRIMARY KEY(user_id,vocabulary_id,language_code)
);
CREATE TABLE public.kg_chart_topic_completions(
  user_id uuid NOT NULL,language_code text NOT NULL,topic_id text NOT NULL,
  completed_at timestamptz DEFAULT now(),
  PRIMARY KEY(user_id,language_code,topic_id)
);
CREATE TABLE public.kg_chart_user_levels(
  email text NOT NULL,language_code varchar NOT NULL,
  level smallint NOT NULL DEFAULT 1,unlocked smallint NOT NULL DEFAULT 1,
  updated_at timestamptz DEFAULT now(), PRIMARY KEY(email,language_code)
);

ALTER TABLE public.kg_chart_flags
  ADD COLUMN sentence_id uuid REFERENCES public.kg_chart_sentences(id),
  ADD COLUMN colour_phrase_id uuid REFERENCES public.kg_chart_colour_phrases(id),
  ADD COLUMN status varchar DEFAULT 'open';

-- Mock the verified email in the real auth.jwt()-based levels policy.
CREATE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
  AS $
    SELECT jsonb_build_object('email',u.email)
    FROM auth.users AS u WHERE u.id=auth.uid()
  $;
GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;

-- Existing RLS contracts, modeled using the actual verified production names.
ALTER TABLE public.kg_chart_quiz_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kg_chart_quiz_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kg_chart_user_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kg_chart_topic_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kg_chart_user_levels ENABLE ROW LEVEL SECURITY;

GRANT SELECT,INSERT,UPDATE,DELETE ON public.kg_chart_quiz_sessions,
  public.kg_chart_quiz_answers,public.kg_chart_user_ratings,
  public.kg_chart_topic_completions,public.kg_chart_user_levels TO authenticated;
GRANT INSERT ON public.kg_chart_flags TO authenticated;
GRANT SELECT ON public.kg_chart_flags TO authenticated;

CREATE POLICY sessions_read ON public.kg_chart_quiz_sessions FOR SELECT TO authenticated
  USING (user_id=auth.uid() OR public.kg_chart_is_admin());
CREATE POLICY sessions_insert ON public.kg_chart_quiz_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id=auth.uid() AND public.kg_chart_is_allowed());

CREATE POLICY answers_read ON public.kg_chart_quiz_answers FOR SELECT TO authenticated
  USING (public.kg_chart_is_admin() OR EXISTS(
    SELECT 1 FROM public.kg_chart_quiz_sessions s
    WHERE s.id=session_id AND s.user_id=auth.uid()
  ));
CREATE POLICY answers_insert ON public.kg_chart_quiz_answers FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_is_allowed() AND EXISTS(
    SELECT 1 FROM public.kg_chart_quiz_sessions s
    WHERE s.id=session_id AND s.user_id=auth.uid()
  ));

CREATE POLICY ratings_read ON public.kg_chart_user_ratings FOR SELECT TO authenticated
  USING (user_id=auth.uid() OR public.kg_chart_is_admin());
CREATE POLICY ratings_insert ON public.kg_chart_user_ratings FOR INSERT TO authenticated
  WITH CHECK (user_id=auth.uid() AND public.kg_chart_is_allowed());
CREATE POLICY ratings_update ON public.kg_chart_user_ratings FOR UPDATE TO authenticated
  USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid() AND public.kg_chart_is_allowed());
CREATE POLICY ratings_delete ON public.kg_chart_user_ratings FOR DELETE TO authenticated
  USING(user_id=auth.uid());

CREATE POLICY completions_read ON public.kg_chart_topic_completions FOR SELECT TO authenticated
  USING (user_id=auth.uid() OR public.kg_chart_is_admin());
CREATE POLICY completions_insert ON public.kg_chart_topic_completions FOR INSERT TO authenticated
  WITH CHECK (user_id=auth.uid() AND public.kg_chart_is_allowed());
CREATE POLICY completions_update ON public.kg_chart_topic_completions FOR UPDATE TO authenticated
  USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid() AND public.kg_chart_is_allowed());

CREATE POLICY levels_read ON public.kg_chart_user_levels FOR SELECT TO authenticated
  USING (email=lower(auth.jwt()->>'email'));
CREATE POLICY levels_insert ON public.kg_chart_user_levels FOR INSERT TO authenticated
  WITH CHECK (public.kg_chart_is_allowed() AND
    email=lower(auth.jwt()->>'email'));
CREATE POLICY levels_update ON public.kg_chart_user_levels FOR UPDATE TO authenticated
  USING(email=lower(auth.jwt()->>'email'))
  WITH CHECK(email=lower(auth.jwt()->>'email'));

-- U3B1 test fixture's original flags policy grants SELECT only. Add old
-- expected report-writing policy without modifying production schema.
CREATE POLICY flags_report ON public.kg_chart_flags FOR INSERT TO authenticated
  WITH CHECK(status='open' AND public.kg_chart_is_allowed());

-- Fake test-only helper follows existing numeric defaults.
CREATE FUNCTION public.kg_chart_rule_int(
  p_rules jsonb,p_lang text,p_field text,p_default integer,
  p_lo integer,p_hi integer
) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT p_default $$;
GRANT EXECUTE ON FUNCTION public.kg_chart_rule_int(
  jsonb,text,text,integer,integer,integer) TO authenticated;

-- Existing private sentence group belongs to a different learner.
INSERT INTO public.kg_chart_sentences
  (id,language_code,group_name,native_text)
VALUES ('20000000-0000-4000-8000-000000000003',
        'my','private_conversation','my-secret-line');
UPDATE public.kg_chart_settings
  SET value = '[{"topic_id":"friends_names","language_code":"my",
                 "sentence_groups":["private_conversation"],
                 "emails":["student2@example.invalid"]}]'::jsonb
WHERE key='private_lessons';

-- Seed old history before revocation, for tests proving SELECT preservation
-- and rejecting new unauthorized events. User 2 has no U3B2 grants later.
INSERT INTO public.kg_chart_quiz_sessions
  (id,user_id,language_code,topic_id,quiz_type,total_questions,correct_answers)
VALUES ('50000000-0000-4000-8000-000000000001',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc','ja','animals',
        'native_to_image',1,1);
INSERT INTO public.kg_chart_quiz_answers
  (id,session_id,vocabulary_id,is_correct,answered_at)
VALUES ('50000000-0000-4000-8000-000000000002',
        '50000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000003',true,now());
INSERT INTO public.kg_chart_user_ratings
  (user_id,vocabulary_id,language_code,rating)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        '10000000-0000-4000-8000-000000000003','ja',3);
INSERT INTO public.kg_chart_topic_completions
  (user_id,language_code,topic_id)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','ja','animals');

-- Deliberately permissive extra write policies in this *synthetic* DB only.
-- A new RESTRICTIVE policy must defeat them when a user is denied.
CREATE POLICY synthetic_bad_insert ON public.kg_chart_quiz_sessions
  FOR INSERT TO authenticated WITH CHECK(true);
CREATE POLICY synthetic_bad_rating ON public.kg_chart_user_ratings
  FOR INSERT TO authenticated WITH CHECK(true);
