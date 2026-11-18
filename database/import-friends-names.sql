-- REVIEWED DATA IMPORT ONLY: not run by builds or deployments.
-- Before running in the SAME SQL session, explicitly select the learner:
-- SELECT set_config('kg_chart.friends_learner_email', '<learner email>', false);
-- Reads saved names from Burmese Study; never embeds personal names in this repo.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('kg_chart_friends_names_import'));

DO $$
DECLARE learner text := lower(trim(current_setting('kg_chart.friends_learner_email', true)));
BEGIN
  IF learner IS NULL OR learner = '' OR NOT EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = learner) THEN
    RAISE EXCEPTION 'Set kg_chart.friends_learner_email to an existing learner before importing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.burmese_app_words WHERE lower(trim(source)) = 'friends') THEN
    RAISE EXCEPTION 'No explicitly tagged friends names found in Burmese Study';
  END IF;
  IF EXISTS (SELECT 1 FROM public.burmese_app_words WHERE lower(trim(source)) = 'friends'
    AND (coalesce(trim(burmese_word), '') = '' OR coalesce(trim(english_meaning), '') = '' OR length(english_meaning) > 200)) THEN
    RAISE EXCEPTION 'A friends entry has an empty spelling/name or an overlong label; review it first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kg_chart_settings WHERE key = 'private_lessons' AND jsonb_typeof(value) <> 'array') THEN
    RAISE EXCEPTION 'Unexpected private_lessons format; no data changed';
  END IF;
END $$;

INSERT INTO public.kg_chart_topics (id, icon, sort_order)
SELECT 'friends_names', '👥', coalesce(max(sort_order), 0) + 1 FROM public.kg_chart_topics
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.kg_chart_topic_translations (topic_id, language_code, title_native, question_english)
VALUES ('friends_names', 'my', 'သူငယ်ချင်းများ၏ နာမည်များ', 'How do you write your friend’s name?')
ON CONFLICT (topic_id, language_code) DO NOTHING;

-- Follow the app's existing personal-lesson menu filtering. This is UI filtering,
-- not new RLS: approved KG Chart users retain their existing database access.
INSERT INTO public.kg_chart_settings (key, value)
VALUES ('private_lessons', jsonb_build_array(jsonb_build_object(
  'topic_id', 'friends_names', 'language_code', 'my', 'sentence_groups', '[]'::jsonb,
  'emails', jsonb_build_array(lower(trim(current_setting('kg_chart.friends_learner_email')))))))
ON CONFLICT (key) DO UPDATE SET
  value = kg_chart_settings.value || excluded.value, updated_at = now()
WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(kg_chart_settings.value) r WHERE r->>'topic_id' = 'friends_names');

-- Make this extra practice available immediately to the selected learner.
-- Do not reset completion, change other topics or relax anyone else's locks.
INSERT INTO public.kg_chart_topic_unlocks (email, topic_id, language_code)
VALUES (lower(trim(current_setting('kg_chart.friends_learner_email'))), 'friends_names', 'my')
ON CONFLICT (email, topic_id, language_code) DO NOTHING;

INSERT INTO public.kg_chart_vocabulary (topic_id, english_text, image_filename, extra_data, sort_order)
SELECT 'friends_names', w.english_meaning, NULL,
  jsonb_build_object('source_table', 'burmese_app_words', 'source_id', w.id, 'content_type', 'person_name'), w.id
FROM public.burmese_app_words w
WHERE lower(trim(w.source)) = 'friends' AND NOT EXISTS (
  SELECT 1 FROM public.kg_chart_vocabulary v WHERE v.topic_id = 'friends_names'
    AND v.extra_data->>'source_table' = 'burmese_app_words' AND v.extra_data->>'source_id' = w.id::text
);

-- Repeat runs reuse UUIDs, keeping ratings and quiz history attached.
UPDATE public.kg_chart_vocabulary v SET english_text = w.english_meaning, updated_at = now()
FROM public.burmese_app_words w
WHERE lower(trim(w.source)) = 'friends' AND v.topic_id = 'friends_names'
  AND v.extra_data->>'source_table' = 'burmese_app_words' AND v.extra_data->>'source_id' = w.id::text
  AND v.english_text IS DISTINCT FROM w.english_meaning;

INSERT INTO public.kg_chart_vocabulary_translations (vocabulary_id, language_code, native_text, notes)
SELECT v.id, 'my', w.burmese_word, 'Saved spelling from Burmese Study (friends source).'
FROM public.burmese_app_words w JOIN public.kg_chart_vocabulary v
  ON v.topic_id = 'friends_names' AND v.extra_data->>'source_table' = 'burmese_app_words'
  AND v.extra_data->>'source_id' = w.id::text
WHERE lower(trim(w.source)) = 'friends'
ON CONFLICT (vocabulary_id, language_code) DO UPDATE SET native_text = excluded.native_text, updated_at = now()
WHERE kg_chart_vocabulary_translations.native_text IS DISTINCT FROM excluded.native_text;

-- A read-back result for the operator; no deletion or source-table modification.
SELECT v.id, v.english_text, t.native_text, v.extra_data->>'source_id' AS burmese_source_id
FROM public.kg_chart_vocabulary v JOIN public.kg_chart_vocabulary_translations t ON t.vocabulary_id = v.id
WHERE v.topic_id = 'friends_names' AND t.language_code = 'my' ORDER BY v.sort_order;
COMMIT;
