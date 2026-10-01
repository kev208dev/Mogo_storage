/**
 * 영어 학습 기능의 출처(provenance)·검토 상태와 "무엇이 실제로 있는지" 판정.
 * DB enum 대신 text + check constraint 로 둔다 (src/db/schema.ts 와 값이 같아야 한다).
 */
import type { FileType, WorksheetFileType } from "./constants";

export const VOCABULARY_PROVENANCES = ["solution_extract", "manual", "ai_assisted"] as const;
export type VocabularyProvenance = (typeof VOCABULARY_PROVENANCES)[number];

export const TRANSCRIPT_ORIGINS = ["official", "authorized", "unverified", "sample"] as const;
export type TranscriptOrigin = (typeof TRANSCRIPT_ORIGINS)[number];

/** 화면에 공개해도 되는 대본 출처 (출처 미확인 대본은 공개하지 않는다) */
export function isPublishableTranscript(origin: TranscriptOrigin): boolean {
  return origin === "official" || origin === "authorized" || origin === "sample";
}

export const STUDY_MATERIAL_ORIGINS = ["generated", "ai_assisted"] as const;
export type StudyMaterialOrigin = (typeof STUDY_MATERIAL_ORIGINS)[number];

/** draft → generated → reviewing → approved → published, 어느 단계에서든 rejected */
export const STUDY_MATERIAL_STATUSES = [
  "draft",
  "generated",
  "reviewing",
  "approved",
  "published",
  "rejected",
] as const;
export type StudyMaterialStatus = (typeof STUDY_MATERIAL_STATUSES)[number];

const TRANSITIONS: Record<StudyMaterialStatus, readonly StudyMaterialStatus[]> = {
  draft: ["generated", "rejected"],
  generated: ["reviewing", "approved", "rejected"],
  reviewing: ["approved", "rejected"],
  approved: ["published", "rejected"],
  published: ["rejected"],
  rejected: ["generated"],
};

