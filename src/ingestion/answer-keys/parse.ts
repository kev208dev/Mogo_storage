/**
 * 공식 정답·해설 PDF 텍스트 → 정답표.
 *
 * EBSi 정답 및 해설 PDF 는 앞부분에 빠른 정답표("01. ④ 02. ⑤ …")가 있고,
 * 과목이 공통/선택으로 나뉘면 "■ [공통: 독서·문학]" · "■ [선택: 화법과 작문]" 머리말이 표 앞에 붙는다.
 * 본문에는 문항별 머리말("1. 세부 내용 파악")과, 과목에 따라 "정답 ④" 표기가 있다.
 *
 * 이 모듈은 텍스트만 다룬다 (네트워크·DB 없음). 확실하지 않은 것은 problems 에 남기고 추측하지 않는다.
 */

export interface AnswerEntry {
  number: number;
  /** "1"~"5" (선택형) 또는 단답형 정수 문자열 */
  answer: string;
  choice: boolean;
  /** 본문에서 이 문항 해설이 시작되는 쪽 (1부터). 찾지 못하면 null */
  page: number | null;
  /** 본문의 "정답 ④" 표기 (없으면 null) — 빠른 정답표와 교차 확인용 */
  marker: string | null;
  /**
   * PDF 텍스트 층에서 번호와 답이 따로 흩어진 줄("01. 02. … 10.⑤ ② …")을 순서대로 짝지은 값.
   * 이런 값은 본문 "정답" 표기와 모두 일치할 때만 인정한다 (validate).
   */
  reordered: boolean;
}

export interface AnswerSection {
  /** "공통: 독서·문학" 같은 머리말 원문. 머리말 없이 표만 있으면 null */
  label: string | null;
  kind: "common" | "elective" | "single";
  /** 선택 과목명 ("화법과 작문"). 공통·단일은 null */
  courseLabel: string | null;
  entries: AnswerEntry[];
}

export interface ParsedAnswerKey {
  sections: AnswerSection[];
  problems: string[];
}

const CIRCLED = "①②③④⑤";
const TABLE_TOKEN = /(\d{2})\.\s*([①-⑤]|\d{1,3})(?=\s|$)/g;
const TABLE_LINE = /^(?:\d{2}\.\s*(?:[①-⑤]|\d{1,3})\s*)+$/;
const SECTION_HEADER = /^■\s*\[(공통|선택)\s*[:：]\s*([^\]]+)\]\s*$/;
const HEADING = /^(\d{1,2})\.(?=\s|$)/;
/** 텍스트 층에서 번호가 제목 뒤로 밀린 머리말: "전자기파의 이용1." */
// 번호 뒤에 흩어진 짧은 라틴 문자·숫자("열효율14. 1", "이해16. GDP GDP")는 허용한다.
// 잘못 짝지어져도 본문 정답 표기가 어긋나 manual_review 로 떨어진다 (안전한 방향).
const TRAILING_HEADING = /^[^\d.]{2,40}?(\d{1,2})\.(?:\s+[A-Za-z0-9 ]{1,15})?\s*[・·]?$/;
/** 번호와 선택형 답만 있는 줄 (순서가 흩어진 표) */
const SPLIT_LINE = /^(?:\d{2}\.|[①-⑤]|\s)+$/;
const MARKER = /정답\s*([①-⑤])/;

interface Line {
  text: string;
  page: number;
}

