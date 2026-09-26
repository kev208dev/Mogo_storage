/**
 * EBSi 공식 다운로드 URL 해석 (순수 함수, 네트워크 없음).
 *   https://wdown.ebsi.co.kr/W61001/01exam/20250604/go3/s_samun_hsj_522O36I8.pdf
 *   → 경로 날짜 2025-06-04 · 고3 · 코드 s_samun · 정답 및 해설 · 파일 ID 522O36I8
 *
 * 파일명 토큰: _mun_ 문제 · _hsj_ 정답 및 해설 · _scr 듣기 대본 · live_main_paper_1_ 수능 홀수형 · mp3 음원.
 * 경로 날짜는 대개 시행일이지만 게시일인 경우가 있어(예: 매년 04-30) 제목 등 다른 근거로 확인해야 한다.
 */

export type EbsiFileKind =
  | "question"
  | "solution"
  | "listening_script"
  | "listening_audio"
  /** 수능 짝수형 문제지 (홀수형만 게시) */
  | "paper_even"
  /** 정답표 (정답 및 해설 우선) */
  | "answer_key"
  | "unknown";

export interface EbsiFile {
  url: string;
  /** YYYY-MM-DD (경로 날짜) */
  pathDate: string;
  year: number;
  month: number;
  grade: 1 | 2 | 3;
  name: string;
  ext: "pdf" | "mp3";
  kind: EbsiFileKind;
  /** 과목 코드 (예: kor, korB, s_samun, g_phy1, 2nd_ja, J_nupgi, sat, gat) */
  code: string;
  /** EBSi 파일 ID (같은 ID 의 _1/_2 는 같은 파일의 다른 번호) */
  fileId: string;
  part: string;
}

const PATH_RE =
  /^https:\/\/wdown\.ebsi\.co\.kr\/W61001\/01exam\/(\d{4})(\d{2})(\d{2})\/go([123])\/([A-Za-z0-9_]+)\.(pdf|mp3)$/;

const TRAILING_TOKENS = new Set(["main", "1", "2", "A", "B"]);

export function parseEbsiFileUrl(url: string): EbsiFile | null {
  const m = PATH_RE.exec(url);
  if (!m) return null;
  const [, y, mo, d, g, name, ext] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    "pdf" | "mp3",
  ];
  const base = {
    url,
    pathDate: `${y}-${mo}-${d}`,
    year: Number(y),
    month: Number(mo),
    grade: Number(g) as 1 | 2 | 3,
    name,
    ext,
  };
  const toks = name.split("_");
  if (name.startsWith("live_main_paper_")) {
    return {
      ...base,
      kind: toks[3] === "1" ? "question" : "paper_even",
      code: toks[4] ?? "",
      fileId: toks[5] ?? "",
      part: toks[6] ?? "",
    };
  }
  if (name.startsWith("live_main_answer_"))
    return { ...base, kind: "answer_key", code: toks[4] ?? "", fileId: toks[5] ?? "", part: "" };
  if (ext === "mp3") {
    const i = toks.findIndex((t) => t === "mp3" || t === "audio");
    return {
      ...base,
      kind: "listening_audio",
      code: toks[0] ?? "",
      fileId: i >= 0 ? (toks[i + 1] ?? "") : (toks.at(-1) ?? ""),
      part: "",
    };
  }
  for (const [marker, kind] of [
    ["hsj", "solution"],
    ["mun", "question"],
    ["scr", "listening_script"],
  ] as const) {
    const i = toks.indexOf(marker);
    if (i < 0) continue;
    let head = toks.slice(0, i);
    while (head.length > 1 && TRAILING_TOKENS.has(head.at(-1)!)) head = head.slice(0, -1);
    const tail = toks.slice(i + 1);
    return { ...base, kind, code: head.join("_"), fileId: tail[0] ?? "", part: tail[1] ?? "" };
  }
  return { ...base, kind: "unknown", code: name, fileId: "", part: "" };
}

/** 국어·수학 A/B/C 변형 — 어느 선택과목인지 확인되지 않아 자동 매핑하지 않는다 */
export function isAmbiguousVariant(code: string): boolean {
  return /^(kor|math)[A-C]$/.test(code);
}

/** 학년에 따라 뜻이 다른 코드 (고1 통합사회/통합과학, 고2·3 은 파일마다 다른 선택과목) */
export const GRADE_DEPENDENT_CODES = new Set(["sat", "gat"]);

/** 코드만으로 영역이 확정되는 공통 과목 */
export const WHOLE_SUBJECT_CODES: Record<string, "korean" | "math" | "english"> = {
  kor: "korean",
  math: "math",
  eng: "english",
};
