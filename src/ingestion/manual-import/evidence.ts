import { inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { artifactReviewNotes } from "@/db/schema";

/**
 * 검토 근거 (운영자 입력 자료). 관리자 화면에 사유와 함께 보여 주고, 승인 판단에 쓴다.
 * 근거가 있다고 자동 승인하지 않는다 — 게시는 항상 관리자 승인(브라우저 확인) 이후.
 */
export type ReviewEvidence =
  /** 검색엔진 공개 색인 결과에서 발견 (URL 은 결과 그대로) */
  | { kind: "search_result"; query: string; title: string }
  /** SafeFetcher 로 존재·형식만 확인 (앞부분만 받음) */
  | {
      kind: "url_check";
      status: number;
      contentType: string;
      pdfSignature: boolean;
      checkedAt: string;
    }
  /** 브라우저로 열어 PDF 확인 */
  | {
      kind: "browser_check";
      status: number;
      contentType: string;
      bytes?: number;
      pdfPages?: number;
      checkedAt: string;
    }
  /** 1쪽 머리말 텍스트 */
  | { kind: "page1_header"; text: string }
  /** 문서 안에서 찾은 시험 문구 (예: 2025학년도3월고1전국연합학력평가) */
  | { kind: "exam_line"; text: string | null }
  /** 사람이 화면을 보고 확인한 내용 */
  | { kind: "visual_check"; note: string }
  /** 후보 분류 근거 (어떤 방법으로 과목을 정했는지 · 점수) */
  | { kind: "classification"; via: string; score: number };

export type ReviewReasonCode =
  | "no_exam_identity"
  | "exam_month_unconfirmed"
  | "subject_mismatch"
  | "ambiguous_variant"
  | "course_unconfirmed"
  | "slot_conflict"
  | "duplicate_file"
  | "type_mismatch"
  | "secondary_document"
  | "url_check_failed"
  | "other";

export const REASON_LABELS: Record<ReviewReasonCode, string> = {
  no_exam_identity: "문서에 시행 연도·월·학년 표기 없음",
  exam_month_unconfirmed: "시험 월 미확인 (경로 날짜가 시행일이 아닐 수 있음)",
  subject_mismatch: "문서 과목이 CSV 와 다름",
  ambiguous_variant: "A/B 변형 — 선택과목 구분 미확인",
  course_unconfirmed: "세부과목 코드 미확인",
  slot_conflict: "같은 슬롯에 서로 다른 파일",
  duplicate_file: "같은 파일의 다른 번호",
  type_mismatch: "제목과 파일명의 자료 종류가 다름",
  secondary_document: "정답표·짝수형 등 보조 자료",
  url_check_failed: "URL 확인 실패",
  other: "기타",
};

export interface ReviewNote {
  artifactId: string;
  reasonCode: string | null;
  reason: string | null;
  evidence: ReviewEvidence[];
  updatedBy: string | null;
  updatedAt: Date;
}

/** 근거 조회. 테이블이 아직 없으면(migration 전) 빈 결과 */
export async function loadReviewNotes(
  db: Database,
  artifactIds: string[],
): Promise<Map<string, ReviewNote>> {
  if (artifactIds.length === 0) return new Map();
  try {
    const rows = await db
      .select()
      .from(artifactReviewNotes)
      .where(inArray(artifactReviewNotes.artifactId, artifactIds));
    return new Map(
      rows.map((r) => [
        r.artifactId,
        { ...r, evidence: r.evidence as unknown as ReviewEvidence[] },
      ]),
    );
  } catch {
    return new Map();
  }
}

/** 근거 저장 (같은 artifact 는 덮어쓴다). 상태는 바꾸지 않는다 */
export async function upsertReviewNote(
  db: Pick<Database, "insert">,
  input: {
    artifactId: string;
    reasonCode?: ReviewReasonCode | null;
    reason?: string | null;
    evidence: ReviewEvidence[];
    updatedBy: string;
    now: Date;
  },
): Promise<void> {
  const values = {
    artifactId: input.artifactId,
    reasonCode: input.reasonCode ?? null,
    reason: input.reason?.slice(0, 500) ?? null,
    evidence: input.evidence as unknown as Array<Record<string, unknown>>,
    updatedBy: input.updatedBy,
    updatedAt: input.now,
  };
  await db
    .insert(artifactReviewNotes)
    .values(values)
    .onConflictDoUpdate({
      target: artifactReviewNotes.artifactId,
      set: {
        reasonCode: sql`excluded.reason_code`,
        reason: sql`excluded.reason`,
        evidence: sql`excluded.evidence`,
        updatedBy: sql`excluded.updated_by`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}
