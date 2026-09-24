import type { Question } from "./data/types";

export type UserAnswers = Record<number, string>;

export interface QuestionResult {
  questionNumber: number;
  correctAnswer: string;
  userAnswer: string | null;
  isCorrect: boolean;
  score: number;
}

export interface GradeResult {
  rawScore: number;
  totalScore: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  wrongNumbers: number[];
  results: QuestionResult[];
}

export function normalizeAnswer(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // 단답형 "007" → "7"
  return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : trimmed;
}

/** 자동 채점. 미응답은 오답으로 계산한다. */
export function gradeAnswers(
  questions: Pick<Question, "questionNumber" | "answer" | "score">[],
  answers: UserAnswers,
): GradeResult {
  const results = questions.map((q) => {
    const userAnswer = normalizeAnswer(answers[q.questionNumber]);
    const isCorrect = userAnswer !== null && userAnswer === normalizeAnswer(q.answer);
    return {
      questionNumber: q.questionNumber,
      correctAnswer: q.answer,
      userAnswer,
      isCorrect,
      score: q.score,
    };
  });
  const correct = results.filter((r) => r.isCorrect);
  const wrong = results.filter((r) => !r.isCorrect);
  return {
    rawScore: correct.reduce((sum, r) => sum + r.score, 0),
    totalScore: results.reduce((sum, r) => sum + r.score, 0),
    correctCount: correct.length,
    wrongCount: wrong.length,
    unansweredCount: results.filter((r) => r.userAnswer === null).length,
    wrongNumbers: wrong.map((r) => r.questionNumber),
    results,
  };
}

/** 원점수로 등급 추정 (cuts: 1~8등급 하한 점수) */
export function estimateGrade(rawScore: number, cuts: { grade: number; rawScore: number }[]) {
  const sorted = [...cuts].sort((a, b) => a.grade - b.grade);
  for (const cut of sorted) {
    if (rawScore >= cut.rawScore) return cut.grade;
  }
  return sorted.length ? sorted.length + 1 : null;
}
