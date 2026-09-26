import type { Subject } from "./constants";
import { regimeFor, type RegimeCode } from "./regimes";

/**
 * 선택과목/세부과목(course) 카탈로그.
 * code 는 URL 에 쓰는 안정적인 식별자이며 절대 바꾸지 않는다. (DB courses.code 와 동일)
 * aliases: 정규화(normalizeCourseLabel) 후 정확히 같은 이름일 때만 쓰는 공식 명칭/흔한 표기
 * abbreviations: 단독 토큰일 때만 인정하는 약칭 (예: "사문", "생윤")
 */
export interface CourseDefinition {
  code: string;
  name: string;
  subject: Subject;
  displayOrder: number;
  aliases: string[];
  abbreviations: string[];
  /**
   * 이 세부과목이 존재할 수 있는 시험 체제와 학년. 체제 밖 시험에서 발견되면 추정하지 않고 manual_review.
   * (source 표기를 덮어쓰지 않는다 — 검증에만 쓴다)
   */
  regimes: Array<{ regime: RegimeCode; grades?: Array<1 | 2 | 3> }>;
}

/** 2015 개정 교육과정 수능 선택과목 (2022~2027학년도 체제), 고2·고3 시험 */
const R2022_ELECTIVE: CourseDefinition["regimes"] = [{ regime: "csat_2022", grades: [2, 3] }];
/** 직업탐구·제2외국어/한문: 공식 EBSi 기출 목록에서 확인된 고2·고3 시험 */
const R2022_UPPER: CourseDefinition["regimes"] = [{ regime: "csat_2022", grades: [3] }];

/** 2021학년도 이전 공식 자료에서 확인된 과거 과목. 현대 체제에는 노출하지 않는다. */
const LEGACY_COURSE_ROWS = [
  ["accounting-principles", "회계 원리", "vocational"],
  ["agriculture-understanding", "농업 이해", "vocational"],
  ["basic-drafting", "기초 제도", "vocational"],
  ["math-a", "수학 가형", "math"],
  ["math-b", "수학 나형", "math"],
  ["ocean-understanding", "해양의 이해", "vocational"],
  ["service-industry-understanding", "생활 서비스 산업의 이해", "vocational"],
  ["chemistry-general", "화학", "science"],
  ["earth-science-general", "지구과학", "science"],
  ["general-social", "일반사회", "social"],
  ["geography-general", "지리", "social"],
  ["life-and-ethics-general", "생활과 윤리", "social"],
  ["life-science-general", "생명과학", "science"],
  ["physics-general", "물리", "science"],
  ["science-studies", "과학탐구", "science"],
  ["social-studies", "사회탐구", "social"],
  ["social-science-studies", "사회·과학탐구", "social"],
  ["agriculture-bio-industry", "농생명산업", "vocational"],
  ["commerce-information", "상업정보", "vocational"],
  ["fisheries-shipping", "수산해운", "vocational"],
  ["home-economics-industry", "가사실업", "vocational"],
  ["industry", "공업", "vocational"],
  ["korean-a", "국어 A형", "korean"],
  ["korean-b", "국어 B형", "korean"],
  ["morality", "도덕", "social"],
  ["english-a", "영어 A", "english"],
  ["english-b", "영어 B", "english"],
  ["agriculture-information", "농업정보관리", "vocational"],
  ["computer-general", "컴퓨터일반", "vocational"],
  ["design-general", "디자인일반", "vocational"],
  ["economic-geography", "경제지리", "social"],
  ["english-old", "외국어", "english"],
  ["ethics", "윤리", "social"],
  ["fisheries-general", "수산일반", "vocational"],
  ["fisheries-shipping-information", "수산해운정보처리", "vocational"],
  ["food-and-nutrition", "식품과영양", "vocational"],
  ["industry-intro", "공업입문", "vocational"],
  ["information-technology-basics", "정보기술기초", "vocational"],
  ["korean-modern-history", "한국근·현대사", "history"],
  ["korean-old", "언어", "korean"],
  ["maritime-general", "해사일반", "vocational"],
  ["ocean-general", "해양일반", "vocational"],
  ["politics", "정치", "social"],
  ["programming", "프로그래밍", "vocational"],
  ["law-and-society", "법과사회", "social"],
] as const;

