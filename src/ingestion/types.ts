import type {
  ArtifactDeliveryPolicy,
  ExamSourceKind,
  ExamType,
  FileType,
  Grade,
  Subject,
} from "../lib/constants";
import type { CourseResolution } from "./canonical/course";
import type { SourceHealthStatus } from "./constants";

/** exam_sources 한 행에 대응하는 설정 (코드 기본값 + DB 값 병합 결과) */
export interface SourceConfig {
  id: string;
  kind: ExamSourceKind;
  name: string;
  baseUrl: string;
  /** SSRF 방지용 허용 host (정확히 일치 또는 ".example.com" 접미사) */
  allowedHosts: string[];
  deliveryPolicy: ArtifactDeliveryPolicy;
  enabled: boolean;
  /** 실제 페이지 fixture 로 검증·승인됐고 parser 버전이 그대로인지 (DB 상태에서 계산) */
  liveVerified: boolean;
  minPollIntervalSeconds: number;
  requestTimeoutMs: number;
  maxConcurrentRequests: number;
  minRequestGapMs: number;
  maxRetries: number;
}

/** 내부 시험 identity. year 는 항상 "시행 연도" */
export interface CanonicalExam {
  year: number;
  grade: Grade;
  month: number;
  examType: ExamType;
  /** 대입 학년도 (평가원 모의평가·수능만, 그 외 null) */
  academicYear: number | null;
}

export interface DiscoverOptions {
  fromYear?: number;
  toYear?: number;
  grade?: Grade;
  month?: number;
  signal?: AbortSignal;
}

export interface DiscoveredExam {
  /** source 안에서 안정적인 id (중복 방지 키) */
  externalId: string;
  sourceUrl: string;
  /** source 가 표기한 원래 시험명 */
  title: string;
  canonical: CanonicalExam;
  examDate: string | null;
  metadata: Record<string, unknown>;
}

export interface DiscoveredArtifact {
  subject: Subject;
  type: FileType;
  url: string;
  /** 원본 표기 (예: "정답 및 해설") — 같은 슬롯 후보 중 선택에 사용 */
  label: string;
  fileNameHint: string | null;
  publishedAt: string | null;
  /** 세부과목 판정 결과 (코드 카탈로그 기준). 모호하면 ambiguous → manual_review */
  course: CourseResolution;
  /** 원래 과목 표기 (course 판정에 쓴 표기, 관리자 mapping 시 alias 로 저장) */
  courseLabel: string | null;
  /** file | archive (여러 과목이 든 zip 등 — 압축 해제는 아직 하지 않음) */
  containerType: "file" | "archive";
  containsMultipleCourses: boolean;
  /** source 가 표시한 영역 표기 원문 (예: "사회탐구", "제2외국어/한문") — canonical 후에도 버리지 않는다 */
  sourceSubjectLabel: string | null;
  /** source 원문 표기 전체 (영역 + 링크 표기). 예: "사회탐구 사회·문화 문제" */
  sourceLabel: string;
  /** source 가 제공한 공식 공개 예정 시각 (KICE 정답 공개시간 등). ISO, 없으면 undefined */
  officialReleaseAt?: string | null;
}

/** source 페이지 종류 (fixture metadata 의 pageType 과 같다) */
export const PAGE_TYPES = [
  "exam_list",
  "exam_detail",
  "exam_release_index",
  "listening_archive",
  "schedule",
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/** discoverArtifacts 입력: canonical identity + (있으면) source 내부 위치 */
export interface ExamLocator extends CanonicalExam {
  externalId?: string;
  sourceUrl?: string;
  /** sourceUrl 의 페이지 종류. 운영자가 공식 공지에서 등록한 KICE 시험별 index 등 */
  pageType?: PageType;
  /** 시험일 (공개 시각 표에 날짜가 없을 때 사용) */
  examDate?: string | null;
}

/** source 가 제공한 공식 공개 시각 (예: KICE 정답 공개시간). 시험마다 다르며 하드코딩하지 않는다 */
export interface DiscoveredReleaseTime {
  subject: Subject;
  course: CourseResolution;
  sourceLabel: string;
  rawTime: string;
  officialReleaseAt: string | null;
}

export interface SourceHealth {
  status: SourceHealthStatus;
  checkedAt: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * 공식 출처 adapter. 외부 source → 공통 canonical 구조 변환만 책임진다.
 * DB 저장, 검증, 게시 등 application logic 은 pipeline 이 담당한다.
 */
export interface ExamSourceAdapter {
  readonly source: SourceConfig;
  discoverExams(options: DiscoverOptions): Promise<DiscoveredExam[]>;
  discoverArtifacts(exam: ExamLocator): Promise<DiscoveredArtifact[]>;
  /**
   * 시험별 공개 시각 (지원하는 source 만). 자료 링크가 아직 없어도 공개 예정 시각을 알려준다.
   * locator.pageType = exam_release_index 인 경우에만 호출된다.
   */
  discoverReleaseTimes?(exam: ExamLocator): Promise<DiscoveredReleaseTime[]>;
  healthCheck(): Promise<SourceHealth>;
}
