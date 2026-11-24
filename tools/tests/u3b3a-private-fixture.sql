-- U3B3A synthetic test fixture. No real user data or secrets.
-- Apply after U1/U3A/U3B1/U3B2 isolated fixtures and SQL.
-- The real private_lessons payload contains both a topic_id and groups;
-- the test uses fictional emails, a private topic and private conversation.
INSERT INTO public.kg_chart_access_profiles(email,mode,revision)
VALUES ('student1@example.invalid','legacy',3),
       ('student2@example.invalid','legacy',4);

-- Preserve original unowned flag (inserted by synthetic fixture).
-- A new flag's reporter must be stamped from verified auth.uid only.

-- Deliberately add extra overly permissive SELECT rules on fake source tables.
-- New RESTRICTIVE predicates must defeat them and prevent legacy leakage.
CREATE POLICY kg_u3b3a_test_public_topics ON public.kg_chart_topics
  FOR SELECT TO authenticated USING (true);
CREATE POLICY kg_u3b3a_test_public_words ON public.kg_chart_vocabulary
  FOR SELECT TO authenticated USING (true);
CREATE POLICY kg_u3b3a_test_public_settings ON public.kg_chart_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY kg_u3b3a_test_public_flags ON public.kg_chart_flags
  FOR SELECT TO authenticated USING (true);
