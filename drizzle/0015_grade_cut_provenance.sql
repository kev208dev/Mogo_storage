ALTER TYPE grade_cut_source ADD VALUE IF NOT EXISTS 'jongro';
ALTER TYPE grade_cut_source ADD VALUE IF NOT EXISTS 'etoos';
ALTER TYPE grade_cut_source ADD VALUE IF NOT EXISTS 'jinhak';
ALTER TYPE grade_cut_source ADD VALUE IF NOT EXISTS 'uway';
ALTER TYPE grade_cut_source ADD VALUE IF NOT EXISTS 'kimyoungil';

ALTER TABLE grade_cuts
  ADD COLUMN provider_status text NOT NULL DEFAULT 'provider_estimate',
  ADD COLUMN provider_label text,
  ADD COLUMN observed_via grade_cut_source,
  ADD COLUMN first_party boolean NOT NULL DEFAULT false,
  ADD COLUMN score_basis text NOT NULL DEFAULT 'raw',
  ADD COLUMN parser_version text NOT NULL DEFAULT 'legacy';

UPDATE grade_cuts SET
  provider_label = CASE source
    WHEN 'official' THEN '공식'
    WHEN 'megastudy' THEN '메가스터디 예상'
    WHEN 'daesung' THEN '대성 예상'
    WHEN 'ebs' THEN 'EBS 예상'
  END,
  observed_via = source,
  first_party = source <> 'official',
  provider_status = CASE WHEN is_official THEN 'official_final' ELSE 'provider_estimate' END;

ALTER TABLE grade_cut_snapshots
  ADD COLUMN provider_status text NOT NULL DEFAULT 'provider_estimate',
  ADD COLUMN provider_label text,
  ADD COLUMN observed_via grade_cut_source,
  ADD COLUMN first_party boolean NOT NULL DEFAULT false,
  ADD COLUMN score_basis text NOT NULL DEFAULT 'raw',
  ADD COLUMN parser_version text NOT NULL DEFAULT 'legacy';

UPDATE grade_cut_snapshots SET
  provider_label = CASE source
    WHEN 'official' THEN '공식'
    WHEN 'megastudy' THEN '메가스터디 예상'
    WHEN 'daesung' THEN '대성 예상'
    WHEN 'ebs' THEN 'EBS 예상'
    WHEN 'jongro' THEN '종로학원'
    WHEN 'etoos' THEN '이투스'
    WHEN 'jinhak' THEN '진학사'
    WHEN 'uway' THEN '유웨이'
    WHEN 'kimyoungil' THEN '김영일교육컨설팅'
  END,
  observed_via = source,
  first_party = source <> 'official',
  provider_status = CASE WHEN source = 'official' THEN 'official_final' ELSE 'provider_estimate' END;