export function canTransition(from: StudyMaterialStatus, to: StudyMaterialStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const STUDY_MATERIAL_STATUS_LABELS: Record<StudyMaterialStatus, string> = {
  draft: "초안",
  generated: "생성됨 · 검토 대기",
  reviewing: "검토 중",
  approved: "승인됨",
  published: "게시됨",
  rejected: "반려",
};

/** 우리가 만든 자료의 화면 표기 */
export const ORIGIN_BADGES = {
  generated: "모의고사 창고 제작",
  ai_assisted: "AI 보조 생성 · 검토 필요",
} as const;

export const READING_NOTE_KIND = "reading_note";

/**
 * 독해 학습 노트 (문항 단위). 지문 전문은 넣지 않는다 — 공식 PDF 쪽 링크 + 직접 쓴 짧은 메모만.
 */
export interface ReadingNote {
  questionNumber: number;
  questionType: string | null;
  keyPoints: string[];
  grammarPoints: string[];
  answerRationale: string | null;
  wrongChoices: Array<{ choice: number; reason: string }>;
  tags: string[];
  origin: StudyMaterialOrigin;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

/** study_materials.content(jsonb) → ReadingNote. 형식이 맞지 않으면 null (화면에 내보내지 않는다) */
export function toReadingNote(
  questionNumber: number | null,
  origin: StudyMaterialOrigin,
  content: Record<string, unknown>,
): ReadingNote | null {
  if (!questionNumber) return null;
  const wrongChoices = Array.isArray(content.wrongChoices)
    ? content.wrongChoices.flatMap((w) => {
        const r = w as { choice?: unknown; reason?: unknown };
        return typeof r.choice === "number" && typeof r.reason === "string" && r.reason.trim()
          ? [{ choice: r.choice, reason: r.reason }]
          : [];
      })
    : [];
  return {
    questionNumber,
    questionType: typeof content.questionType === "string" ? content.questionType : null,
    keyPoints: strings(content.keyPoints),
    grammarPoints: strings(content.grammarPoints),
    answerRationale: typeof content.answerRationale === "string" ? content.answerRationale : null,
    wrongChoices,
    tags: strings(content.tags),
    origin,
  };
}

/** 공개 화면에 나가는 게시된 학습지 */
export interface PublishedWorksheet {
  type: WorksheetFileType;
  fileId: string;
  origin: StudyMaterialOrigin;
}

// ── 영어 자료 현황 ───────────────────────────────────────────

export type AvailabilityState = "available" | "processing" | "none";

export interface EnglishAvailabilityInput {
  fileTypes: FileType[];
  processingTypes: FileType[];
  vocabularyCount: number;
  /** 공개 가능한 대본이 있는 문항 수 */
  transcriptCount: number;
  /** 구간이 검증된 문항 트랙 수 */
  verifiedSegmentCount: number;
  questionCount: number;
  explainedQuestionCount: number;
  readingNotes: ReadingNote[];
  /** 검토 대기·검토 중인 생성 자료 종류 */
  pendingMaterialKinds: string[];
  publishedWorksheetTypes: FileType[];
}

export interface EnglishAvailabilityItem {
  key: string;
  label: string;
  state: AvailabilityState;
  detail: string | null;
  href: string | null;
}

export function englishAvailability(i: EnglishAvailabilityInput): EnglishAvailabilityItem[] {
  const file = (type: FileType): AvailabilityState =>
    i.fileTypes.includes(type)
      ? "available"
      : i.processingTypes.includes(type)
        ? "processing"
        : "none";
  const pending = (kinds: string[]) => kinds.some((k) => i.pendingMaterialKinds.includes(k));
  const worksheetTypes: FileType[] = [
    "vocabulary_test",
    "vocabulary_test_answers",
    "dictation_sheet",
    "dictation_answers",
    "question_checklist",
  ];
  const publishedWorksheets = worksheetTypes.filter((t) => i.publishedWorksheetTypes.includes(t));
  const notesWith = (pick: (n: ReadingNote) => boolean) => i.readingNotes.filter(pick).length;
  const grammar = notesWith((n) => n.grammarPoints.length > 0);
  const types = notesWith((n) => Boolean(n.questionType));

  return [
    {
      key: "question",
      label: "문제 PDF",
      state: file("question"),
      detail: null,
      href: "#files-heading",
    },
    {
      key: "solution",
      label: "정답·해설 PDF",
      state: file("solution"),
      detail: null,
      href: "#files-heading",
    },
    {
      key: "listening_audio",
      label: "듣기 음원",
      state: file("listening_audio"),
      detail:
        i.fileTypes.includes("listening_audio") && i.verifiedSegmentCount === 0
          ? "전체 재생 (문항 구간 미검증)"
          : i.verifiedSegmentCount > 0
            ? `문항별 구간 ${i.verifiedSegmentCount}개`
            : null,
      href: "#listening",
    },
    {
      key: "listening_script",
      label: "듣기 대본",
      state:
        i.transcriptCount > 0 || i.fileTypes.includes("listening_script")
          ? "available"
          : file("listening_script"),
      detail: i.transcriptCount > 0 ? `문항별 대본 ${i.transcriptCount}개` : null,
      href: i.transcriptCount > 0 ? "#listening" : "#files-heading",
    },
    {
      key: "vocabulary",
      label: "단어장",
      state:
        i.vocabularyCount > 0 || i.fileTypes.includes("vocabulary_pdf")
          ? "available"
          : pending(["vocabulary_pdf"])
            ? "processing"
            : "none",
      detail: i.vocabularyCount > 0 ? `${i.vocabularyCount}단어` : null,
      href: i.vocabularyCount > 0 ? "#vocabulary" : null,
    },
    {
      key: "dictation",
      label: "받아쓰기",
      state: i.transcriptCount > 0 ? "available" : "none",
      detail: i.transcriptCount > 0 ? `${i.transcriptCount}문항` : null,
      href: i.transcriptCount > 0 ? "#dictation" : null,
    },
    {
      key: "explanations",
      label: "문항별 해설",
      state: i.explainedQuestionCount > 0 ? "available" : "none",
      detail:
        i.questionCount > 0
          ? `웹 정답 ${i.questionCount}문항${i.explainedQuestionCount ? ` · 해설 ${i.explainedQuestionCount}문항` : ""}`
          : null,
      href: i.questionCount > 0 ? "#questions" : null,
    },
    {
      key: "grammar",
      label: "문법·구문",
      state: grammar > 0 ? "available" : pending([READING_NOTE_KIND]) ? "processing" : "none",
      detail: grammar > 0 ? `${grammar}문항` : null,
      href: grammar > 0 ? "#reading" : null,
    },
    {
      key: "question_type",
      label: "문제 유형",
      state: types > 0 ? "available" : pending([READING_NOTE_KIND]) ? "processing" : "none",
      detail: types > 0 ? `${types}문항` : null,
      href: types > 0 ? "#reading" : null,
    },
    {
      key: "worksheets",
      label: "학습지",
      state:
        publishedWorksheets.length > 0
          ? "available"
          : pending(worksheetTypes)
            ? "processing"
            : "none",
      detail: publishedWorksheets.length > 0 ? `${publishedWorksheets.length}종` : null,
      href: publishedWorksheets.length > 0 ? "#worksheets" : null,
    },
  ];
}
