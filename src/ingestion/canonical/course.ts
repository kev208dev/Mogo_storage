import type { Subject } from "../../lib/constants";
import { AMBIGUOUS_COURSE_LABELS, COURSE_CATALOG, type CourseDefinition } from "../../lib/courses";

/**
 * course 표기 정규화: NFKC, 로마 숫자(Ⅰ/Ⅱ/I/II) → 1/2, 공백·구두점 제거.
 * 예) "물리학 Ⅰ" → "물리학1", "사회·문화" → "사회문화", "생활과 윤리" → "생활과윤리"
 */
export function normalizeCourseLabel(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/Ⅱ|Ⅱ/g, "2")
    .replace(/Ⅰ|Ⅰ/g, "1")
    .replace(/(?<=[가-힣])\s*II(?![A-Za-z])/g, "2")
    .replace(/(?<=[가-힣])\s*I(?![A-Za-z])/g, "1")
    .replace(/[\s·ㆍ・•.,_\-()[\]{}<>「」『』]/g, "")
    .toLowerCase();
}

/** 자료 종류/파일 표기 단어 (course 판별 전에 제거) */
const NOISE =
  /(영역|과목|탐구|문제지|문제|정답표|정답|해설지|해설|및|듣기|대본|pdf|hwp|zip|mp3|파일|시험지|전체|선택)/g;

export type CourseResolution =
  | {
      status: "resolved";
      code: string;
      confidence: number;
      matched: string;
      via: "catalog" | "alias";
    }
  | { status: "ambiguous"; candidates: string[]; matched: string }
  | { status: "none" };

/** 관리자 mapping 등 DB 에 저장된 alias (source 별 또는 전체) */
export interface CourseAlias {
  alias: string; // normalizeCourseLabel 결과
  code: string;
  sourceId: string | null;
}

interface Entry {
  key: string;
  code: string;
  kind: "alias" | "abbreviation";
}

const CATALOG_ENTRIES: Entry[] = COURSE_CATALOG.flatMap((c: CourseDefinition) => [
  { key: normalizeCourseLabel(c.name), code: c.code, kind: "alias" as const },
  ...c.aliases.map((a) => ({ key: normalizeCourseLabel(a), code: c.code, kind: "alias" as const })),
  ...c.abbreviations.map((a) => ({
    key: normalizeCourseLabel(a),
    code: c.code,
    kind: "abbreviation" as const,
  })),
]);

/**
 * 표기 → canonical course.
 *  1) DB alias (같은 source 우선, 그다음 전체) — 관리자가 확정한 mapping 재사용
 *  2) 카탈로그 정식 명칭/표기: 가장 긴 일치 우선 ("생활과윤리문제" 는 "윤리" 가 아니라 "생활과윤리")
 *  3) 약칭("사문","생윤","물1")은 다른 글자와 붙어 있지 않은 단독 토큰일 때만
 *  4) "윤리", "물리" 같은 모호한 표기는 추정하지 않고 ambiguous
 * subject 가 주어지면 그 영역의 course 만 인정한다.
 */
export function resolveCourse(
  raw: string,
  options: { subject?: Subject | null; sourceId?: string | null; aliases?: CourseAlias[] } = {},
): CourseResolution {
  const full = normalizeCourseLabel(raw);
  const stripped = full.replace(NOISE, "").replace(/^(고[1-3]|[1-3]학년|\d{4}년?|\d{1,2}월)+/g, "");
  if (!stripped && !full) return { status: "none" };
  const inSubject = (code: string) =>
    !options.subject || COURSE_CATALOG.find((c) => c.code === code)?.subject === options.subject;

  // 1) DB alias
  const aliases = (options.aliases ?? []).filter((a) => inSubject(a.code));
  const pick =
    aliases.find(
      (a) =>
        a.sourceId && a.sourceId === options.sourceId && (a.alias === stripped || a.alias === full),
    ) ?? aliases.find((a) => !a.sourceId && (a.alias === stripped || a.alias === full));
  if (pick)
    return {
      status: "resolved",
      code: pick.code,
      confidence: 1,
      matched: pick.alias,
      via: "alias",
    };

  // 2) 카탈로그 (가장 긴 일치)
  const candidates = CATALOG_ENTRIES.filter((e) => inSubject(e.code))
    .filter((e) => (e.kind === "alias" ? stripped.includes(e.key) : stripped === e.key))
    .sort((a, b) => b.key.length - a.key.length);
  const best = candidates[0];
  if (best) {
    // 서로 다른 course 의 긴 표기가 동시에 들어 있으면 (예: 여러 과목 묶음) 확정하지 않는다
    const others = candidates.filter(
      (c) => c.code !== best.code && c.kind === "alias" && !best.key.includes(c.key),
    );
    if (others.length > 0) {
      return {
        status: "ambiguous",
        candidates: [...new Set([best.code, ...others.map((o) => o.code)])],
        matched: stripped,
      };
    }
    return {
      status: "resolved",
      code: best.code,
      confidence: best.kind === "abbreviation" ? 0.9 : stripped === best.key ? 1 : 0.95,
      matched: best.key,
      via: "catalog",
    };
  }

  // 4) 모호한 표기
  for (const [label, codes] of Object.entries(AMBIGUOUS_COURSE_LABELS)) {
    if (stripped === label || stripped.startsWith(label) || stripped.endsWith(label)) {
      const scoped = codes.filter(inSubject);
      if (scoped.length) return { status: "ambiguous", candidates: scoped, matched: stripped };
    }
  }
  return { status: "none" };
}

/** slot identity: course 없음 → "", 확정 → code, 모호 → "unresolved:<정규화 표기>" */
export function courseSlotKey(resolution: CourseResolution): string {
  if (resolution.status === "resolved") return resolution.code;
  if (resolution.status === "ambiguous") return `unresolved:${resolution.matched}`;
  return "";
}
