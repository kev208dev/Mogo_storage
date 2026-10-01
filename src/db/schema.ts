import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { CONCEPT_SOURCES, CONCEPT_STATUSES } from "../lib/concepts";
import {
  STUDY_MATERIAL_ORIGINS,
  STUDY_MATERIAL_STATUSES,
  TRANSCRIPT_ORIGINS,
  VOCABULARY_PROVENANCES,
} from "../lib/study";
import {
  ARTIFACT_DELIVERY_POLICIES,
  ARTIFACT_ORIGINS,
  EXAM_SOURCE_KINDS,
  EXAM_TYPES,
  FILE_DELIVERY_TYPES,
  FILE_TYPES,
  GRADE_CUT_SOURCES,
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  SUBJECTS,
} from "../lib/constants";
import {
  EXAM_SCHEDULE_STATUSES,
  INGESTION_MODES,
  INGESTION_RUN_STATUSES,
  JOB_STATUSES,
  JOB_TYPES,
  SOURCE_ARTIFACT_STATUSES,
  SOURCE_HEALTH_STATUSES,
  VOCABULARY_CANDIDATE_STATUSES,
} from "../ingestion/constants";
import type { GradeCutEntry, TranscriptLine } from "../lib/data/types";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const examTypeEnum = pgEnum("exam_type", EXAM_TYPES);
export const subjectEnum = pgEnum("subject", SUBJECTS);
export const fileTypeEnum = pgEnum("file_type", FILE_TYPES);
export const gradeCutSourceEnum = pgEnum("grade_cut_source", GRADE_CUT_SOURCES);
export const reportCategoryEnum = pgEnum("report_category", REPORT_CATEGORIES);
export const reportStatusEnum = pgEnum("report_status", REPORT_STATUSES);
export const sourceKindEnum = pgEnum("exam_source_kind", EXAM_SOURCE_KINDS);
export const deliveryPolicyEnum = pgEnum("artifact_delivery_policy", ARTIFACT_DELIVERY_POLICIES);
export const fileDeliveryTypeEnum = pgEnum("file_delivery_type", FILE_DELIVERY_TYPES);
export const artifactOriginEnum = pgEnum("artifact_origin", ARTIFACT_ORIGINS);
export const sourceHealthEnum = pgEnum("source_health_status", SOURCE_HEALTH_STATUSES);
export const sourceArtifactStatusEnum = pgEnum("source_artifact_status", SOURCE_ARTIFACT_STATUSES);
export const ingestionModeEnum = pgEnum("ingestion_mode", INGESTION_MODES);
export const ingestionRunStatusEnum = pgEnum("ingestion_run_status", INGESTION_RUN_STATUSES);
export const examScheduleStatusEnum = pgEnum("exam_schedule_status", EXAM_SCHEDULE_STATUSES);
export const jobTypeEnum = pgEnum("job_type", JOB_TYPES);
export const jobStatusEnum = pgEnum("job_status", JOB_STATUSES);
export const vocabularyCandidateStatusEnum = pgEnum(
  "vocabulary_candidate_status",
  VOCABULARY_CANDIDATE_STATUSES,
);

/** 시험 (년도·학년·월 조합당 1개) */
export const exams = pgTable(
  "exams",
  {
    id: id(),
    year: smallint("year").notNull(),
    grade: smallint("grade").notNull(),
    month: smallint("month").notNull(),
    /**
     * 대입 학년도 (예: 2026년 11월 시행 수능 → 2027). year 는 항상 "시행 연도"이며 URL 에 쓰인다.
     * 평가원 모의평가/수능처럼 학년도 표기를 쓰는 시험에서만 값이 있다.
     */
    academicYear: smallint("academic_year"),
    examType: examTypeEnum("exam_type").notNull(),
    organizer: text("organizer").notNull(),
    examDate: date("exam_date"),
    slug: text("slug").notNull(),
    isSample: boolean("is_sample").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("exams_slug_uq").on(t.slug),
    uniqueIndex("exams_year_grade_month_uq").on(t.year, t.grade, t.month),
    index("exams_grade_idx").on(t.grade, t.year),
    check("exams_grade_ck", sql`${t.grade} between 1 and 3`),
    check("exams_month_ck", sql`${t.month} between 1 and 12`),
  ],
);

/** 시험별로 제공되는 과목과 문항 구성 */
export const examSubjects = pgTable(
  "exam_subjects",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    subject: subjectEnum("subject").notNull(),
    /** 자동 수집으로 만든 과목은 문항 구성을 모를 수 있다 (null). */
    questionCount: smallint("question_count"),
    totalScore: smallint("total_score"),
  },
  (t) => [uniqueIndex("exam_subjects_exam_subject_uq").on(t.examId, t.subject)],
);

/** 선택과목/세부과목 카탈로그 (사회·문화, 물리학 I, 미적분 …). code 는 URL 에 쓰는 안정 식별자 */
export const courses = pgTable(
  "courses",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    subject: subjectEnum("subject").notNull(),
    displayOrder: smallint("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    /**
     * 이 세부과목이 존재할 수 있는 시험 체제와 학년 (src/lib/courses.ts 에서 동기화, 검증 참고용).
     * 예) [{"regime":"csat_2022","grades":[2,3]}]
     */
    regimes: jsonb("regimes")
      .$type<Array<{ regime: string; grades?: number[] }>>()
      .notNull()
      .default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex("courses_code_uq").on(t.code), index("courses_subject_idx").on(t.subject)],
);

