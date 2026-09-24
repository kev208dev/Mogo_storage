import type { VocabularyItem } from "./data/types";

export type QuizDirection = "en-ko" | "ko-en";
export type QuizFormat = "choice" | "written";

export interface QuizQuestion {
  id: string;
  prompt: string;
  answer: string;
  choices: string[] | null;
  item: VocabularyItem;
}

/** 시드 기반 셔플 (테스트에서 재현 가능하도록) */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function buildQuiz(
  items: VocabularyItem[],
  options: { direction: QuizDirection; format: QuizFormat; count: number | "all" },
  random: () => number = Math.random,
): QuizQuestion[] {
  const pool = shuffle(items, random);
  const selected = options.count === "all" ? pool : pool.slice(0, options.count);
  const promptOf = (v: VocabularyItem) => (options.direction === "en-ko" ? v.word : v.meaning);
  const answerOf = (v: VocabularyItem) => (options.direction === "en-ko" ? v.meaning : v.word);

  return selected.map((item) => {
    let choices: string[] | null = null;
    if (options.format === "choice") {
      const distractors = shuffle(
        items.filter((v) => v.id !== item.id && answerOf(v) !== answerOf(item)),
        random,
      )
        .slice(0, 3)
        .map(answerOf);
      choices = shuffle([answerOf(item), ...distractors], random);
    }
    return { id: item.id, prompt: promptOf(item), answer: answerOf(item), choices, item };
  });
}

/** 주관식 채점: 영어는 대소문자 무시, 한글 뜻은 쉼표로 나뉜 뜻 중 하나와 일치하면 정답 */
export function isQuizAnswerCorrect(question: QuizQuestion, input: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const value = normalize(input);
  if (!value) return false;
  if (question.choices) return value === normalize(question.answer);
  const accepted = question.answer
    .split(/[,;]/)
    .map((part) => normalize(part.replace(/\(.*?\)/g, "")))
    .filter(Boolean);
  return accepted.includes(value) || normalize(question.answer) === value;
}
