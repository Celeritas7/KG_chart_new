-- Fictional history deliberately pre-dates private write restrictions.
-- It must remain stored after U3B3B1, but privileged history must not reveal
-- private content to an unauthorized legacy learner.
INSERT INTO public.kg_chart_quiz_sessions
 (id,user_id,language_code,topic_id,quiz_type,total_questions,correct_answers)
VALUES
 ('71000000-0000-4000-8000-000000000001',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','my','friends_names',
  'native_to_image',1,1),
 ('71000000-0000-4000-8000-000000000002',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','my','food',
  'native_to_image',1,1),
 ('71000000-0000-4000-8000-000000000003',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc','my','friends_names',
  'native_to_image',1,1);
INSERT INTO public.kg_chart_quiz_answers
 (id,session_id,vocabulary_id,is_correct,answered_at)
VALUES
 ('71000000-0000-4000-8000-000000000011',
  '71000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000004',true,now()),
 ('71000000-0000-4000-8000-000000000012',
  '71000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',true,now()),
 ('71000000-0000-4000-8000-000000000013',
  '71000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',true,now());
INSERT INTO public.kg_chart_user_ratings
 (user_id,vocabulary_id,language_code,rating)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '10000000-0000-4000-8000-000000000004','my',2);
INSERT INTO public.kg_chart_topic_completions
 (user_id,language_code,topic_id)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','my','friends_names');
