-- U2 testing adapter: ONLY synthetic data, never execute against real Supabase.
-- U1 fixture is intentionally minimal; add the existing production column
-- that U2 checks, and a constant invented auth.uid to exercise audit ownership.
ALTER TABLE public.kg_chart_languages
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;
CREATE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT '11111111-1111-4111-8111-111111111111'::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT SELECT ON public.kg_chart_users,
  public.kg_chart_languages, public.kg_chart_topics,
  public.kg_chart_topic_translations TO authenticated;