/**
 * course 별칭. 관리자가 확정한 mapping("윤리" → 생활과 윤리)을 저장해 다음 수집부터 재사용한다.
 * sourceId 가 null 이면 모든 source 에 적용. alias 는 normalizeCourseLabel 결과.
 */
export const courseAliases = pgTable(
  "course_aliases",
  {
    id: id(),
    alias: text("alias").notNull(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    sourceId: text("source_id").references(() => examSources.id, { onDelete: "cascade" }),
    /** 시험 체제 한정 alias (예: 과거 표기 "물리Ⅰ" 은 legacy 체제에만). null = 모든 체제 */
    regimeCode: text("regime_code"),
    createdBy: text("created_by").notNull().default("system"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // PostgreSQL 에서 NULL 은 서로 다르게 취급되므로 source/체제 유무에 따라 partial unique index 를 나눈다
    uniqueIndex("course_aliases_global_uq")
      .on(t.alias)
      .where(sql`${t.sourceId} is null and ${t.regimeCode} is null`),
    uniqueIndex("course_aliases_source_uq")
      .on(t.alias, t.sourceId)
      .where(sql`${t.sourceId} is not null and ${t.regimeCode} is null`),
    uniqueIndex("course_aliases_global_regime_uq")
      .on(t.alias, t.regimeCode)
      .where(sql`${t.sourceId} is null and ${t.regimeCode} is not null`),
    uniqueIndex("course_aliases_source_regime_uq")
      .on(t.alias, t.sourceId, t.regimeCode)
      .where(sql`${t.sourceId} is not null and ${t.regimeCode} is not null`),
  ],
);

/** 시험에서 제공되는 세부과목과 문항 구성 */
export const examCourses = pgTable(
  "exam_courses",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    questionCount: smallint("question_count"),
    totalScore: smallint("total_score"),
  },
  (t) => [uniqueIndex("exam_courses_exam_course_uq").on(t.examId, t.courseId)],
);

/** 시험 자료 파일 metadata. 실제 파일은 StorageProvider(R2 등)에 storageKey로 저장된다. */
export const examFiles = pgTable(
  "exam_files",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    subject: subjectEnum("subject").notNull(),
    type: fileTypeEnum("type").notNull(),
    /** 세부과목 (사회·문화 등). 국어/영어/한국사처럼 세부과목이 없거나 영역 전체 자료면 null */
    courseId: text("course_id").references(() => courses.id, { onDelete: "restrict" }),
    /** storage: 우리 스토리지(storageKey) / redirect: 검증된 공식 원본 URL(externalUrl) */
    deliveryType: fileDeliveryTypeEnum("delivery_type").notNull().default("storage"),
    storageKey: text("storage_key"),
    externalUrl: text("external_url"),
    /** official: 공식 원본 자료 / generated: 우리가 만든 자료(단어장 PDF 등) */
    artifactOrigin: artifactOriginEnum("artifact_origin").notNull().default("official"),
    sourceArtifactId: text("source_artifact_id").references(() => sourceArtifacts.id, {
      onDelete: "set null",
    }),
    /** 화면 표시용 출처명 (예: "EBSi") */
    sourceLabel: text("source_label"),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size"),
    originalFileName: text("original_file_name").notNull(),
    ...timestamps,
  },
  (t) => [
    // course 가 없는 자료와 있는 자료를 partial unique index 로 나눈다 (NULL 중복 방지)
    uniqueIndex("exam_files_slot_no_course_uq")
      .on(t.examId, t.subject, t.type)
      .where(sql`${t.courseId} is null`),
    uniqueIndex("exam_files_slot_course_uq")
      .on(t.examId, t.subject, t.courseId, t.type)
      .where(sql`${t.courseId} is not null`),
    uniqueIndex("exam_files_storage_key_uq").on(t.storageKey),
    check(
      "exam_files_delivery_ck",
      sql`(${t.deliveryType} = 'storage' and ${t.storageKey} is not null) or (${t.deliveryType} = 'redirect' and ${t.externalUrl} is not null)`,
    ),
  ],
);

/** 문항: 정답·배점·해설(웹 해설 또는 해설지 PDF 페이지)을 함께 관리 */
export const questions = pgTable(
  "questions",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    subject: subjectEnum("subject").notNull(),
    /** 선택과목 문항(예: 미적분 23~30번, 사회·문화 1~20번). 공통 문항은 null */
    courseId: text("course_id").references(() => courses.id, { onDelete: "restrict" }),
    questionNumber: smallint("question_number").notNull(),
    answer: text("answer").notNull(),
    choiceCount: smallint("choice_count"),
    score: smallint("score").notNull(),
    explanation: text("explanation"),
    solutionPage: smallint("solution_page"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("questions_number_no_course_uq")
      .on(t.examId, t.subject, t.questionNumber)
      .where(sql`${t.courseId} is null`),
    uniqueIndex("questions_number_course_uq")
      .on(t.examId, t.subject, t.courseId, t.questionNumber)
      .where(sql`${t.courseId} is not null`),
  ],
);

