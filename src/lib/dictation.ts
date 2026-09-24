export type DictationLevel = "easy" | "medium" | "hard";

export interface DictationToken {
  /** 화면에 그대로 보이는 텍스트 (단어 + 구두점) */
  text: string;
  /** 빈칸이면 정답 단어 */
  answer: string | null;
  /** 빈칸 뒤 구두점 */
  trailing: string;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "is",
  "am",
  "are",
  "was",
  "were",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "and",
  "but",
  "or",
  "my",
  "your",
  "me",
  "do",
  "did",
  "be",
  "can",
  "will",
  "with",
  "this",
  "that",
  "not",
  "so",
]);

function splitWord(raw: string) {
  const match = /^(.*?)([.,!?;:'"]*)$/.exec(raw);
  return { word: match?.[1] ?? raw, trailing: match?.[2] ?? "" };
}

/**
 * 받아쓰기 빈칸 생성.
 *  - easy:   핵심 단어(불용어가 아닌 가장 긴 단어) 1개
 *  - medium: 불용어가 아닌 3글자 이상 단어를 절반 정도(짝수 번째) 빈칸
 *  - hard:   문장 전체 입력 (호출부에서 처리, 여기서는 모든 단어를 빈칸으로)
 * 같은 문장·난이도는 항상 같은 결과를 낸다.
 */
export function createDictationTokens(sentence: string, level: DictationLevel): DictationToken[] {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  const parts = words.map(splitWord);
  const isContent = (w: string) => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase());

  let blankIndexes = new Set<number>();
  if (level === "hard") {
    blankIndexes = new Set(parts.map((_, i) => i));
  } else if (level === "easy") {
    let best = -1;
    parts.forEach((p, i) => {
      if (isContent(p.word) && (best === -1 || p.word.length > parts[best]!.word.length)) best = i;
    });
    if (best >= 0) blankIndexes.add(best);
  } else {
    const candidates = parts.map((p, i) => (isContent(p.word) ? i : -1)).filter((i) => i >= 0);
    candidates.forEach((index, order) => {
      if (order % 2 === 0) blankIndexes.add(index);
    });
    if (blankIndexes.size === 0 && candidates[0] !== undefined) blankIndexes.add(candidates[0]);
  }

  return parts.map((p, i) =>
    blankIndexes.has(i)
      ? { text: p.word, answer: p.word, trailing: p.trailing }
      : { text: `${p.word}${p.trailing}`, answer: null, trailing: "" },
  );
}

export function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isDictationMatch(expected: string, actual: string): boolean {
  return normalizeForCompare(expected) === normalizeForCompare(actual);
}
