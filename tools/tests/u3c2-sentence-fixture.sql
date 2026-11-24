-- Synthetic only. No real private names, sentence texts or accounts.
-- Requires U1/U3A/U3B1/U3B2/U3B3A/U3B3B1 fake schemas.
-- Status=verified requires real reviewer ID, timestamp and evidence SHA.
INSERT INTO public.kg_chart_sentence_group_topic_map
 (language_code,group_name,topic_id,review_status,reviewed_by,reviewed_at,evidence_sha256)
VALUES
 ('my','food','food','verified',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),repeat('a',64)),
 ('my','private_conversation','friends_names','verified',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),repeat('b',64)),
 ('ja','animals','animals','draft',NULL,NULL,NULL);

-- Additional unrelated sentence group remains unmapped (fail closed).
INSERT INTO public.kg_chart_sentences(id,language_code,group_name,native_text)
VALUES ('87000000-0000-4000-8000-000000000001','my','unmapped_group','unmapped');

-- Prior fake sessions prove old progress remains intact even if the group
-- later becomes denied. This session is owned by student1, pre-activation.
INSERT INTO public.kg_chart_quiz_sessions(
  id,user_id,language_code,quiz_type,total_questions,correct_answers
) VALUES (
  '87000000-0000-4000-8000-000000000002',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','my','sentence_to_meaning',1,1
);
INSERT INTO public.kg_chart_quiz_answers(
  id,session_id,sentence_id,is_correct,answered_at
) VALUES (
  '87000000-0000-4000-8000-000000000003',
  '87000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',true,now()
);
