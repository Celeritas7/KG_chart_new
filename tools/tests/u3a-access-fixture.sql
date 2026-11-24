-- Disposable PostgreSQL-only fixtures for U3A. NO real Supabase Auth data.
-- Run AFTER tools/tests/u1-access-fixture.sql and U1 foundation SQL.
ALTER TABLE public.kg_chart_languages ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.kg_chart_languages ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.kg_chart_topics ADD COLUMN is_hidden boolean NOT NULL DEFAULT false;
CREATE TABLE public.kg_chart_settings(key text PRIMARY KEY,value jsonb NOT NULL);

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  email_confirmed_at timestamptz
);

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('kg_u3_test.uid',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

CREATE FUNCTION public.kg_chart_is_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $$
 SELECT public.kg_chart_is_admin() OR EXISTS (
   SELECT 1 FROM auth.users u
   JOIN public.kg_chart_users k ON k.email=lower(u.email)
   WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL
 );
$$;
GRANT EXECUTE ON FUNCTION public.kg_chart_is_allowed() TO authenticated;
-- The existing U1 admin stub uses 'kg_u1_test.admin', never actual admin data.

INSERT INTO public.kg_chart_users(email,role,name)
VALUES ('reviewer@example.invalid','reviewer','Synthetic reviewer');

INSERT INTO auth.users (id,email,email_confirmed_at) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin@example.invalid',now()),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','student1@example.invalid',now()),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','student2@example.invalid',now()),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','reviewer@example.invalid',now()),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','unapproved@example.invalid',now()),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','notconfirmed@example.invalid',NULL);

UPDATE public.kg_chart_languages SET is_active=false WHERE code='ja';
UPDATE public.kg_chart_languages SET sort_order=1 WHERE code='my';
UPDATE public.kg_chart_languages SET sort_order=2 WHERE code='ja';

INSERT INTO public.kg_chart_topic_translations(topic_id,language_code,title_native)
VALUES ('friends_names','my','Friends names');
UPDATE public.kg_chart_topics SET is_hidden=false;

INSERT INTO public.kg_chart_settings(key,value) VALUES
('private_lessons','[{"topic_id":"friends_names","language_code":"my",
                    "emails":["student2@example.invalid"]}]'::jsonb);