/** 문항별 정답률 통계. 출처(source)별로 1건 */
export const questionStatistics = pgTable(
  "question_statistics",
  {
    id: id(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    correctRate: real("correct_rate").notNull(),
    answerDistribution: jsonb("answer_distribution").$type<number[]>(),
    statisticsSource: text("statistics_source").notNull(),
    statisticsSourceUrl: text("statistics_source_url"),
    isSample: boolean("is_sample").notNull().default(false),
    statisticsUpdatedAt: timestamp("statistics_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("question_statistics_question_source_uq").on(t.questionId, t.statisticsSource),
    check("question_statistics_rate_ck", sql`${t.correctRate} between 0 and 100`),
  ],
);

/** 영어 지문별 단어장. 시험 전체가 아니라 문항 단위로 연결된다. */
export const vocabulary = pgTable(
  "vocabulary",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    /** 문항 데이터(정답 등)가 아직 없어도 단어장을 만들 수 있도록 nullable. questionNumber 는 항상 있다. */
    questionId: text("question_id").references(() => questions.id, { onDelete: "cascade" }),
    subject: subjectEnum("subject").notNull().default("english"),
    questionNumber: smallint("question_number").notNull(),
    word: text("word").notNull(),
    meaning: text("meaning").notNull(),
    partOfSpeech: text("part_of_speech"),
    difficulty: smallint("difficulty").notNull().default(1),
    /** 자동 추출 단어의 원본 자료 (수동/샘플 입력은 null) */
    sourceArtifactId: text("source_artifact_id").references(() => sourceArtifacts.id, {
      onDelete: "set null",
    }),
    /**
     * 단어·뜻의 출처: solution_extract(공식 해설 PDF 에서 규칙으로 추출) / manual(운영자 입력) /
     * ai_assisted(AI 보조 생성 — 관리자 검토 후에만 등록)
     */
    provenance: text("provenance", { enum: VOCABULARY_PROVENANCES })
      .notNull()
      .default("solution_extract"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("vocabulary_exam_number_word_uq").on(t.examId, t.subject, t.questionNumber, t.word),
    index("vocabulary_exam_idx").on(t.examId),
    check(
      "vocabulary_provenance_ck",
      sql`${t.provenance} in ('solution_extract', 'manual', 'ai_assisted')`,
    ),
  ],
);

/** 듣기 트랙: 하나의 음원 파일에서 문항별 구간(start~end)을 가리킨다. */
export const listeningTracks = pgTable(
  "listening_tracks",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => examFiles.id, { onDelete: "cascade" }),
    /** null = 전체 듣기 */
    questionNumber: smallint("question_number"),
    label: text("label").notNull(),
    startSeconds: real("start_seconds").notNull().default(0),
    endSeconds: real("end_seconds").notNull(),
    /**
     * 문항 구간(start~end)이 검증됐는지. false 면 화면은 구간을 쓰지 않고 전체 음원만 재생한다
     * (문항별 구간을 추측하지 않는다). 근거는 timing_source 에 남긴다.
     */
    timingVerified: boolean("timing_verified").notNull().default(false),
    timingSource: text("timing_source"),
    timingVerifiedBy: text("timing_verified_by"),
    timingVerifiedAt: timestamp("timing_verified_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("listening_tracks_exam_number_uq").on(t.examId, t.questionNumber)],
);

export const listeningTranscripts = pgTable(
  "listening_transcripts",
  {
    id: id(),
    trackId: text("track_id")
      .notNull()
      .references(() => listeningTracks.id, { onDelete: "cascade" }),
    lines: jsonb("lines").$type<TranscriptLine[]>().notNull(),
    /**
     * official: 공식 듣기 대본 자료 / authorized: 이용 허락을 받은 자료 / unverified: 출처 미확인(공개 안 함) /
     * sample: 개발용 샘플 (is_sample 시험에만).
     * AI 가 음원을 듣고 만든 대본은 저장하지 않는다.
     */
    origin: text("origin", { enum: TRANSCRIPT_ORIGINS }).notNull().default("unverified"),
    sourceUrl: text("source_url"),
    sourceFileId: text("source_file_id").references(() => examFiles.id, { onDelete: "set null" }),
    parserVersion: text("parser_version"),
    verifiedBy: text("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("listening_transcripts_track_uq").on(t.trackId),
    check(
      "listening_transcripts_origin_ck",
      sql`${t.origin} in ('official', 'authorized', 'unverified', 'sample')`,
    ),
  ],
);

/** 등급컷: 시험·과목·출처별 1건. 공식(isOfficial)과 예상치를 구분한다. */
export const gradeCuts = pgTable(
  "grade_cuts",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    subject: subjectEnum("subject").notNull(),
    /** 탐구 과목별 등급컷 (같은 사회탐구라도 사회·문화/생활과 윤리 등급컷은 다르다) */
    courseId: text("course_id").references(() => courses.id, { onDelete: "restrict" }),
    source: gradeCutSourceEnum("source").notNull(),
    sourceUrl: text("source_url"),
    providerStatus: text("provider_status").notNull().default("provider_estimate"),
    providerLabel: text("provider_label"),
    observedVia: gradeCutSourceEnum("observed_via"),
    firstParty: boolean("first_party").notNull().default(false),
    scoreBasis: text("score_basis").notNull().default("raw"),
    parserVersion: text("parser_version").notNull().default("legacy"),
    isOfficial: boolean("is_official").notNull().default(false),
    isSample: boolean("is_sample").notNull().default(false),
    cuts: jsonb("cuts").$type<GradeCutEntry[]>().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("grade_cuts_source_no_course_uq")
      .on(t.examId, t.subject, t.source)
      .where(sql`${t.courseId} is null`),
    uniqueIndex("grade_cuts_source_course_uq")
      .on(t.examId, t.subject, t.courseId, t.source)
      .where(sql`${t.courseId} is not null`),
  ],
);

/** A slot is finalized independently of the other subjects in the same exam. */
export const gradeCutWatchStates = pgTable(
  "grade_cut_watch_states",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    subject: subjectEnum("subject").notNull(),
    courseId: text("course_id").references(() => courses.id, { onDelete: "restrict" }),
    slotKey: text("slot_key").notNull().default(""),
    status: text("status").notNull().default("waiting"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    officialGradeCutId: text("official_grade_cut_id").references(() => gradeCuts.id, {
      onDelete: "set null",
    }),
    failureCount: integer("failure_count").notNull().default(0),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("grade_cut_watch_slot_uq").on(t.examId, t.subject, t.slotKey),
    index("grade_cut_watch_status_idx").on(t.status, t.lastPolledAt),
    check(
      "grade_cut_watch_status_ck",
      sql`${t.status} in ('waiting', 'watching', 'finalized', 'failed')`,
    ),
  ],
);

/** One immutable observation for the first value and every subsequent value change. */
export const gradeCutSnapshots = pgTable(
  "grade_cut_snapshots",
  {
    id: id(),
    gradeCutId: text("grade_cut_id")
      .notNull()
      .references(() => gradeCuts.id, { onDelete: "cascade" }),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    subject: subjectEnum("subject").notNull(),
    courseId: text("course_id").references(() => courses.id, { onDelete: "restrict" }),
    source: gradeCutSourceEnum("source").notNull(),
    cuts: jsonb("cuts").$type<GradeCutEntry[]>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    sourceUrl: text("source_url"),
    providerStatus: text("provider_status").notNull().default("provider_estimate"),
    providerLabel: text("provider_label"),
    observedVia: gradeCutSourceEnum("observed_via"),
    firstParty: boolean("first_party").notNull().default(false),
    scoreBasis: text("score_basis").notNull().default("raw"),
    parserVersion: text("parser_version").notNull().default("legacy"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("grade_cut_snapshots_cut_time_idx").on(t.gradeCutId, t.observedAt)],
);

/** 오류 신고 (로그인 없이 접수) */
export const reports = pgTable(
  "reports",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    fileId: text("file_id").references(() => examFiles.id, { onDelete: "set null" }),
    subject: subjectEnum("subject"),
    category: reportCategoryEnum("category").notNull(),
    message: text("message"),
    status: reportStatusEnum("status").notNull().default("pending"),
    /** abuse 추적용 (원본 IP는 저장하지 않고 salt 해시만 저장) */
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reports_status_idx").on(t.status, t.createdAt),
    index("reports_ip_hash_idx").on(t.ipHash, t.createdAt),
  ],
);

// ── 자동 수집 (ingestion) ──────────────────────────────────

/** 공식 자료 출처와 수집 정책/상태 */
export const examSources = pgTable("exam_sources", {
  /** 코드에서 쓰는 고정 id (예: "ebsi", "kice") */
  id: text("id").primaryKey(),
  kind: sourceKindEnum("kind").notNull(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  /** 허용 도메인 allowlist (SSRF 방지). 비어 있으면 baseUrl 의 host 만 허용 */
  allowedHosts: jsonb("allowed_hosts").$type<string[]>().notNull().default([]),
  deliveryPolicy: deliveryPolicyEnum("delivery_policy").notNull().default("source_redirect"),
  enabled: boolean("enabled").notNull().default(false),
  /**
   * 기능 단위 활성화 (enabled 가 master switch). 단계적으로 켠다:
   * discovery(시험 metadata) → artifacts(자료 URL·검증·게시) → release_watch(시험 당일 감시)
   */
  discoveryEnabled: boolean("discovery_enabled").notNull().default(false),
  artifactEnabled: boolean("artifact_enabled").notNull().default(false),
  releaseWatchEnabled: boolean("release_watch_enabled").notNull().default(false),
  // 요청 예절 (source 별)
  minPollIntervalSeconds: integer("min_poll_interval_seconds").notNull().default(600),
  requestTimeoutMs: integer("request_timeout_ms").notNull().default(15_000),
  maxConcurrentRequests: smallint("max_concurrent_requests").notNull().default(2),
  minRequestGapMs: integer("min_request_gap_ms").notNull().default(1_000),
  maxRetries: smallint("max_retries").notNull().default(2),
  // health
  healthStatus: sourceHealthEnum("health_status").notNull().default("disabled"),
  healthMessage: text("health_message"),
  lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
  lastSuccessfulFetchAt: timestamp("last_successful_fetch_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  failureCount: integer("failure_count").notNull().default(0),
  // ── 실제 페이지(live fixture) 검증 ──
  // 증거: npm run ingest:fixtures:validate -- --record 가 실제 fixture 로 parser contract 를 통과했을 때 기록
  liveFixtureValidatedAt: timestamp("live_fixture_validated_at", { withTimezone: true }),
  liveFixtureHash: text("live_fixture_hash"),
  liveFixtureParserVersion: text("live_fixture_parser_version"),
  // 승인: 관리자가 증거를 확인하고 승인해야 true. parser version 이 바뀌면 다시 필요
  verifiedAgainstLiveFixture: boolean("verified_against_live_fixture").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: text("verified_by"),
  verifiedFixtureHash: text("verified_fixture_hash"),
  verifiedParserVersion: text("verified_parser_version"),
  ...timestamps,
});

/** 시험 유형별 source 우선순위 (원본성/신뢰도 기준, 낮은 숫자가 우선) */
export const sourcePriorities = pgTable(
  "source_priorities",
  {
    id: id(),
    examType: examTypeEnum("exam_type").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => examSources.id, { onDelete: "cascade" }),
    priority: smallint("priority").notNull(),
  },
  (t) => [uniqueIndex("source_priorities_type_source_uq").on(t.examType, t.sourceId)],
);

/** 외부 source 의 시험 ↔ 내부 Exam mapping */
export const sourceExams = pgTable(
  "source_exams",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => examSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    /** source 가 표기한 원래 시험명 (canonicalization 추적용) */
    sourceTitle: text("source_title"),
    /** 관리자가 mapping 을 직접 수정했으면 true → 자동 수집이 덮어쓰지 않는다 */
    mappingLocked: boolean("mapping_locked").notNull().default(false),
    firstDiscoveredAt: timestamp("first_discovered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    uniqueIndex("source_exams_source_external_uq").on(t.sourceId, t.externalId),
    index("source_exams_exam_idx").on(t.examId),
  ],
);

/** source 에서 발견한 개별 자료. (source, 시험, 과목, 종류)당 1건 */
export const sourceArtifacts = pgTable(
  "source_artifacts",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => examSources.id, { onDelete: "cascade" }),
    subject: subjectEnum("subject").notNull(),
    courseId: text("course_id").references(() => courses.id, { onDelete: "restrict" }),
    /**
     * 슬롯 식별자: "" (course 없음) / course code / "unresolved:<정규화 표기>" (모호 → manual_review)
     * 파일명이 아니라 canonical course + 자료 종류 + 시험으로 중복을 판단한다.
     */
    slotKey: text("slot_key").notNull().default(""),
    /** source 가 표기한 원래 과목명 (예: "윤리", "사회문화영역") */
    courseLabel: text("course_label"),
    /** source 원문 영역 표기 (예: "제2외국어/한문") — canonical 로 바꾼 뒤에도 보존 */
    sourceSubjectLabel: text("source_subject_label"),
    /** source 원문 표기 전체 (영역 + 링크 표기) — parser 디버깅/관리자 검토용 */
    sourceLabel: text("source_label"),
    type: fileTypeEnum("type").notNull(),
    sourceUrl: text("source_url").notNull(),
    /** file | archive (여러 과목이 든 zip 등 — 아직 압축 해제는 하지 않고 검토 대상으로 둔다) */
    containerType: text("container_type").notNull().default("file"),
    containsMultipleCourses: boolean("contains_multiple_courses").notNull().default(false),
    storageKey: text("storage_key"),
    originalFileName: text("original_file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size"),
    /** 파일 전체를 받아 계산한 hash (mirror/단어장 처리 등 전체 다운로드를 한 경우만) */
    sha256: text("sha256"),
    /** full: 전체 다운로드 검증 / probe: 앞부분 + header 만 확인 (source_redirect 기본) */
    verificationMode: text("verification_mode"),
    /** 내용 변경 감지용 버전 식별자: full 이면 sha256, probe 면 "probe:<hash>" */
    contentFingerprint: text("content_fingerprint"),
    /** redirect 를 따라간 최종 URL (허용 도메인 검사 결과 기록) */
    finalUrl: text("final_url"),
    deliveryPolicy: deliveryPolicyEnum("delivery_policy").notNull(),
    status: sourceArtifactStatusEnum("status").notNull().default("discovered"),
    statusReason: text("status_reason"),
    sourcePublishedAt: timestamp("source_published_at", { withTimezone: true }),
    firstDiscoveredAt: timestamp("first_discovered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("source_artifacts_slot_key_uq").on(
      t.sourceId,
      t.examId,
      t.subject,
      t.type,
      t.slotKey,
    ),
    index("source_artifacts_status_idx").on(t.status),
    index("source_artifacts_exam_idx").on(t.examId, t.subject, t.type),
    // 같은 URL·같은 내용이 다른 시험/슬롯에 연결됐는지 (manual_review 충돌 탐지)
    index("source_artifacts_source_url_idx").on(t.sourceUrl),
    index("source_artifacts_fingerprint_idx").on(t.contentFingerprint),
  ],
);

/** 수집 실행 기록 */
export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: id(),
    sourceId: text("source_id").references(() => examSources.id, { onDelete: "set null" }),
    mode: ingestionModeEnum("mode").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: ingestionRunStatusEnum("status").notNull().default("running"),
    discoveredCount: integer("discovered_count").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    errorSummary: text("error_summary"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("ingestion_runs_source_started_idx").on(t.sourceId, t.startedAt)],
);

