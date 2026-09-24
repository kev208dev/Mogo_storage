import type { Grade } from "./constants";

/**
 * 시험 체제(regime): "특정 연도·학년의 시험에 어떤 세부과목이 존재할 수 있는가"를 표현한다.
 * 교육과정 관리가 목적이 아니라 parser 결과를 검증하는 용도다. source 표기를 덮어쓰지 않는다.
 *
 * 체제는 시험을 보는 학생이 치를 수능의 학년도(cohort)로 고른다:
 *   cohort = 시행연도 + (4 - 학년)   예) 2025년 고1 → 2028학년도 수능 대상
 * (같은 해 고1과 고3은 서로 다른 체제일 수 있다)
 */
export const REGIME_CODES = ["legacy", "csat_2022", "csat_2028"] as const;
export type RegimeCode = (typeof REGIME_CODES)[number];

export interface RegimeDefinition {
  code: RegimeCode;
  name: string;
  /** 적용 수능 학년도 범위 (포함). null = 제한 없음 */
  fromCohort: number | null;
  toCohort: number | null;
  /**
   * 세부과목 구성이 이 저장소에서 확인된 체제인지.
   *  - false(legacy): 과거 과목 체계가 다양해 목록 검증을 하지 않는다. 대신 정확한 과목명/관리자 alias 만 인정
   *  - provisional: 공지된 개편안 기준이며 실제 시험 자료로 확인되지 않음 → 목록 밖 과목은 manual_review
   */
  courseSetKnown: boolean;
  provisional: boolean;
  note: string;
}

export const EXAM_REGIMES: RegimeDefinition[] = [
  {
    code: "legacy",
    name: "2021학년도 이전 체제",
    fromCohort: null,
    toCohort: 2021,
    courseSetKnown: false,
    provisional: false,
    note: "가/나형 등 과거 과목 체계. source 표기를 보존하고 확실한 표기만 연결한다.",
  },
  {
    code: "csat_2022",
    name: "2022~2027학년도 선택과목 체제",
    fromCohort: 2022,
    toCohort: 2027,
    courseSetKnown: true,
    provisional: false,
    note: "국어·수학 선택과목, 사회/과학/직업탐구, 제2외국어/한문 선택.",
  },
  {
    code: "csat_2028",
    name: "2028학년도 이후 체제",
    fromCohort: 2028,
    toCohort: null,
    courseSetKnown: true,
    provisional: true,
    note: "선택과목 폐지 (통합사회·통합과학 등). 실제 시험 자료로 확인되기 전까지 잠정.",
  },
];

export function cohortYear(exam: { year: number; grade: Grade | number }): number {
  return exam.year + (4 - exam.grade);
}

export function regimeFor(exam: { year: number; grade: Grade | number }): RegimeDefinition {
  const cohort = cohortYear(exam);
  return (
    EXAM_REGIMES.find(
      (r) => (r.fromCohort ?? -Infinity) <= cohort && cohort <= (r.toCohort ?? Infinity),
    ) ?? EXAM_REGIMES[0]!
  );
}

export function regimeByCode(code: string): RegimeDefinition | undefined {
  return EXAM_REGIMES.find((r) => r.code === code);
}
