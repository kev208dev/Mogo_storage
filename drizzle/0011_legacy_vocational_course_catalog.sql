-- Historical vocational course entries omitted from 0010 but present in the legacy-only app catalog.
INSERT INTO "courses" ("id", "code", "name", "subject", "display_order", "regimes") VALUES
  ('accounting-principles', 'accounting-principles', '회계 원리', 'vocational', 1000, '[{"regime":"legacy"}]'::jsonb),
  ('agriculture-understanding', 'agriculture-understanding', '농업 이해', 'vocational', 1001, '[{"regime":"legacy"}]'::jsonb),
  ('basic-drafting', 'basic-drafting', '기초 제도', 'vocational', 1002, '[{"regime":"legacy"}]'::jsonb),
  ('ocean-understanding', 'ocean-understanding', '해양의 이해', 'vocational', 1005, '[{"regime":"legacy"}]'::jsonb),
  ('service-industry-understanding', 'service-industry-understanding', '생활 서비스 산업의 이해', 'vocational', 1006, '[{"regime":"legacy"}]'::jsonb),
  ('agriculture-bio-industry', 'agriculture-bio-industry', '농생명산업', 'vocational', 1017, '[{"regime":"legacy"}]'::jsonb),
  ('commerce-information', 'commerce-information', '상업정보', 'vocational', 1018, '[{"regime":"legacy"}]'::jsonb),
  ('fisheries-shipping', 'fisheries-shipping', '수산해운', 'vocational', 1019, '[{"regime":"legacy"}]'::jsonb),
  ('home-economics-industry', 'home-economics-industry', '가사실업', 'vocational', 1020, '[{"regime":"legacy"}]'::jsonb),
  ('industry', 'industry', '공업', 'vocational', 1021, '[{"regime":"legacy"}]'::jsonb),
  ('agriculture-information', 'agriculture-information', '농업정보관리', 'vocational', 1027, '[{"regime":"legacy"}]'::jsonb),
  ('computer-general', 'computer-general', '컴퓨터일반', 'vocational', 1028, '[{"regime":"legacy"}]'::jsonb),
  ('design-general', 'design-general', '디자인일반', 'vocational', 1029, '[{"regime":"legacy"}]'::jsonb),
  ('fisheries-general', 'fisheries-general', '수산일반', 'vocational', 1033, '[{"regime":"legacy"}]'::jsonb),
  ('fisheries-shipping-information', 'fisheries-shipping-information', '수산해운정보처리', 'vocational', 1034, '[{"regime":"legacy"}]'::jsonb),
  ('food-and-nutrition', 'food-and-nutrition', '식품과영양', 'vocational', 1035, '[{"regime":"legacy"}]'::jsonb),
  ('industry-intro', 'industry-intro', '공업입문', 'vocational', 1036, '[{"regime":"legacy"}]'::jsonb),
  ('information-technology-basics', 'information-technology-basics', '정보기술기초', 'vocational', 1037, '[{"regime":"legacy"}]'::jsonb),
  ('maritime-general', 'maritime-general', '해사일반', 'vocational', 1040, '[{"regime":"legacy"}]'::jsonb),
  ('ocean-general', 'ocean-general', '해양일반', 'vocational', 1041, '[{"regime":"legacy"}]'::jsonb),
  ('programming', 'programming', '프로그래밍', 'vocational', 1043, '[{"regime":"legacy"}]'::jsonb)
ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "subject" = EXCLUDED."subject", "display_order" = EXCLUDED."display_order", "regimes" = EXCLUDED."regimes";