export const ingestionErrors = pgTable(
  "ingestion_errors",
  {
    id: id(),
    runId: text("run_id").references(() => ingestionRuns.id, { onDelete: "cascade" }),
    sourceId: text("source_id").references(() => examSources.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    url: text("url"),
    code: text("code").notNull(),
    message: text("message").notNull(),
    retryable: boolean("retryable").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ingestion_errors_created_idx").on(t.createdAt)],
);

/** backfill 체크포인트: 중간 실패 후 재실행 시 완료된 범위를 건너뛴다 */
export const ingestionCheckpoints = pgTable(
  "ingestion_checkpoints",
  {
    id: id(),
    sourceId: text("source_id")
      .notNull()
      .references(() => examSources.id, { onDelete: "cascade" }),
    /** 예: "backfill:2025:high2" */
    scope: text("scope").notNull(),
    lastCursor: text("last_cursor"),
    processedCount: integer("processed_count").notNull().default(0),
    status: ingestionRunStatusEnum("status").notNull().default("running"),
    ...timestamps,
  },
  (t) => [uniqueIndex("ingestion_checkpoints_source_scope_uq").on(t.sourceId, t.scope)],
);

/**
 * 운영자 CSV 입력 기록 (브라우저에서 확인한 공식 파일 URL 대량 입력). 행별 결과를 감사 기록으로 남긴다.
 */
export const officialUrlImports = pgTable(
  "official_url_imports",
  {
    id: id(),
    createdBy: text("created_by").notNull(),
    fileName: text("file_name"),
    dryRun: boolean("dry_run").notNull().default(false),
    rowCount: integer("row_count").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    unchangedCount: integer("unchanged_count").notNull().default(0),
    invalidCount: integer("invalid_count").notNull().default(0),
    /** 행별 결과 (줄 번호, 상태, 오류 메시지) */
    results: jsonb("results")
      .$type<Array<{ line: number; status: string; errors?: string[]; artifactId?: string }>>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("official_url_imports_created_idx").on(t.createdAt)],
);

/**
 * backfill audit 기록. canary backfill 단계(최근 1년 → 최근 3년 → 전체)를 넓히려면
 * 앞 단계 범위의 audit 이 통과(blocking issue 없음)해야 한다.
 */
export const backfillAudits = pgTable(
  "backfill_audits",
  {
    id: id(),
    sourceId: text("source_id").references(() => examSources.id, { onDelete: "cascade" }),
    fromYear: smallint("from_year").notNull(),
    toYear: smallint("to_year").notNull(),
    passed: boolean("passed").notNull(),
    blockingCount: integer("blocking_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    report: jsonb("report").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("backfill_audits_source_idx").on(t.sourceId, t.createdAt)],
);

/** 시험 일정. 공식 발표로 확인된 일정만 등록한다. */
export const examSchedules = pgTable(
  "exam_schedules",
  {
    id: id(),
    year: smallint("year").notNull(),
    grade: smallint("grade").notNull(),
    month: smallint("month").notNull(),
    examType: examTypeEnum("exam_type").notNull(),
    organizer: text("organizer").notNull(),
    examDate: date("exam_date").notNull(),
    expectedReleaseStart: timestamp("expected_release_start", { withTimezone: true }),
    expectedReleaseEnd: timestamp("expected_release_end", { withTimezone: true }),
    status: examScheduleStatusEnum("status").notNull().default("scheduled"),
    /** 일정 근거 (공식 공지 URL 등) */
    announcementUrl: text("announcement_url"),
    /** 공식 공지에서 확인한 시험별 source 페이지 (KICE 시험별 자료 index 등) */
    sourcePages: jsonb("source_pages")
      .$type<Array<{ sourceId: string; url: string; pageType: string }>>()
      .notNull()
      .default([]),
    isSample: boolean("is_sample").notNull().default(false),
    examId: text("exam_id").references(() => exams.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("exam_schedules_identity_uq").on(t.year, t.grade, t.month, t.examType),
    index("exam_schedules_date_idx").on(t.examDate),
  ],
);

/**
 * release watch 의 자료 단위(시험 · 영역 · 세부과목 · 종류) polling 상태.
 * 확보한 자료는 found 가 되어 더 이상 확인하지 않고, 남은 자료만 공개 예정 시각에 맞춰 확인한다.
 */
export const artifactWatchStates = pgTable(
  "artifact_watch_states",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    subject: subjectEnum("subject").notNull(),
    courseId: text("course_id").references(() => courses.id, { onDelete: "restrict" }),
    /** "" = 영역 전체, 그 외 course code */
    slotKey: text("slot_key").notNull().default(""),
    type: fileTypeEnum("type").notNull(),
    /** waiting | found | missed (감시 시간 안에 나오지 않음 → 정기 수집에 맡김) */
    status: text("status").notNull().default("waiting"),
    /** 실제로 확인을 시작할 기준 시각 (artifactExpectedAt) */
    expectedAt: timestamp("expected_at", { withTimezone: true }),
    /** source 가 공식 발표한 공개 시각 (KICE 정답 공개시간 등) */
    officialReleaseAt: timestamp("official_release_at", { withTimezone: true }),
    /** expectedAt 의 근거: official | schedule | fallback */
    expectedSource: text("expected_source").notNull().default("fallback"),
    releaseSourceId: text("release_source_id"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    pollCount: integer("poll_count").notNull().default(0),
    foundAt: timestamp("found_at", { withTimezone: true }),
    foundSourceId: text("found_source_id"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("artifact_watch_states_slot_uq").on(t.examId, t.subject, t.slotKey, t.type),
    index("artifact_watch_states_status_idx").on(t.status),
  ],
);

/** PostgreSQL 기반 단순 job queue (FOR UPDATE SKIP LOCKED 로 claim) */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: jobTypeEnum("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** 같은 작업의 중복 enqueue 방지 (idempotency key) */
    dedupeKey: text("dedupe_key").notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    maxAttempts: smallint("max_attempts").notNull().default(5),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("jobs_dedupe_key_uq").on(t.dedupeKey),
    index("jobs_claim_idx").on(t.status, t.runAt),
  ],
);

/** 해설 PDF 에서 자동 추출한 단어 후보 (원본에 실제로 있는 단어만) */
export const vocabularyCandidates = pgTable(
  "vocabulary_candidates",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    sourceArtifactId: text("source_artifact_id")
      .notNull()
      .references(() => sourceArtifacts.id, { onDelete: "cascade" }),
    questionNumber: smallint("question_number").notNull(),
    word: text("word").notNull(),
    meaning: text("meaning"),
    confidence: real("confidence").notNull(),
    status: vocabularyCandidateStatusEnum("status").notNull().default("needs_review"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("vocabulary_candidates_artifact_word_uq").on(
      t.sourceArtifactId,
      t.questionNumber,
      t.word,
    ),
  ],
);

/**
 * scheduler heartbeat — cron task 마다 마지막 실행/성공 시각.
 * watchdog 이 기대 주기 대비 stale·연속 실패를 판정한다 (민감정보 없이 상태 코드만 저장).
 */
export const schedulerHeartbeats = pgTable("scheduler_heartbeats", {
  task: text("task").primaryKey(),
  lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
  lastFinishedAt: timestamp("last_finished_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  /** running | ok | skipped | failed */
  lastStatus: text("last_status"),
  /** 짧은 상태 코드 (예: locked, disabled, stage 이름) — 오류 메시지·URL 은 저장하지 않는다 */
  lastDetail: text("last_detail"),
  lastDurationMs: integer("last_duration_ms"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  runCount: integer("run_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 운영 알림 dedupe/cooldown 상태 (같은 key 는 cooldown 동안 한 번만 보낸다) */
export const opsAlertStates = pgTable("ops_alert_states", {
  key: text("key").primaryKey(),
  kind: text("kind").notNull(),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull(),
  /** 마지막 발송 이후 cooldown 때문에 보내지 않은 횟수 */
  suppressedCount: integer("suppressed_count").notNull().default(0),
  lastMessage: text("last_message"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 검토 근거 · 보류 사유 (source_artifacts 1:1, 별도 테이블).
 * source_artifacts 에 컬럼을 더하지 않는 이유: 운영 DB migration 보다 코드가 먼저 배포돼도
 * 기존 조회(select *)가 깨지지 않게 하기 위해. 이 테이블은 새 코드만 읽고, 없으면 건너뛴다.
 */
export const artifactReviewNotes = pgTable("artifact_review_notes", {
  artifactId: text("artifact_id")
    .primaryKey()
    .references(() => sourceArtifacts.id, { onDelete: "cascade" }),
  /** 보류 사유 코드 (예: no_exam_identity, subject_mismatch, slot_conflict) */
  reasonCode: text("reason_code"),
  reason: text("reason"),
  /** 근거 목록 — 형식: src/ingestion/manual-import/evidence.ts */
  evidence: jsonb("evidence").$type<Array<Record<string, unknown>>>().notNull().default([]),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 관리자가 승인한 매핑 규칙 — 이후 후보 분류에 재사용한다.
 * 예: EBSi 파일 코드 "s_samun" → 사회탐구 / social-culture (고2·고3 공통)
 * 확정적인 규칙만 저장한다 (한 코드가 서로 다른 과목으로 승인되면 규칙을 만들지 않는다).
 */
export const reviewMappingRules = pgTable(
  "review_mapping_rules",
  {
    id: id(),
    sourceId: text("source_id").notNull(),
    /** ebsi_file_code */
    kind: text("kind").notNull(),
    pattern: text("pattern").notNull(),
    /** 학년에 따라 뜻이 다른 코드(sat/gat 등)는 학년별 규칙. 공통이면 "" */
    gradeScope: text("grade_scope").notNull().default(""),
    subject: subjectEnum("subject").notNull(),
    courseId: text("course_id").references(() => courses.id, { onDelete: "restrict" }),
    createdBy: text("created_by").notNull(),
    /** 이 규칙을 뒷받침하는 승인 건수 */
    approvals: integer("approvals").notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex("review_mapping_rules_uq").on(t.sourceId, t.kind, t.pattern, t.gradeScope)],
);

/**
 * 공식 정답·해설 PDF 에서 추출한 정답표와 문제지 배점 (슬롯별 1건).
 * 검증을 통과한 슬롯만 questions 에 게시한다. 실패·불확실은 reasons 와 함께 manual_review.
 * questions 에 컬럼을 더하지 않고 출처(provenance)는 이 테이블에 둔다 (코드 선배포 안전).
 */
export const answerKeyExtractions = pgTable(
  "answer_key_extractions",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    subject: subjectEnum("subject").notNull(),
    /** "" = 공통 또는 영역 전체, 그 외 course id */
    slotKey: text("slot_key").notNull().default(""),
    courseId: text("course_id").references(() => courses.id, { onDelete: "restrict" }),
    /** verified · manual_review · published */
    status: text("status").notNull(),
    answersVerified: boolean("answers_verified").notNull().default(false),
    pointsVerified: boolean("points_verified").notNull().default(false),
    reasons: jsonb("reasons")
      .$type<Array<{ code: string; detail: string }>>()
      .notNull()
      .default([]),
    answers: jsonb("answers")
      .$type<
        Array<{
          number: number;
          answer: string;
          choice: boolean;
          page: number | null;
          heading?: string | null;
        }>
      >()
      .notNull()
      .default([]),
    /** 문항 번호 → 배점. 검증 실패면 null */
    points: jsonb("points").$type<Record<string, number>>(),
    crossChecked: smallint("cross_checked").notNull().default(0),
    solutionFileId: text("solution_file_id").references(() => examFiles.id, {
      onDelete: "set null",
    }),
    questionFileId: text("question_file_id").references(() => examFiles.id, {
      onDelete: "set null",
    }),
    solutionUrl: text("solution_url"),
    solutionSha256: text("solution_sha256"),
    parserVersion: text("parser_version").notNull(),
    extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("answer_key_extractions_slot_uq").on(t.examId, t.subject, t.slotKey),
    index("answer_key_extractions_status_idx").on(t.status),
  ],
);

/**
 * 개념 (과목별 사전). 이름은 공식 해설지 머리말에서 규칙으로 정리한 표기 또는 관리자 입력.
 * slug 는 같은 과목 안에서 중복 제거 키.
 */
export const concepts = pgTable(
  "concepts",
  {
    id: id(),
    subject: subjectEnum("subject").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("concepts_subject_slug_uq").on(t.subject, t.slug)],
);

/**
 * 문항 ↔ 개념 (다대다). 공개 화면에는 approved 만 나온다.
 * 근거(evidence)는 머리말 원문 + 해설지 쪽, 출처 파일(source_file_id/url)을 남긴다.
 */
export const questionConcepts = pgTable(
  "question_concepts",
  {
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    status: text("status", { enum: CONCEPT_STATUSES }).notNull(),
    source: text("source", { enum: CONCEPT_SOURCES }).notNull(),
    confidence: real("confidence").notNull(),
    evidence: text("evidence"),
    reviewReason: text("review_reason"),
    sourceFileId: text("source_file_id").references(() => examFiles.id, { onDelete: "set null" }),
    sourceUrl: text("source_url"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("question_concepts_pk_uq").on(t.questionId, t.conceptId),
    index("question_concepts_concept_idx").on(t.conceptId, t.status),
    index("question_concepts_status_idx").on(t.status),
    check(
      "question_concepts_status_ck",
      sql`${t.status} in ('approved', 'manual_review', 'rejected')`,
    ),
    check("question_concepts_confidence_ck", sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
  ],
);

/**
 * 모의고사 창고가 만든 학습 자료 (학습지 PDF, 독해 학습 노트). 공식 자료가 아니다.
 * 자동 게시하지 않는다: draft → generated → reviewing → approved → published (또는 rejected).
 * 학습지는 승인되면 exam_files(artifact_origin=generated)로 게시되고 exam_file_id 로 연결된다.
 */
export const studyMaterials = pgTable(
  "study_materials",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    subject: subjectEnum("subject").notNull(),
    /** 학습지는 file_type 값 (vocabulary_test 등), 독해 노트는 reading_note */
    kind: text("kind").notNull(),
    /** "" = 시험·과목 전체, 그 외 문항 번호 문자열 */
    slotKey: text("slot_key").notNull().default(""),
    questionNumber: smallint("question_number"),
    /** generated: 규칙 기반 생성 / ai_assisted: AI 보조 생성 (화면에 "검토 필요" 표시) */
    origin: text("origin", { enum: STUDY_MATERIAL_ORIGINS }).notNull(),
    status: text("status", { enum: STUDY_MATERIAL_STATUSES }).notNull().default("draft"),
    title: text("title").notNull(),
    /** 독해 노트 등 구조화된 내용. 저작권이 불분명한 지문 전문은 넣지 않는다 */
    content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
    /** 생성 근거 (공식 파일 id/URL, 단어장·대본 버전) */
    sourceRefs: jsonb("source_refs")
      .$type<Array<{ kind: string; fileId?: string | null; url?: string | null }>>()
      .notNull()
      .default([]),
    /** 입력 데이터 fingerprint — 같으면 다시 만들지 않는다 */
    inputFingerprint: text("input_fingerprint").notNull(),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    fileSize: integer("file_size"),
    sha256: text("sha256"),
    fileName: text("file_name"),
    examFileId: text("exam_file_id").references(() => examFiles.id, { onDelete: "set null" }),
    reviewNote: text("review_note"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("study_materials_slot_uq").on(t.examId, t.subject, t.kind, t.slotKey),
    index("study_materials_status_idx").on(t.status, t.updatedAt),
    check(
      "study_materials_status_ck",
      sql`${t.status} in ('draft', 'generated', 'reviewing', 'approved', 'published', 'rejected')`,
    ),
    check("study_materials_origin_ck", sql`${t.origin} in ('generated', 'ai_assisted')`),
  ],
);

// ── relations ───────────────────────────────────────────────
export const examsRelations = relations(exams, ({ many }) => ({
  subjects: many(examSubjects),
  files: many(examFiles),
  questions: many(questions),
  gradeCuts: many(gradeCuts),
}));

export const questionsRelations = relations(questions, ({ one, many }) => ({
  exam: one(exams, { fields: [questions.examId], references: [exams.id] }),
  statistics: many(questionStatistics),
  vocabulary: many(vocabulary),
}));

export const questionStatisticsRelations = relations(questionStatistics, ({ one }) => ({
  question: one(questions, {
    fields: [questionStatistics.questionId],
    references: [questions.id],
  }),
}));

export const listeningTracksRelations = relations(listeningTracks, ({ one }) => ({
  transcript: one(listeningTranscripts, {
    fields: [listeningTracks.id],
    references: [listeningTranscripts.trackId],
  }),
}));
