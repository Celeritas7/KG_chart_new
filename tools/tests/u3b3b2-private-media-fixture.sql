-- U3B3B2 fictional private-media fixtures only; no Storage bucket/objects.
-- Run after the U1/U3A/U3B1/U3B2/U3B3A/U3B3B1 synthetic source fixtures.
-- Use the exact columns present in production for related source records.
ALTER TABLE public.kg_chart_vocabulary
  ADD COLUMN IF NOT EXISTS image_filename text;
ALTER TABLE public.kg_chart_topic_translations
  ADD COLUMN IF NOT EXISTS question_native text;
UPDATE public.kg_chart_vocabulary
  SET image_filename='friend.jpg'
  WHERE id='10000000-0000-4000-8000-000000000004';
UPDATE public.kg_chart_vocabulary
  SET image_filename='food.jpg'
  WHERE id='10000000-0000-4000-8000-000000000001';
UPDATE public.kg_chart_topic_translations
  SET question_native='friends-question'
  WHERE topic_id='friends_names' AND language_code='my';
UPDATE public.kg_chart_topic_translations
  SET question_native='food-question'
  WHERE topic_id='food' AND language_code='my';

-- Asset IDs are fictional opaque UUIDs; private object path is computed
-- by the trusted Edge signer and is never provided from caller input.
INSERT INTO public.kg_chart_private_media_assets
(asset_id,source_type,source_id,topic_id,language_code,voice,mime_type,
 expected_native_text,expected_image_filename,classification,state,
 byte_size,sha256_hex,verified_at,verifier_receipt_sha256)
VALUES
('81000000-0000-4000-8000-000000000001',
 'word_audio','10000000-0000-4000-8000-000000000004',NULL,'my','m','audio/mpeg',
 'my-private-friend',NULL,'private_exclusive','verified',1024,
 repeat('a',64),now(),repeat('b',64)),
('81000000-0000-4000-8000-000000000002',
 'topic_audio',NULL,'friends_names','my','f','audio/mpeg',
 'friends-question',NULL,'private_exclusive','verified',1024,
 repeat('a',64),now(),repeat('b',64)),
('81000000-0000-4000-8000-000000000003',
 'sentence_audio','20000000-0000-4000-8000-000000000003',NULL,'my','m','audio/mpeg',
 'my-secret-line',NULL,'private_exclusive','verified',1024,
 repeat('a',64),now(),repeat('b',64)),
('81000000-0000-4000-8000-000000000004',
 'word_image','10000000-0000-4000-8000-000000000004',NULL,'my',NULL,'image/jpeg',
 NULL,'friend.jpg','private_exclusive','verified',1024,
 repeat('a',64),now(),repeat('b',64)),
('81000000-0000-4000-8000-000000000005',
 'word_audio','10000000-0000-4000-8000-000000000001',NULL,'my','m','audio/mpeg',
 'my-food',NULL,'shared','staged',NULL,NULL,NULL,NULL),
('81000000-0000-4000-8000-000000000006',
 'word_audio','10000000-0000-4000-8000-000000000001',NULL,'my','f','audio/mpeg',
 'stale-food-text',NULL,'private_exclusive','verified',1024,
 repeat('a',64),now(),repeat('b',64)),
('81000000-0000-4000-8000-000000000007',
 'colour_audio','30000000-0000-4000-8000-000000000001',NULL,'my','f','audio/mpeg',
 'my-coloured-food',NULL,'private_exclusive','verified',1024,
 repeat('a',64),now(),repeat('b',64)),
('81000000-0000-4000-8000-000000000008',
 'topic_audio',NULL,'food','my','f','audio/mpeg',
 'food-question',NULL,'private_exclusive','verified',1024,
 repeat('a',64),now(),repeat('b',64));
