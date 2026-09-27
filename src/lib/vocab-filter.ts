import type { VocabularyItem } from "./data/types";

export interface VocabFilter {
  query: string;
  questionNumber: number | "all";
  unknownOnly: boolean;
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
): VocabularyItem[] {
  const q = normalizeVocabQuery(filter.query);
  return items.filter((v) => {
    if (filter.questionNumber !== "all" && v.questionNumber !== filter.questionNumber) return false;
    if (filter.unknownOnly && !unknown.has(v.id)) return false;
    if (!q) return true;
    return (
      normalizeVocabQuery(v.word).includes(q) ||
      normalizeVocabQuery(v.meaning).includes(q) ||
      (v.partOfSpeech ? normalizeVocabQuery(v.partOfSpeech) === q : false)
    );
  });
}
