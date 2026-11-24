-- U3B1 disposable RLS fixture; append AFTER U1 fixture, U1 schema
-- and U3A invented auth fixture. No production secrets or real learner names.
UPDATE public.kg_chart_languages SET is_active=true WHERE code='ja';
INSERT INTO public.kg_chart_languages(code,name_english,is_active,sort_order)
VALUES ('th','Thai',false,3);
INSERT INTO public.kg_chart_topic_translations(topic_id,language_code,title_native)
VALUES ('food','ja','Food (Japanese)'), ('food','th','Food (Thai)');

CREATE TABLE public.kg_chart_vocabulary(
  id uuid PRIMARY KEY,topic_id varchar REFERENCES public.kg_chart_topics(id),
  english_text text
);
CREATE TABLE public.kg_chart_vocabulary_translations(
  vocabulary_id uuid REFERENCES public.kg_chart_vocabulary(id),
  language_code varchar REFERENCES public.kg_chart_languages(code),
  native_text text,
  PRIMARY KEY(vocabulary_id,language_code)
);
CREATE TABLE public.kg_chart_sentences(
  id uuid PRIMARY KEY,language_code text,group_name text,
  native_text text
);
CREATE TABLE public.kg_chart_colour_phrases(
  id uuid PRIMARY KEY,language_code varchar,
  colour_id uuid REFERENCES public.kg_chart_vocabulary(id),
  noun_id uuid REFERENCES public.kg_chart_vocabulary(id),
  native_text text
);
CREATE TABLE public.kg_chart_flags(
  id uuid PRIMARY KEY,language_code varchar,
  vocabulary_id uuid REFERENCES public.kg_chart_vocabulary(id),
  notes text
);

INSERT INTO public.kg_chart_vocabulary(id,topic_id,english_text) VALUES
 ('10000000-0000-4000-8000-000000000001','food','food'),
 ('10000000-0000-4000-8000-000000000002','colours','colour'),
 ('10000000-0000-4000-8000-000000000003','animals','animal'),
 ('10000000-0000-4000-8000-000000000004','friends_names','private friend');
INSERT INTO public.kg_chart_vocabulary_translations(vocabulary_id,language_code,native_text) VALUES
 ('10000000-0000-4000-8000-000000000001','my','my-food'),
 ('10000000-0000-4000-8000-000000000001','ja','ja-food'),
 ('10000000-0000-4000-8000-000000000001','th','th-food'),
 ('10000000-0000-4000-8000-000000000002','my','my-colour'),
 ('10000000-0000-4000-8000-000000000003','ja','ja-animal'),
 ('10000000-0000-4000-8000-000000000004','my','my-private-friend');
INSERT INTO public.kg_chart_sentences(id,language_code,group_name,native_text) VALUES
 ('20000000-0000-4000-8000-000000000001','my','food','my-sentence'),
 ('20000000-0000-4000-8000-000000000002','ja','animals','ja-sentence');
INSERT INTO public.kg_chart_colour_phrases(id,language_code,colour_id,noun_id,native_text) VALUES
 ('30000000-0000-4000-8000-000000000001','my','10000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000001','my-coloured-food');
INSERT INTO public.kg_chart_flags(id,language_code,vocabulary_id,notes) VALUES
 ('40000000-0000-4000-8000-000000000001','my','10000000-0000-4000-8000-000000000004','private note');
INSERT INTO public.kg_chart_settings(key,value)
VALUES ('unlock_rules','{}'::jsonb),('admin_bypass_lock','false'::jsonb);

-- Mirror current production's permissive "allowed_read" baseline.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'kg_chart_languages','kg_chart_topics','kg_chart_topic_translations',
    'kg_chart_vocabulary','kg_chart_vocabulary_translations',
    'kg_chart_sentences','kg_chart_colour_phrases','kg_chart_settings',
    'kg_chart_flags'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',table_name);
    EXECUTE format('CREATE POLICY allowed_read ON public.%I FOR SELECT TO authenticated USING (public.kg_chart_is_allowed())',table_name);
  END LOOP;
END $$;
