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
import {
  EXAM_TYPES,
  FILE_TYPES,
  GRADE_CUT_SOURCES,
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  SUBJECTS,
} from "../lib/constants";
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

/** 시험 (년도·학년·월 조합당 1개) */
export const exams = pgTable(
  "exams",
  {
    id: id(),
    year: smallint("year").notNull(),
    grade: smallint("grade").notNull(),
    month: smallint("month").notNull(),
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
    questionCount: smallint("question_count").notNull(),
    totalScore: smallint("total_score").notNull(),
  },
  (t) => [uniqueIndex("exam_subjects_exam_subject_uq").on(t.examId, t.subject)],
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
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    originalFileName: text("original_file_name").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("exam_files_exam_subject_type_uq").on(t.examId, t.subject, t.type),
    uniqueIndex("exam_files_storage_key_uq").on(t.storageKey),
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
    questionNumber: smallint("question_number").notNull(),
    answer: text("answer").notNull(),
    choiceCount: smallint("choice_count"),
    score: smallint("score").notNull(),
    explanation: text("explanation"),
    solutionPage: smallint("solution_page"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("questions_exam_subject_number_uq").on(t.examId, t.subject, t.questionNumber),
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
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    word: text("word").notNull(),
    meaning: text("meaning").notNull(),
    partOfSpeech: text("part_of_speech"),
    difficulty: smallint("difficulty").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("vocabulary_question_word_uq").on(t.questionId, t.word),
    index("vocabulary_exam_idx").on(t.examId),
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
    ...timestamps,
  },
  (t) => [uniqueIndex("listening_transcripts_track_uq").on(t.trackId)],
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
    source: gradeCutSourceEnum("source").notNull(),
    sourceUrl: text("source_url"),
    isOfficial: boolean("is_official").notNull().default(false),
    isSample: boolean("is_sample").notNull().default(false),
    cuts: jsonb("cuts").$type<GradeCutEntry[]>().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("grade_cuts_exam_subject_source_uq").on(t.examId, t.subject, t.source)],
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
