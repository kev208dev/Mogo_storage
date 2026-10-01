import type { VocabularyItem } from "./data/types";

export interface VocabFilter {
  query: string;
  questionNumber: number | "all";
  unknownOnly: boolean;
  /** 난이도 (1 기본 · 2 중요 · 3 고난도). 없거나 "all" 이면 전체 */
  difficulty?: 1 | 2 | 3 | "all";
  /** 외운 단어 숨기기 */
  hideMemorized?: boolean;
}

/** 검색어 정규화: 대소문자·전각·앞뒤 공백 무시 */
export function normalizeVocabQuery(s: string): string {
  return s.normalize("NFKC").trim().toLowerCase();
}

/** 단어 id 기준 중복 제거 + 같은 문항의 같은 단어(대소문자 무시)도 한 번만 */
export function dedupeVocabulary(items: readonly VocabularyItem[]): VocabularyItem[] {
  const seen = new Set<string>();
  const out: VocabularyItem[] = [];
  for (const v of items) {
    const key = `${v.questionNumber}:${normalizeVocabQuery(v.word)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function filterVocabulary(
  items: readonly VocabularyItem[],
  filter: VocabFilter,
  unknown: ReadonlySet<string>,
  memorized: ReadonlySet<string> = new Set(),
): VocabularyItem[] {
  const q = normalizeVocabQuery(filter.query);
  return items.filter((v) => {
    if (filter.questionNumber !== "all" && v.questionNumber !== filter.questionNumber) return false;
    if (filter.unknownOnly && !unknown.has(v.id)) return false;
    if (filter.difficulty && filter.difficulty !== "all" && v.difficulty !== filter.difficulty)
      return false;
    if (filter.hideMemorized && memorized.has(v.id)) return false;
    if (!q) return true;
    return (
      normalizeVocabQuery(v.word).includes(q) ||
      normalizeVocabQuery(v.meaning).includes(q) ||
      (v.partOfSpeech ? normalizeVocabQuery(v.partOfSpeech) === q : false)
    );
  });
}

/** 문항 번호별로 묶기 (화면 · 인쇄용 목록) */
export function groupVocabularyByQuestion(
  items: readonly VocabularyItem[],
): Array<{ questionNumber: number; items: VocabularyItem[] }> {
  const groups = new Map<number, VocabularyItem[]>();
  for (const v of items) groups.set(v.questionNumber, [...(groups.get(v.questionNumber) ?? []), v]);
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([questionNumber, list]) => ({ questionNumber, items: list }));
}
