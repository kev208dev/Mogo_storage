import type { GradeCutEntry } from "../../lib/data/types";

export class GradeCutInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradeCutInputError";
  }
}

/**
 * 관리자 입력용 등급컷 parser.
 * 한 줄에 "1: 88", "1,88", "1 88" 형식을 받는다.
 * 일부 등급만 입력할 수 있지만, 입력된 컷은 등급이 내려갈수록 같거나 낮아야 한다.
 */
export function parseGradeCutEntries(input: string): GradeCutEntry[] {
  const rows = input
    .split(/\r?\n|;/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length === 0) throw new GradeCutInputError("등급컷을 한 줄 이상 입력하세요.");

  const seen = new Set<number>();
  const cuts: GradeCutEntry[] = [];
  for (const row of rows) {
    const cleaned = row.replace(/등급/g, "").replace(/점/g, "").trim();
    const match = /^([1-9])\s*[:,=\t ]+\s*(\d{1,3})$/.exec(cleaned);
    if (!match) {
      throw new GradeCutInputError(
        `등급컷 형식이 올바르지 않습니다: "${row}" (예: 1: 88)`,
      );
    }
    const grade = Number(match[1]);
    const rawScore = Number(match[2]);
    if (rawScore < 0 || rawScore > 100) {
      throw new GradeCutInputError(`${grade}등급 원점수는 0~100 사이여야 합니다.`);
    }
    if (seen.has(grade)) throw new GradeCutInputError(`${grade}등급이 중복되었습니다.`);
    seen.add(grade);
    cuts.push({ grade, rawScore });
  }

  cuts.sort((a, b) => a.grade - b.grade);
  for (let i = 1; i < cuts.length; i += 1) {
    const previous = cuts[i - 1]!;
    const current = cuts[i]!;
    if (current.rawScore > previous.rawScore) {
      throw new GradeCutInputError(
        `${current.grade}등급 컷(${current.rawScore})은 ${previous.grade}등급 컷(${previous.rawScore})보다 높을 수 없습니다.`,
      );
    }
  }
  return cuts;
}

/** 출처 링크는 관리자 브라우저용이며 서버에서 fetch 하지 않는다. HTTPS 링크만 저장한다. */
export function parseGradeCutSourceUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new GradeCutInputError("출처 URL을 입력하세요.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GradeCutInputError("출처 URL 형식이 올바르지 않습니다.");
  }
  if (url.protocol !== "https:")
    throw new GradeCutInputError("출처 URL은 HTTPS 주소만 사용할 수 있습니다.");
  if (url.username || url.password)
    throw new GradeCutInputError("인증정보가 포함된 출처 URL은 사용할 수 없습니다.");
  return url.toString();
}
