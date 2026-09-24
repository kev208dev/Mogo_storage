import type { Subject } from "../../lib/constants";

const RULES: Array<[RegExp, Subject]> = [
  [/한국사|(?<![a-z])(kor_?)?his(tory)?(?![a-z])/i, "history"],
  [/국어|(?<![a-z])kor(ean)?(?![a-z])/i, "korean"],
  [/수학|(?<![a-z])math(?![a-z])/i, "math"],
  [/영어|(?<![a-z])eng(lish)?(?![a-z])/i, "english"],
  [/사회|사탐|(?<![a-z])soc(ial)?(?![a-z])/i, "social"],
  [/과학|과탐|(?<![a-z])sci(ence)?(?![a-z])/i, "science"],
];

/** 지원하지 않는 과목 (현재 사이트 과목 구조 밖) */
const UNSUPPORTED =
  /직업탐구|직탐|제2외국어|한문|아랍어|베트남어|일본어|중국어|독일어|프랑스어|스페인어|러시아어/;

/** source 표기 → 내부 과목. 지원하지 않으면 null */
export function normalizeSubject(raw: string): Subject | null {
  const text = raw.normalize("NFKC").replace(/\s+/g, "");
  if (UNSUPPORTED.test(text)) return null;
  for (const [pattern, subject] of RULES)
    if (pattern.test(text) || pattern.test(raw)) return subject;
  return null;
}
