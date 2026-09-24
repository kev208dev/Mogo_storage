import { VOCABULARY_AUTO_APPROVE_CONFIDENCE } from "../constants";

export interface VocabularyCandidate {
  questionNumber: number;
  word: string;
  meaning: string | null;
  confidence: number;
  status: "auto_approved" | "needs_review";
}

/** 영어 독해 문항 범위 (1~17번은 듣기) */
const READING_RANGE = { min: 18, max: 45 };

/** 해설 PDF 에서 어휘 목록이 시작되는 표시 */
const SECTION_MARKER =
  /(\[\s*어휘\s*(?:·|및)?\s*(?:어구)?\s*\]|어휘\s*[·ㆍ]\s*어구|\b[Ww]ords?\s*(?:&|and)\s*[Pp]hrases?\b|【\s*어휘\s*】|<\s*어휘\s*>)/;

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "you",
  "are",
  "was",
  "with",
  "that",
  "this",
  "from",
]);

/** 영어 표제어 + 한국어 뜻 한 줄 (예: "renovation 보수, 개조", "take part in ~에 참여하다") */
const ENTRY =
  /^[\s•·▪◦\-*]*([A-Za-z][A-Za-z'’-]*(?:\s+(?:[A-Za-z][A-Za-z'’-]*|~|A|B)){0,4})\s*[:：]?\s+((?:[~(（]?[가-힣])[가-힣0-9~()（）,·\s/]*?)\s*$/;

function normalizeWord(raw: string): string {
  return raw
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/, "")
    .trim()
    .toLowerCase();
}

function normalizeMeaning(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/[,·]\s*$/, "")
    .trim();
}

/** 텍스트를 문항 번호 단위로 나눈다 ("18. ...", "[18]", "18번") */
export function splitByQuestion(text: string): Array<{ questionNumber: number; body: string }> {
  const marker = /(?:^|\n)\s*\[?\s*(1[89]|[2-4]\d)\s*(?:\.|\]|번|\))/g;
  const hits: Array<{ n: number; index: number }> = [];
  for (const m of text.matchAll(marker)) {
    const n = Number(m[1]);
    if (n < READING_RANGE.min || n > READING_RANGE.max) continue;
    // 번호는 증가해야 한다 (본문 속 숫자 오인 방지)
    if (hits.length && n <= hits[hits.length - 1]!.n) continue;
    hits.push({ n, index: m.index ?? 0 });
  }
  return hits.map((h, i) => ({
    questionNumber: h.n,
    body: text.slice(h.index, hits[i + 1]?.index ?? text.length),
  }));
}

/**
 * 원본 텍스트에서 실제로 등장한 "영어 표제어 + 한국어 뜻" 줄만 후보로 만든다.
 * 단어를 새로 만들거나 뜻을 추측하지 않는다 (LLM 미사용).
 *  - 어휘 섹션 표시 아래에서 찾은 항목: 높은 신뢰도 → 자동 승인
 *  - 섹션 표시 없이 찾은 항목: 낮은 신뢰도 → needs_review
 */
export function extractVocabularyCandidates(text: string): VocabularyCandidate[] {
  const byKey = new Map<string, VocabularyCandidate>();
  for (const { questionNumber, body } of splitByQuestion(text.normalize("NFKC"))) {
    const sectionMatch = SECTION_MARKER.exec(body);
    const scope = sectionMatch ? body.slice(sectionMatch.index + sectionMatch[0].length) : body;
    const inSection = Boolean(sectionMatch);
    // 한 줄에 여러 항목이 이어지는 경우를 위해 bullet 기호로도 나눈다
    const lines = scope.split(/\n|(?=\s[•▪◦]\s)|(?<=[가-힣)])\s{2,}(?=[A-Za-z])/);
    for (const line of lines) {
      const m = ENTRY.exec(line);
      if (!m) continue;
      const word = normalizeWord(m[1]!);
      const meaning = normalizeMeaning(m[2]!);
      const head = word.split(" ")[0]!;
      if (head.length < 3 || STOP_WORDS.has(word) || meaning.length === 0) continue;
      const confidence = inSection ? 0.9 : 0.55;
      const candidate: VocabularyCandidate = {
        questionNumber,
        word,
        meaning,
        confidence,
        status: confidence >= VOCABULARY_AUTO_APPROVE_CONFIDENCE ? "auto_approved" : "needs_review",
      };
      const key = `${questionNumber}:${word}`;
      const prev = byKey.get(key);
      if (!prev || prev.confidence < candidate.confidence) byKey.set(key, candidate);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.questionNumber - b.questionNumber || a.word.localeCompare(b.word),
  );
}
