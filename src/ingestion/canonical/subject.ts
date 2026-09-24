import type { Subject } from "../../lib/constants";

const RULES: Array<[RegExp, Subject]> = [
  // 언어 과목이 "국어" 규칙("중국어")에 걸리지 않도록 먼저 확인한다
  [
    /제2외국어|한문|독일어|프랑스어|스페인어|중국어|일본어|러시아어|아랍어|베트남어|(?<![a-z])second_?lang(uage)?(?![a-z])/i,
    "second_language",
  ],
  [
    /직업탐구|직탐|농업기초기술|공업일반|상업경제|수산.?해운|인간발달|성공적인직업생활|(?<![a-z])vocational(?![a-z])/i,
    "vocational",
  ],
  [/한국사|(?<![a-z])(kor_?)?his(tory)?(?![a-z])/i, "history"],
  [/국어|(?<![a-z])kor(ean)?(?![a-z])/i, "korean"],
  [/수학|(?<![a-z])math(?![a-z])/i, "math"],
  [/영어|(?<![a-z])eng(lish)?(?![a-z])/i, "english"],
  [/사회|사탐|(?<![a-z])soc(ial)?(?![a-z])/i, "social"],
  [/과학|과탐|(?<![a-z])sci(ence)?(?![a-z])/i, "science"],
];

/** source 표기 → 내부 과목. 지원하지 않으면 null */
export function normalizeSubject(raw: string): Subject | null {
  const text = raw.normalize("NFKC").replace(/\s+/g, "");
  for (const [pattern, subject] of RULES)
    if (pattern.test(text) || pattern.test(raw)) return subject;
  return null;
}