function toLines(pages: readonly string[]): Line[] {
  return pages.flatMap((p, i) =>
    p
      .split(/\r?\n/)
      .map((t) => t.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((text) => ({ text, page: i + 1 })),
  );
}

function tokenValue(raw: string): { answer: string; choice: boolean } {
  const i = CIRCLED.indexOf(raw);
  return i >= 0
    ? { answer: String(i + 1), choice: true }
    : { answer: String(Number(raw)), choice: false };
}

type Token = { number: number; answer: string; choice: boolean; reordered: boolean };

/** 표 한 줄 → 토큰. 깨끗한 "NN. ④" 줄이 아니면, 번호 k개 · 선택형 답 k개인 줄만 순서대로 짝짓는다 */
function tableTokens(text: string): Token[] | null {
  if (TABLE_LINE.test(text))
    return [...text.matchAll(TABLE_TOKEN)].map((m) => ({
      number: Number(m[1]),
      ...tokenValue(m[2]!),
      reordered: false,
    }));
  if (!SPLIT_LINE.test(text)) return null;
  const numbers = [...text.matchAll(/(\d{2})\./g)].map((m) => Number(m[1]));
  const answers = [...text.matchAll(/[①-⑤]/g)].map((m) => m[0]);
  if (!numbers.length || numbers.length !== answers.length) return null;
  if (!numbers.every((n, i) => i === 0 || n === numbers[i - 1]! + 1)) return null;
  return numbers.map((number, i) => ({ number, ...tokenValue(answers[i]!), reordered: true }));
}

/**
 * 교육청 학력평가 해설의 표: "1 ⑤ 2 ④ 3 ② …", 수학 단답형 "22 3 23 55 …".
 * 점이 없는 숫자 쌍은 쪽 머리("25 27")와 구분되지 않으므로, "…정답" 줄 바로 다음에서 시작하고
 * 번호가 앞 줄에 이어 연속될 때만 표로 인정한다.
 */
function undottedTokens(text: string, expectedFirst: number): Token[] | null {
  const parts = text.split(" ");
  if (parts.length < 2 || parts.length % 2) return null;
  const out: Token[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const n = parts[i]!;
    const a = parts[i + 1]!;
    if (!/^\d{1,2}$/.test(n) || !/^(?:[①-⑤]|\d{1,3})$/.test(a)) return null;
    if (Number(n) !== expectedFirst + i / 2) return null;
    out.push({ number: Number(n), ...tokenValue(a), reordered: false });
  }
  return out;
}

interface Block {
  header: { kind: "common" | "elective"; name: string } | null;
  headerIndex: number | null;
  tokens: Token[];
  start: number;
  end: number;
}

/** 표 블록 찾기: ■ 머리말 바로 다음 줄들, 또는 1쪽에서 첫 문항 머리말 이전의 표 줄 */
function findBlocks(lines: Line[], problems: string[]): Block[] {
  const blocks: Block[] = [];
  const firstHeading = lines.findIndex(
    (l) => !tableTokens(l.text) && (/^1\.\s*\S/.test(l.text) || isTrailingHeading(l.text, 1)),
  );
  for (let i = 0; i < lines.length; i++) {
    // 학력평가 형식: "정답" 으로 끝나는 줄 다음의 점 없는 표
    if (/정답$/.test(lines[i]!.text) && !blocks.some((b) => i >= b.start && i <= b.end)) {
      const tokens: Token[] = [];
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        const row = undottedTokens(lines[j]!.text, tokens.length ? tokens.at(-1)!.number + 1 : 1);
        if (!row) break;
        tokens.push(...row);
        end = j;
      }
      if (tokens.length) {
        blocks.push({ header: null, headerIndex: null, tokens, start: i + 1, end });
        i = end;
        continue;
      }
    }
    const h = SECTION_HEADER.exec(lines[i]!.text);
    const pageOneTable =
      !h &&
      lines[i]!.page === 1 &&
      (firstHeading < 0 || i < firstHeading) &&
      tableTokens(lines[i]!.text) !== null &&
      !blocks.some((b) => i >= b.start && i <= b.end);
    if (!h && !pageOneTable) continue;
    const start = h ? i + 1 : i;
    let end = start - 1;
    const tokens: Token[] = [];
    for (let j = start; j < lines.length; j++) {
      const row = tableTokens(lines[j]!.text);
      if (!row) break;
      end = j;
      tokens.push(...row);
    }
    if (!tokens.length) {
      if (h) problems.push(`머리말 "${h[2]}" 다음에 정답표가 없음`);
      continue;
    }
    blocks.push({
      header: h ? { kind: h[1] === "공통" ? "common" : "elective", name: h[2]!.trim() } : null,
      headerIndex: h ? i : null,
      tokens,
      start,
      end,
    });
    i = end;
  }
  return blocks;
}

function isTrailingHeading(text: string, n: number): boolean {
  const m = TRAILING_HEADING.exec(text);
  return !!m && Number(m[1]) === n;
}

