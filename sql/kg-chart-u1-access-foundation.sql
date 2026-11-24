-- KG Chart U1: additive, opt-in permissions FOUNDATION (not the enforcement rollout).
-- REVIEW ONLY: never run automatically through GitHub, Cloudflare or the PWA.
-- Apply to Technical Supabase only after separate approval and database backup.
-- Existing kg_chart_users and its access function/policies are NOT modified.
-- The application and offline runtime do not query these tables until U2/U3.
--
-- Compatibility:
--   No profile -> existing (legacy) behavior.
--   Profile with mode='legacy' -> existing behavior; grants are draft data.
--   mode='restricted' is a FUTURE U3 contract, not enforced by this script.
--   Under U3 a restricted user only sees explicitly granted languages,
--   translated topics within those languages, and enabled features.
--   U3 must intersect with existing active topics, private lessons, unlocks,
--   and RLS; no grants imply NO access in restricted mode.
--
-- IMPORTANT: all U1 tables have RLS from creation, admin-only policies.
-- No learner can read or write another learner's permissions.
-- No privileges are granted to anon and no service keys are embedded.

BEGIN;
SELECT pg_advisory_xact_lock(hashtext('kg_chart_u1_access_foundation_v1'));

CREATE TABLE IF NOT EXISTS public.kg_chart_access_profiles (
  email text PRIMARY KEY REFERENCES public.kg_chart_users(email)
    ON UPDATE CASCADE ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'legacy' CHECK (mode IN ('legacy', 'restricted')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kg_chart_access_profiles_lower_email CHECK (email = lower(btrim(email)))
);

CREATE TABLE IF NOT EXISTS public.kg_chart_access_languages (
  email text NOT NULL REFERENCES public.kg_chart_access_profiles(email)
    ON UPDATE CASCADE ON DELETE CASCADE,
  language_code varchar NOT NULL REFERENCES public.kg_chart_languages(code)
    ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (email, language_code)
);

CREATE TABLE IF NOT EXISTS public.kg_chart_access_topics (
  email text NOT NULL,
  language_code varchar NOT NULL,
  topic_id varchar NOT NULL,
  PRIMARY KEY (email, language_code, topic_id),
  CONSTRAINT kg_u1_topics_selected_language_fk
    FOREIGN KEY (email, language_code)
    REFERENCES public.kg_chart_access_languages(email, language_code)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT kg_u1_topics_translation_fk
    FOREIGN KEY (topic_id, language_code)
    REFERENCES public.kg_chart_topic_translations(topic_id, language_code)
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- Stable, explicit feature keys matching the *current* app surfaces.
-- U2 may show human-readable labels. Future feature keys require review.
CREATE TABLE IF NOT EXISTS public.kg_chart_access_feature_catalog (
  feature_key text PRIMARY KEY
    CHECK (feature_key ~ '^[a-z][a-z0-9_.]*$'),
  family text NOT NULL CHECK (family IN ('navigation','quiz','offline')),
  label text NOT NULL CHECK (btrim(label) <> ''),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

INSERT INTO public.kg_chart_access_feature_catalog
  (feature_key, family, label, sort_order)
VALUES
  ('chart', 'navigation', 'Chart lessons', 10),
  ('cards', 'navigation', 'Flashcards', 20),
  ('progress', 'navigation', 'Progress', 30),
  ('quiz.words', 'quiz', 'Words quiz', 40),
  ('quiz.sentences', 'quiz', 'Sentences quiz', 50),
  ('quiz.typing', 'quiz', 'Typing practice', 60),
  ('quiz.speak', 'quiz', 'Speak / listen practice', 70),
  ('quiz.say', 'quiz', 'Pronunciation assessment', 80),
  ('quiz.colours', 'quiz', 'Colours quiz', 90),
  ('offline.pack', 'offline', 'Download/update offline language pack', 100)
ON CONFLICT (feature_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.kg_chart_access_features (
  email text NOT NULL REFERENCES public.kg_chart_access_profiles(email)
    ON UPDATE CASCADE ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES public.kg_chart_access_feature_catalog(feature_key)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  PRIMARY KEY (email, feature_key)
);

-- RLS is enabled on every table in the exposed public schema, immediately.
-- Only the server-recognized KG Chart admin can query/edit policies.
-- These policies deliberately do NOT expose other users' email addresses.
ALTER TABLE public.kg_chart_access_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kg_chart_access_languages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kg_chart_access_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kg_chart_access_feature_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kg_chart_access_features ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
  public.kg_chart_access_profiles,
  public.kg_chart_access_languages,
  public.kg_chart_access_topics,
  public.kg_chart_access_feature_catalog,
  public.kg_chart_access_features
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.kg_chart_access_profiles,
  public.kg_chart_access_languages,
  public.kg_chart_access_topics,
  public.kg_chart_access_feature_catalog,
  public.kg_chart_access_features
  TO authenticated, service_role;

DROP POLICY IF EXISTS kg_u1_admin_only ON public.kg_chart_access_profiles;
CREATE POLICY kg_u1_admin_only ON public.kg_chart_access_profiles
  FOR ALL TO authenticated
  USING ((SELECT public.kg_chart_is_admin()))
  WITH CHECK ((SELECT public.kg_chart_is_admin()));

DROP POLICY IF EXISTS kg_u1_admin_only ON public.kg_chart_access_languages;
CREATE POLICY kg_u1_admin_only ON public.kg_chart_access_languages
  FOR ALL TO authenticated
  USING ((SELECT public.kg_chart_is_admin()))
  WITH CHECK ((SELECT public.kg_chart_is_admin()));

DROP POLICY IF EXISTS kg_u1_admin_only ON public.kg_chart_access_topics;
CREATE POLICY kg_u1_admin_only ON public.kg_chart_access_topics
  FOR ALL TO authenticated
  USING ((SELECT public.kg_chart_is_admin()))
  WITH CHECK ((SELECT public.kg_chart_is_admin()));

DROP POLICY IF EXISTS kg_u1_admin_only ON public.kg_chart_access_feature_catalog;
CREATE POLICY kg_u1_admin_only ON public.kg_chart_access_feature_catalog
  FOR ALL TO authenticated
  USING ((SELECT public.kg_chart_is_admin()))
  WITH CHECK ((SELECT public.kg_chart_is_admin()));

DROP POLICY IF EXISTS kg_u1_admin_only ON public.kg_chart_access_features;
CREATE POLICY kg_u1_admin_only ON public.kg_chart_access_features
  FOR ALL TO authenticated
  USING ((SELECT public.kg_chart_is_admin()))
  WITH CHECK ((SELECT public.kg_chart_is_admin()));

-- There is intentionally NO INSERT/UPDATE/DELETE on kg_chart_users,
-- auth.users, progress, unlocks, private_lessons, or existing RLS policies.
-- No user-specific rows are inserted, migrated, or activated by U1.
COMMIT;
