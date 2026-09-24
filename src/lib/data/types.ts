import type {
  ArtifactOrigin,
  ExamType,
  FileDeliveryType,
  FileType,
  Grade,
  GradeCutSource,
  ReportCategory,
  ReportStatus,
  Subject,
} from "../constants";

/**
 * 화면/비즈니스 로직에서 쓰는 도메인 타입.
 * DB row 타입(src/db/schema.ts)과 분리해 두어 mock 저장소와 Drizzle 저장소가
 * 같은 형태의 데이터를 돌려주도록 한다.
 */

export interface Exam {
  id: string;
  year: number;
  grade: Grade;
  month: number;
  /** 대입 학년도 (평가원 모의평가·수능만). year 는 항상 시행 연도 */
  academicYear: number | null;
  examType: ExamType;
  organizer: string;
  examDate: string | null;
  slug: string;
  /** 개발용 샘플 데이터 여부. true면 화면에 "샘플" 표시가 붙는다. */
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExamSubject {
  examId: string;
  subject: Subject;
  /** 자동 수집으로 생성된 과목은 문항 구성을 모를 수 있다 */
  questionCount: number | null;
  totalScore: number | null;
}

export interface ExamFile {
  id: string;
  examId: string;
  subject: Subject;
  type: FileType;
  /** storage: 우리 스토리지 / redirect: 검증된 공식 원본 URL. 화면은 이 구분을 몰라도 된다. */
  deliveryType: FileDeliveryType;
  storageKey: string | null;
  /** 서버(다운로드 API)에서만 사용. 화면에 직접 렌더링하지 않는다. */
  externalUrl: string | null;
  artifactOrigin: ArtifactOrigin;
  sourceArtifactId: string | null;
  /** 화면 표시용 출처명 (예: "EBSi") */
  sourceLabel: string | null;
  mimeType: string;
  fileSize: number | null;
  originalFileName: string;
  createdAt: string;
  updatedAt: string;
}

export interface Question {
  id: string;
  examId: string;
  subject: Subject;
  questionNumber: number;
  /** 객관식은 "1"~"5", 단답형은 숫자 문자열 */
  answer: string;
  /** 객관식 보기 수. 단답형이면 null */
  choiceCount: number | null;
  score: number;
  explanation: string | null;
  /** 정답·해설 PDF 내 페이지 번호 (향후 PDF 뷰어 연동용) */
  solutionPage: number | null;
}

export interface QuestionStatistic {
  id: string;
  questionId: string;
  /** 0~100 */
  correctRate: number;
  /** 보기별 선택 비율(%) — index 0 = ①번 */
  answerDistribution: number[] | null;
  statisticsSource: string;
  statisticsSourceUrl: string | null;
  isSample: boolean;
  statisticsUpdatedAt: string;
}

export interface QuestionWithStats extends Question {
  statistic: QuestionStatistic | null;
}

export interface VocabularyItem {
  id: string;
  examId: string;
  questionId: string | null;
  questionNumber: number;
  word: string;
  meaning: string;
  partOfSpeech: string | null;
  difficulty: 1 | 2 | 3;
  createdAt: string;
}

export interface TranscriptLine {
  speaker: string | null;
  text: string;
}

export interface ListeningTrack {
  id: string;
  examId: string;
  fileId: string;
  /** null이면 전체 듣기 트랙 */
  questionNumber: number | null;
  label: string;
  startSeconds: number;
  endSeconds: number;
  transcript: TranscriptLine[] | null;
}

export interface GradeCutEntry {
  grade: number;
  rawScore: number;
}

export interface GradeCut {
  id: string;
  examId: string;
  subject: Subject;
  source: GradeCutSource;
  sourceUrl: string | null;
  isOfficial: boolean;
  isSample: boolean;
  cuts: GradeCutEntry[];
  updatedAt: string;
}

export interface Report {
  id: string;
  examId: string;
  fileId: string | null;
  subject: Subject | null;
  category: ReportCategory;
  message: string | null;
  status: ReportStatus;
  createdAt: string;
}

export interface NewReport {
  examId: string;
  fileId: string | null;
  subject: Subject | null;
  category: ReportCategory;
  message: string | null;
  ipHash: string | null;
}

export interface ExamSchedule {
  id: string;
  year: number;
  grade: Grade;
  month: number;
  examType: ExamType;
  organizer: string;
  /** YYYY-MM-DD (KST) */
  examDate: string;
  expectedReleaseStart: string | null;
  expectedReleaseEnd: string | null;
  status: "scheduled" | "watching" | "published" | "completed" | "cancelled";
  announcementUrl: string | null;
  isSample: boolean;
  examId: string | null;
}

/** 시험 상세 과목 페이지에 필요한 데이터 묶음 */
export interface ExamSubjectDetail {
  exam: Exam;
  subjects: ExamSubject[];
  subject: ExamSubject;
  files: ExamFile[];
  questions: QuestionWithStats[];
  gradeCuts: GradeCut[];
  vocabulary: VocabularyItem[];
  listeningTracks: ListeningTrack[];
  /** 확정된 시험 일정 (시험 전 페이지 표시용) */
  schedule: ExamSchedule | null;
}
