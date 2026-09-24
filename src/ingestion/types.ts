import type {
  ArtifactDeliveryPolicy,
  ExamSourceKind,
  ExamType,
  FileType,
  Grade,
  Subject,
} from "../lib/constants";
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
}

/** discoverArtifacts 입력: canonical identity + (있으면) source 내부 위치 */
export interface ExamLocator extends CanonicalExam {
  externalId?: string;
  sourceUrl?: string;
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
  healthCheck(): Promise<SourceHealth>;
}
