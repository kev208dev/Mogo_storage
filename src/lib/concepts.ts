/**
 * 개념 태그 (문항 ↔ 개념). 순수 함수 — 파서·게시·관리자 화면이 공유한다.
 *
 * 개념 후보는 공식 정답·해설 PDF 의 문항 머리말 제목에서만 나온다 ("1. 탄소 화합물",
 * "1. [출제 의도] 목적 파악"). 규칙으로 정리하고, 확신할 수 없는 것은 manual_review 로 남긴다.
 * 제목을 지어내거나 요약하지 않는다.
 */

export const CONCEPT_STATUSES = ["approved", "manual_review", "rejected"] as const;
export type ConceptStatus = (typeof CONCEPT_STATUSES)[number];
export const CONCEPT_SOURCES = ["solution_heading", "manual"] as const;
export type ConceptSource = (typeof CONCEPT_SOURCES)[number];

/** "[출제 의도]", "[출제의도]", "출제의도 :" 같은 머리 표지 */
const INTENT_PREFIX = /^\[?\s*출제\s*의도\s*\]?\s*[:：]?\s*/;
/** 문장형 출제의도("출제의도 : 지수법칙을 이용하여 식의") — 줄바꿈으로 잘린 문장일 수 있다 */
const SENTENCE_PREFIX = /^출제\s*의도\s*[:：]/;
const FORBIDDEN = /[①-⑤?？]|정답|해설|\[\d+점\]/;
export const CONCEPT_NAME_MAX = 40;

export interface NormalizedConcept {
  name: string;
  slug: string;
  /** 문장형 출제의도에서 나온 이름 (잘렸을 수 있음 → 자동 승인하지 않는다) */
  sentence: boolean;
}

/** 표기만 통일한다: NFKC, 가운뎃점, 공백, 앞뒤 문장부호 */
export function canonicalConceptName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[・•ㆍ]/g, "·")
    .replace(/\s*·\s*/g, "·")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:：.·,]+|[\s\-–—:：.·,]+$/g, "")
    .trim();
}

export function conceptSlug(name: string): string {
  return canonicalConceptName(name)
    .toLowerCase()
    .replace(/[\s·,()[\]/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeConceptName(raw: string | null | undefined): NormalizedConcept | null {
  if (!raw) return null;
  const text = raw.normalize("NFKC").trim();
  const sentence = SENTENCE_PREFIX.test(text);
  const name = canonicalConceptName(text.replace(INTENT_PREFIX, ""));
  if (name.length < 2 || name.length > CONCEPT_NAME_MAX) return null;
  if (FORBIDDEN.test(name)) return null;
  // 숫자·기호만 있거나 한글·영문이 없는 제목은 개념이 아니다
  if (!/[가-힣A-Za-z]/.test(name)) return null;
  const slug = conceptSlug(name);
  if (!slug) return null;
  return { name, slug, sentence };
}

export interface HeadingEvidence {
  number: number;
  heading: string | null;
  headingForm: "leading" | "trailing" | null;
  reordered: boolean;
  page: number | null;
}

export interface ConceptCandidate extends NormalizedConcept {
  status: Exclude<ConceptStatus, "rejected">;
  confidence: number;
  /** 근거: 머리말 원문과 해설지 쪽 (해설 본문은 담지 않는다) */
  evidence: string;
  reason: string | null;
}

/**
 * 머리말 → 개념 후보.
 * 자동 승인은 "검증된 정답표 + 번호가 앞에 오는 정상 머리말 + 순서가 흩어지지 않은 표 + 명사형 제목"일 때만.
 */
export function conceptCandidate(
  entry: HeadingEvidence,
  slotVerified: boolean,
): ConceptCandidate | null {
  const normalized = normalizeConceptName(entry.heading);
  if (!normalized) return null;
  const evidence = `${entry.number}. ${entry.heading}${entry.page ? ` (해설지 ${entry.page}쪽)` : ""}`;
  let reason: string | null = null;
  let confidence = 0.9;
  if (!slotVerified) {
    reason = "정답표 검증 전";
    confidence = 0.5;
  } else if (normalized.sentence) {
    reason = "문장형 출제의도 (줄바꿈으로 잘렸을 수 있음)";
    confidence = 0.3;
  } else if (entry.headingForm !== "leading") {
    reason = "텍스트 층에서 번호 위치가 흩어진 머리말";
    confidence = 0.6;
  } else if (entry.reordered) {
    reason = "순서가 흩어진 정답표";
    confidence = 0.6;
  }
  return {
    ...normalized,
    status: reason ? "manual_review" : "approved",
    confidence,
    evidence: evidence.slice(0, 200),
    reason,
  };
}
