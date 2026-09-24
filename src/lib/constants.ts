/**
 * 서비스 전역에서 쓰는 도메인 상수.
 * DB enum(src/db/schema.ts)과 값이 반드시 일치해야 한다.
 */

export const SITE_NAME = "모의고사 창고";

export const GRADES = [1, 2, 3] as const;
export type Grade = (typeof GRADES)[number];

export const MONTHS = [3, 4, 5, 6, 7, 9, 10, 11] as const;

export const SUBJECTS = ["korean", "math", "english", "history", "social", "science"] as const;
export type Subject = (typeof SUBJECTS)[number];

export const SUBJECT_LABELS: Record<Subject, string> = {
  korean: "국어",
  math: "수학",
  english: "영어",
  history: "한국사",
  social: "사회",
  science: "과학",
};

/** 시험 상세 기본 URL(/exam/2025/high2/09)에서 보여줄 과목 */
export const DEFAULT_SUBJECT: Subject = "korean";

export const FILE_TYPES = [
  "question",
  "solution",
  "listening_audio",
  "listening_script",
  "vocabulary_pdf",
] as const;
export type FileType = (typeof FILE_TYPES)[number];

export const FILE_TYPE_LABELS: Record<FileType, string> = {
  question: "시험지",
  solution: "정답·해설",
  listening_audio: "듣기 MP3",
  listening_script: "듣기 대본",
  vocabulary_pdf: "단어장",
};

export const EXAM_TYPES = ["school_mock", "kice_mock", "csat"] as const;
export type ExamType = (typeof EXAM_TYPES)[number];

export const EXAM_TYPE_LABELS: Record<ExamType, string> = {
  school_mock: "전국연합학력평가",
  kice_mock: "대학수학능력시험 모의평가",
  csat: "대학수학능력시험",
};

export const GRADE_CUT_SOURCES = ["official", "megastudy", "daesung", "ebs"] as const;
export type GradeCutSource = (typeof GRADE_CUT_SOURCES)[number];

export const GRADE_CUT_SOURCE_LABELS: Record<GradeCutSource, string> = {
  official: "공식",
  megastudy: "메가스터디",
  daesung: "대성",
  ebs: "EBS",
};

export const REPORT_CATEGORIES = [
  "file_broken",
  "wrong_question_paper",
  "wrong_solution",
  "wrong_answer",
  "audio_error",
  "vocabulary_error",
  "other",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  file_broken: "파일이 열리지 않음",
  wrong_question_paper: "잘못된 시험지",
  wrong_solution: "잘못된 해설지",
  wrong_answer: "정답 오류",
  audio_error: "음원 오류",
  vocabulary_error: "단어장 오류",
  other: "기타",
};

export const REPORT_STATUSES = ["pending", "reviewing", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** 어려운 문제 기본 기준 (정답률 %) */
export const DIFFICULT_RATE_THRESHOLD = 40;
export const VERY_DIFFICULT_RATE_THRESHOLD = 30;

export const CHOICE_SYMBOLS = ["①", "②", "③", "④", "⑤"] as const;