export function parseAnswerKeyText(pages: readonly string[]): ParsedAnswerKey {
  const problems: string[] = [];
  const lines = toLines(pages);
  const blocks = findBlocks(lines, problems);
  if (!blocks.length) return { sections: [], problems: ["빠른 정답표를 찾지 못함"] };
  if (blocks.some((b) => b.header) && blocks.some((b) => !b.header))
    problems.push("머리말 있는 정답표와 없는 정답표가 섞여 있음");

  const tableLines = new Set(blocks.flatMap((b) => range(b.start, b.end)));
  // 본문 구간 (쪽 단위): 공통·단일 = 문서 처음 ~ 첫 선택 머리말이 있는 쪽 전,
  // 선택 = 자기 머리말이 있는 쪽 ~ 다음 선택 머리말이 있는 쪽 전. 정답표가 해당 쪽 아래에 붙는 배치를 허용한다.
  const pageStart = (lineIndex: number) =>
    lines.findIndex((l) => l.page === lines[lineIndex]!.page);
  const electiveStarts = blocks
    .filter((b) => b.header?.kind === "elective")
    .map((b) => pageStart(b.headerIndex!))
    .sort((a, b) => a - b);

  const sections: AnswerSection[] = blocks.map((block) => {
    const elective = block.header?.kind === "elective";
    const from = elective ? pageStart(block.headerIndex!) : 0;
    const to = elective
      ? (electiveStarts.find((s) => s > from) ?? lines.length)
      : (electiveStarts[0] ?? lines.length);

    const seen = new Map<number, AnswerEntry>();
    const entries: AnswerEntry[] = [];
    for (const t of block.tokens) {
      const prev = seen.get(t.number);
      if (prev) {
        if (prev.answer !== t.answer)
          problems.push(`${sectionName(block)} ${t.number}번 정답이 두 번 다르게 나옴`);
        continue;
      }
      const entry: AnswerEntry = { ...t, page: null, marker: null };
      seen.set(t.number, entry);
      entries.push(entry);
    }

    // 문항 머리말을 번호 순서대로만 인정한다 (본문 속 "3. …" 오인 방지)
    const order = [...entries].sort((a, b) => a.number - b.number);
    let k = 0;
    let current: AnswerEntry | null = null;
    for (let li = from; li < to && k <= order.length; li++) {
      if (tableLines.has(li)) continue;
      const text = lines[li]!.text;
      const hm = HEADING.exec(text);
      const next = k < order.length ? order[k]!.number : null;
      if (
        next !== null &&
        ((hm && Number(hm[1]) === next && !/^0\d\./.test(text)) || isTrailingHeading(text, next))
      ) {
        current = order[k]!;
        current.page = lines[li]!.page;
        k++;
      }
      const mm = current ? MARKER.exec(text) : null;
      if (mm && current && current.marker === null)
        current.marker = String(CIRCLED.indexOf(mm[1]!) + 1);
    }

    return {
      label: block.header
        ? `${block.header.kind === "common" ? "공통" : "선택"}: ${block.header.name}`
        : null,
      kind: block.header?.kind ?? "single",
      courseLabel: block.header?.kind === "elective" ? block.header.name : null,
      entries,
    };
  });
  return { sections, problems };
}

function sectionName(b: Block) {
  return b.header ? `[${b.header.name}]` : "[정답표]";
}

function range(a: number, b: number): number[] {
  return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
}

/**
 * 문제지 텍스트 → 문항별 배점. 표기가 없는 문항은 기본 배점 (제2외국어·한문 1점, 그 외 2점).
 * 문항 머리말("12. 그림은 …")을 1번부터 번호 순서대로만 인정한다.
 * 검증(합계·문항 수)은 validate 에서 한다.
 */
export function parsePointsText(
  pages: readonly string[],
  defaultPoints = 2,
): {
  points: Map<number, number>;
  found: number;
} {
  const lines = toLines(pages);
  const points = new Map<number, number>();
  let expected = 1;
  let current: number | null = null;
  for (const { text } of lines) {
    const hm = HEADING.exec(text);
    if (hm && Number(hm[1]) === expected) {
      current = expected;
      points.set(current, defaultPoints);
      expected++;
    }
    const pm = /\[([1-4])\s*점\]/.exec(text);
    if (pm && current !== null) points.set(current, Number(pm[1]));
  }
  return { points, found: expected - 1 };
}