const LEGACY_COURSES: CourseDefinition[] = LEGACY_COURSE_ROWS.map(
  ([code, name, subject], index) => ({
    code,
    name,
    subject,
    displayOrder: 1000 + index,
    aliases: [],
    abbreviations: [],
    regimes: [{ regime: "legacy" }],
  }),
);

export const COURSE_CATALOG: CourseDefinition[] = [
  // ── 국어 선택 ──
  {
    code: "speech-and-writing",
    name: "화법과 작문",
    subject: "korean",
    displayOrder: 10,
    aliases: ["화법과작문"],
    abbreviations: ["화작"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "language-and-media",
    name: "언어와 매체",
    subject: "korean",
    displayOrder: 20,
    aliases: ["언어와매체"],
    abbreviations: ["언매"],
    regimes: R2022_ELECTIVE,
  },
  // ── 수학 선택 ──
  {
    code: "probability-and-statistics",
    name: "확률과 통계",
    subject: "math",
    displayOrder: 10,
    aliases: ["확률과통계"],
    abbreviations: ["확통"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "calculus",
    name: "미적분",
    subject: "math",
    displayOrder: 20,
    aliases: ["미적분"],
    abbreviations: [],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "geometry",
    name: "기하",
    subject: "math",
    displayOrder: 30,
    aliases: ["기하"],
    abbreviations: [],
    regimes: R2022_ELECTIVE,
  },
  // ── 사회탐구 ──
  {
    code: "integrated-social",
    name: "통합사회",
    subject: "social",
    displayOrder: 5,
    aliases: ["통합사회"],
    abbreviations: ["통사"],
    regimes: [{ regime: "csat_2022", grades: [1] }, { regime: "csat_2028" }],
  },
  {
    code: "life-and-ethics",
    name: "생활과 윤리",
    subject: "social",
    displayOrder: 10,
    aliases: ["생활과윤리"],
    abbreviations: ["생윤"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "ethics-and-thought",
    name: "윤리와 사상",
    subject: "social",
    displayOrder: 20,
    aliases: ["윤리와사상"],
    abbreviations: ["윤사"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "korean-geography",
    name: "한국지리",
    subject: "social",
    displayOrder: 30,
    aliases: ["한국지리"],
    abbreviations: ["한지"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "world-geography",
    name: "세계지리",
    subject: "social",
    displayOrder: 40,
    aliases: ["세계지리"],
    abbreviations: ["세지"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "east-asian-history",
    name: "동아시아사",
    subject: "social",
    displayOrder: 50,
    aliases: ["동아시아사"],
    abbreviations: ["동사"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "world-history",
    name: "세계사",
    subject: "social",
    displayOrder: 60,
    aliases: ["세계사"],
    abbreviations: [],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "economics",
    name: "경제",
    subject: "social",
    displayOrder: 70,
    aliases: ["경제"],
    abbreviations: [],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "politics-and-law",
    name: "정치와 법",
    subject: "social",
    displayOrder: 80,
    aliases: ["정치와법"],
    abbreviations: ["정법"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "social-culture",
    name: "사회·문화",
    subject: "social",
    displayOrder: 90,
    aliases: ["사회문화"],
    abbreviations: ["사문"],
    regimes: R2022_ELECTIVE,
  },
  // ── 과학탐구 ──
  {
    code: "integrated-science",
    name: "통합과학",
    subject: "science",
    displayOrder: 5,
    aliases: ["통합과학"],
    abbreviations: ["통과"],
    regimes: [{ regime: "csat_2022", grades: [1] }, { regime: "csat_2028" }],
  },
  {
    code: "physics-1",
    name: "물리학 I",
    subject: "science",
    displayOrder: 10,
    aliases: ["물리학1", "물리1"],
    abbreviations: ["물1"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "chemistry-1",
    name: "화학 I",
    subject: "science",
    displayOrder: 20,
    aliases: ["화학1"],
    abbreviations: ["화1"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "life-science-1",
    name: "생명과학 I",
    subject: "science",
    displayOrder: 30,
    aliases: ["생명과학1", "생명1"],
    abbreviations: ["생1"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "earth-science-1",
    name: "지구과학 I",
    subject: "science",
    displayOrder: 40,
    aliases: ["지구과학1", "지구1"],
    abbreviations: ["지1"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "physics-2",
    name: "물리학 II",
    subject: "science",
    displayOrder: 50,
    aliases: ["물리학2", "물리2"],
    abbreviations: ["물2"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "chemistry-2",
    name: "화학 II",
    subject: "science",
    displayOrder: 60,
    aliases: ["화학2"],
    abbreviations: ["화2"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "life-science-2",
    name: "생명과학 II",
    subject: "science",
    displayOrder: 70,
    aliases: ["생명과학2", "생명2"],
    abbreviations: ["생2"],
    regimes: R2022_ELECTIVE,
  },
  {
    code: "earth-science-2",
    name: "지구과학 II",
    subject: "science",
    displayOrder: 80,
    aliases: ["지구과학2", "지구2"],
    abbreviations: ["지2"],
    regimes: R2022_ELECTIVE,
  },
  // ── 직업탐구 (2022~2027학년도 체제, 고2·고3) ──
  {
    code: "agriculture-basics",
    name: "농업 기초 기술",
    subject: "vocational",
    displayOrder: 10,
    aliases: ["농업기초기술"],
    abbreviations: [],
    regimes: R2022_UPPER,
  },
  {
    code: "industry-general",
    name: "공업 일반",
    subject: "vocational",
    displayOrder: 20,
    aliases: ["공업일반"],
    abbreviations: [],
    regimes: R2022_UPPER,
  },
  {
    code: "commercial-economics",
    name: "상업 경제",
    subject: "vocational",
    displayOrder: 30,
    aliases: ["상업경제"],
    abbreviations: [],
    regimes: R2022_UPPER,
  },
  {
    code: "fisheries-and-shipping",
    name: "수산·해운 산업 기초",
    subject: "vocational",
    displayOrder: 40,
    aliases: ["수산해운산업기초"],
    abbreviations: [],
    regimes: R2022_UPPER,
  },
  {
    code: "human-development",
    name: "인간 발달",
    subject: "vocational",
    displayOrder: 50,
    aliases: ["인간발달"],
    abbreviations: [],
    regimes: R2022_UPPER,
  },
  {
    code: "successful-career-life",
    name: "성공적인 직업 생활",
    subject: "vocational",
    displayOrder: 60,
    aliases: ["성공적인직업생활"],
    abbreviations: [],
    // 2028 체제의 직업탐구 구성은 확정 자료(실제 시험)로 확인되지 않아 포함하지 않는다 → 발견 시 manual_review
    regimes: R2022_UPPER,
  },
  // ── 제2외국어/한문 (2022~2027학년도 체제, 고2·고3) ──
  ...(
    [
      ["german-1", "독일어 I", "독일어1"],
      ["french-1", "프랑스어 I", "프랑스어1"],
      ["spanish-1", "스페인어 I", "스페인어1"],
      ["chinese-1", "중국어 I", "중국어1"],
      ["japanese-1", "일본어 I", "일본어1"],
      ["russian-1", "러시아어 I", "러시아어1"],
      ["arabic-1", "아랍어 I", "아랍어1"],
      ["vietnamese-1", "베트남어 I", "베트남어1"],
      ["classical-chinese-1", "한문 I", "한문1"],
    ] as const
  ).map(([code, name, alias], i): CourseDefinition => ({
    code,
    name,
    subject: "second_language",
    displayOrder: (i + 1) * 10,
    aliases: [alias],
    abbreviations: [],
    regimes: R2022_UPPER,
  })),
  ...LEGACY_COURSES,
];

/**
 * 어느 course 인지 확정할 수 없는 표기. 자동으로 추정하지 않고 manual_review 로 보낸다.
 * (관리자가 mapping 하면 course_aliases 에 저장되어 다음 수집부터 재사용된다)
 */
export const AMBIGUOUS_COURSE_LABELS: Record<string, string[]> = {
  윤리: ["life-and-ethics", "ethics-and-thought"],
  지리: ["korean-geography", "world-geography"],
  역사: ["east-asian-history", "world-history"],
  물리: ["physics-1", "physics-2"],
  물리학: ["physics-1", "physics-2"],
  화학: ["chemistry-1", "chemistry-2"],
  생명과학: ["life-science-1", "life-science-2"],
  생명: ["life-science-1", "life-science-2"],
  지구과학: ["earth-science-1", "earth-science-2"],
  지구: ["earth-science-1", "earth-science-2"],
  수학선택: ["probability-and-statistics", "calculus", "geometry"],
  국어선택: ["speech-and-writing", "language-and-media"],
  // 로마 숫자 없는 언어 과목명: 체제에 따라 과목 구성이 다를 수 있어 확정하지 않는다
  독일어: ["german-1"],
  프랑스어: ["french-1"],
  스페인어: ["spanish-1"],
  중국어: ["chinese-1"],
  일본어: ["japanese-1"],
  러시아어: ["russian-1"],
  아랍어: ["arabic-1"],
  베트남어: ["vietnamese-1"],
  한문: ["classical-chinese-1"],
};

/** 세부과목 선택이 필요한 영역 (탐구·제2외국어) */
export const COURSE_BASED_SUBJECTS: Subject[] = [
  "social",
  "science",
  "vocational",
  "second_language",
];

export const SUBJECT_AREA_LABELS: Partial<Record<Subject, string>> = {
  social: "사회탐구",
  science: "과학탐구",
  vocational: "직업탐구",
  second_language: "제2외국어/한문",
};

export function courseByCode(code: string): CourseDefinition | undefined {
  return COURSE_CATALOG.find((c) => c.code === code);
}

export function coursesForSubject(
  subject: Subject,
  options: { includeLegacy?: boolean } = {},
): CourseDefinition[] {
  return COURSE_CATALOG.filter(
    (c) =>
      c.subject === subject &&
      (options.includeLegacy || !c.regimes.every((r) => r.regime === "legacy")),
  ).sort((a, b) => a.displayOrder - b.displayOrder);
}

export function isCourseCode(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && Boolean(courseByCode(value));
}

/** SEO 제목용: "사회·문화" → "사회문화", "물리학 I" 는 그대로 */
export function courseSeoName(name: string): string {
  return name.replace(/·/g, "");
}

export type CourseExpectation =
  /** 이 체제·학년 시험에 있을 수 있는 과목 */
  | "expected"
  /** 체제 목록에 없는 과목 (예: 2028 체제 시험의 물리학 I, 고1 시험의 사회·문화) */
  | "unexpected"
  /** 과목 구성이 확인되지 않은 체제 (legacy) */
  | "unknown";

/** 세부과목이 특정 시험(연도·학년)에 존재할 수 있는지 (체제 카탈로그 기준) */
export function courseExpectation(
  code: string,
  exam: { year: number; grade: number },
): CourseExpectation {
  const regime = regimeFor(exam);
  if (!regime.courseSetKnown) return "unknown";
  const course = courseByCode(code);
  if (!course) return "unexpected";
  const entry = course.regimes.find((r) => r.regime === regime.code);
  if (!entry) return "unexpected";
  return !entry.grades || entry.grades.includes(exam.grade as 1 | 2 | 3)
    ? "expected"
    : "unexpected";
}

/** 체제에 존재할 수 있는 세부과목 목록 (관리자 화면/coverage 참고용) */
export function coursesForExam(subject: Subject, exam: { year: number; grade: number }) {
  const regime = regimeFor(exam).code;
  return COURSE_CATALOG.filter(
    (c) =>
      c.subject === subject &&
      (courseExpectation(c.code, exam) === "expected" ||
        (regime === "legacy" && c.regimes.some((r) => r.regime === "legacy"))),
  ).sort((a, b) => a.displayOrder - b.displayOrder);
}
