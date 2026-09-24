import type { Subject } from "./constants";

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
}

export const COURSE_CATALOG: CourseDefinition[] = [
  // ── 국어 선택 ──
  {
    code: "speech-and-writing",
    name: "화법과 작문",
    subject: "korean",
    displayOrder: 10,
    aliases: ["화법과작문"],
    abbreviations: ["화작"],
  },
  {
    code: "language-and-media",
    name: "언어와 매체",
    subject: "korean",
    displayOrder: 20,
    aliases: ["언어와매체"],
    abbreviations: ["언매"],
  },
  // ── 수학 선택 ──
  {
    code: "probability-and-statistics",
    name: "확률과 통계",
    subject: "math",
    displayOrder: 10,
    aliases: ["확률과통계"],
    abbreviations: ["확통"],
  },
  {
    code: "calculus",
    name: "미적분",
    subject: "math",
    displayOrder: 20,
    aliases: ["미적분"],
    abbreviations: [],
  },
  {
    code: "geometry",
    name: "기하",
    subject: "math",
    displayOrder: 30,
    aliases: ["기하"],
    abbreviations: [],
  },
  // ── 사회탐구 ──
  {
    code: "integrated-social",
    name: "통합사회",
    subject: "social",
    displayOrder: 5,
    aliases: ["통합사회"],
    abbreviations: ["통사"],
  },
  {
    code: "life-and-ethics",
    name: "생활과 윤리",
    subject: "social",
    displayOrder: 10,
    aliases: ["생활과윤리"],
    abbreviations: ["생윤"],
  },
  {
    code: "ethics-and-thought",
    name: "윤리와 사상",
    subject: "social",
    displayOrder: 20,
    aliases: ["윤리와사상"],
    abbreviations: ["윤사"],
  },
  {
    code: "korean-geography",
    name: "한국지리",
    subject: "social",
    displayOrder: 30,
    aliases: ["한국지리"],
    abbreviations: ["한지"],
  },
  {
    code: "world-geography",
    name: "세계지리",
    subject: "social",
    displayOrder: 40,
    aliases: ["세계지리"],
    abbreviations: ["세지"],
  },
  {
    code: "east-asian-history",
    name: "동아시아사",
    subject: "social",
    displayOrder: 50,
    aliases: ["동아시아사"],
    abbreviations: ["동사"],
  },
  {
    code: "world-history",
    name: "세계사",
    subject: "social",
    displayOrder: 60,
    aliases: ["세계사"],
    abbreviations: [],
  },
  {
    code: "economics",
    name: "경제",
    subject: "social",
    displayOrder: 70,
    aliases: ["경제"],
    abbreviations: [],
  },
  {
    code: "politics-and-law",
    name: "정치와 법",
    subject: "social",
    displayOrder: 80,
    aliases: ["정치와법"],
    abbreviations: ["정법"],
  },
  {
    code: "social-culture",
    name: "사회·문화",
    subject: "social",
    displayOrder: 90,
    aliases: ["사회문화"],
    abbreviations: ["사문"],
  },
  // ── 과학탐구 ──
  {
    code: "integrated-science",
    name: "통합과학",
    subject: "science",
    displayOrder: 5,
    aliases: ["통합과학"],
    abbreviations: ["통과"],
  },
  {
    code: "physics-1",
    name: "물리학 I",
    subject: "science",
    displayOrder: 10,
    aliases: ["물리학1", "물리1"],
    abbreviations: ["물1"],
  },
  {
    code: "chemistry-1",
    name: "화학 I",
    subject: "science",
    displayOrder: 20,
    aliases: ["화학1"],
    abbreviations: ["화1"],
  },
  {
    code: "life-science-1",
    name: "생명과학 I",
    subject: "science",
    displayOrder: 30,
    aliases: ["생명과학1", "생명1"],
    abbreviations: ["생1"],
  },
  {
    code: "earth-science-1",
    name: "지구과학 I",
    subject: "science",
    displayOrder: 40,
    aliases: ["지구과학1", "지구1"],
    abbreviations: ["지1"],
  },
  {
    code: "physics-2",
    name: "물리학 II",
    subject: "science",
    displayOrder: 50,
    aliases: ["물리학2", "물리2"],
    abbreviations: ["물2"],
  },
  {
    code: "chemistry-2",
    name: "화학 II",
    subject: "science",
    displayOrder: 60,
    aliases: ["화학2"],
    abbreviations: ["화2"],
  },
  {
    code: "life-science-2",
    name: "생명과학 II",
    subject: "science",
    displayOrder: 70,
    aliases: ["생명과학2", "생명2"],
    abbreviations: ["생2"],
  },
  {
    code: "earth-science-2",
    name: "지구과학 II",
    subject: "science",
    displayOrder: 80,
    aliases: ["지구과학2", "지구2"],
    abbreviations: ["지2"],
  },
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
};

/** 세부과목 선택이 필요한 영역 (사회탐구/과학탐구) */
export const COURSE_BASED_SUBJECTS: Subject[] = ["social", "science"];

export const SUBJECT_AREA_LABELS: Partial<Record<Subject, string>> = {
  social: "사회탐구",
  science: "과학탐구",
};

export function courseByCode(code: string): CourseDefinition | undefined {
  return COURSE_CATALOG.find((c) => c.code === code);
}

export function coursesForSubject(subject: Subject): CourseDefinition[] {
  return COURSE_CATALOG.filter((c) => c.subject === subject).sort(
    (a, b) => a.displayOrder - b.displayOrder,
  );
}

export function isCourseCode(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && Boolean(courseByCode(value));
}

/** SEO 제목용: "사회·문화" → "사회문화", "물리학 I" 는 그대로 */
export function courseSeoName(name: string): string {
  return name.replace(/·/g, "");
}
