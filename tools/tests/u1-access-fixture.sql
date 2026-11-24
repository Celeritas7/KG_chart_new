-- U1 CI: fictional schema fixture ONLY, in disposable network-disabled PostgreSQL.
-- This deliberately does NOT read Supabase Technical or any real learner records.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;

CREATE TABLE public.kg_chart_users (
  id integer generated always as identity primary key,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  role text NOT NULL DEFAULT 'operator'
    CHECK (role IN ('admin','operator','reviewer')),
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.kg_chart_languages (
  code varchar PRIMARY KEY,
  name_english text NOT NULL
);
CREATE TABLE public.kg_chart_topics (
  id varchar PRIMARY KEY,
  sort_order integer DEFAULT 0
);
CREATE TABLE public.kg_chart_topic_translations (
  topic_id varchar NOT NULL REFERENCES public.kg_chart_topics(id),
  language_code varchar NOT NULL REFERENCES public.kg_chart_languages(code),
  title_native text NOT NULL,
  PRIMARY KEY (topic_id, language_code)
);

-- Simplified TEST-ONLY admin identity stub. Production's function uses auth.uid.
-- Production U1 SQL MUST NOT replace the real kg_chart_is_admin function.
CREATE FUNCTION public.kg_chart_is_admin()
RETURNS boolean LANGUAGE sql STABLE
AS $$ SELECT current_setting('kg_u1_test.admin', true) = 'yes'; $$;

INSERT INTO public.kg_chart_users(email,role,name) VALUES
 ('admin@example.invalid','admin','Synthetic administrator'),
 ('student1@example.invalid','operator','Synthetic learner 1'),
 ('student2@example.invalid','operator','Synthetic learner 2');
INSERT INTO public.kg_chart_languages(code,name_english) VALUES
 ('my','Burmese'),('ja','Japanese');
INSERT INTO public.kg_chart_topics(id,sort_order) VALUES
 ('food',1),('colours',2),('animals',3),('friends_names',4);
INSERT INTO public.kg_chart_topic_translations(topic_id,language_code,title_native)
 VALUES
 ('food','my','Food in Burmese'),('colours','my','Colours in Burmese'),
 ('animals','ja','Animals in Japanese'),('friends_names','my','Friends names in Burmese');
