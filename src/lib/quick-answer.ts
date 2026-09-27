import type { UserAnswers } from "./grading";

/**
 * 빠른 답 입력 규칙 (순수 함수 — UI 와 테스트가 공유한다).
 *
 * - 커서가 가리키는 문항부터 입력한다. 선택형은 1~선택지 수 한 글자면 저장하고 다음 문항으로.
 * - 단답형은 숫자를 이어 붙이고(최대 3자리), 공백·쉼표·슬래시·Enter 로 끝내고 다음 문항으로.
 * - "-" "." "x" "?" 는 그 문항을 비워 두고 다음 문항으로 (건너뛰기).
 * - 선택형 문항에서 공백·쉼표는 무시한다 ("3 4 2 1" 도 "3421" 과 같다).
 * - 범위 밖 숫자(예: 5지선다의 6)는 무시한다.
 * 그래서 "34244125…" 를 그대로 붙여넣으면 1번부터 차례로 채워진다.
 */

export interface QuickQuestion {
  questionNumber: number;
  /** 선택지 수. null 이면 단답형 */
  choiceCount: number | null;
}

export interface QuickState {
  answers: UserAnswers;
  /** 다음에 입력할 문항의 index (questions 배열 기준). questions.length 면 끝 */
  cursor: number;
}

const SEPARATOR = /[\s,/;|]/;
const SKIP = /[-.xX?_]/;
export const SHORT_ANSWER_MAX_DIGITS = 3;

function withAnswer(answers: UserAnswers, n: number, value: string | null): UserAnswers {
  const next = { ...answers };
  if (value === null || value === "") delete next[n];
  else next[n] = value;
  return next;
}

export function applyQuickInput(
  state: QuickState,
  text: string,
  questions: readonly QuickQuestion[],
): QuickState {
  let { answers, cursor } = state;
  for (const ch of text.normalize("NFKC")) {
    const q = questions[cursor];
    if (!q) break;
    if (/[0-9]/.test(ch)) {
      if (q.choiceCount) {
        const n = Number(ch);
        if (n >= 1 && n <= q.choiceCount) {
          answers = withAnswer(answers, q.questionNumber, ch);
          cursor++;
        }
      } else {
        const current = answers[q.questionNumber] ?? "";
        if (current.length < SHORT_ANSWER_MAX_DIGITS)
          answers = withAnswer(answers, q.questionNumber, current + ch);
      }
    } else if (SKIP.test(ch)) {
      answers = withAnswer(answers, q.questionNumber, null);
      cursor++;
    } else if (SEPARATOR.test(ch)) {
      // 단답형 입력을 마치고 다음 문항으로 (선택형에서는 무시)
      if (!q.choiceCount && answers[q.questionNumber]) cursor++;
    }
  }
  return { answers, cursor: Math.min(cursor, questions.length) };
}

/** Backspace: 단답형 입력 중이면 한 글자, 아니면 이전 문항 답을 지우고 그 문항으로 */
export function quickBackspace(state: QuickState, questions: readonly QuickQuestion[]): QuickState {
  const q = questions[state.cursor];
  if (q && !q.choiceCount && state.answers[q.questionNumber]) {
    const current = state.answers[q.questionNumber]!;
    return {
      ...state,
      answers: withAnswer(state.answers, q.questionNumber, current.slice(0, -1)),
    };
  }
  if (q && state.answers[q.questionNumber]) {
    return { ...state, answers: withAnswer(state.answers, q.questionNumber, null) };
  }
  const prev = state.cursor - 1;
  const p = questions[prev];
  if (!p) return state;
  return { answers: withAnswer(state.answers, p.questionNumber, null), cursor: prev };
}

export function moveCursor(
  state: QuickState,
  delta: number,
  questions: readonly QuickQuestion[],
): QuickState {
  return {
    ...state,
    cursor: Math.max(0, Math.min(questions.length, state.cursor + delta)),
  };
}

/** 문항 버튼으로 직접 선택: 같은 값을 다시 누르면 지운다. 선택형은 다음 문항으로 넘어간다 */
export function setAnswerAt(
  state: QuickState,
  index: number,
  value: string,
  questions: readonly QuickQuestion[],
): QuickState {
  const q = questions[index];
  if (!q) return state;
  const same = state.answers[q.questionNumber] === value;
  const answers = withAnswer(state.answers, q.questionNumber, same ? null : value);
  const advance = q.choiceCount && !same ? index + 1 : index;
  return { answers, cursor: Math.min(advance, questions.length) };
}

/** 입력된 답을 한 줄 문자열로 (선택형은 숫자, 단답형은 [값], 빈칸은 ·) */
export function answersToLine(answers: UserAnswers, questions: readonly QuickQuestion[]): string {
  return questions
    .map((q) => {
      const a = answers[q.questionNumber];
      if (!a) return "·";
      return q.choiceCount ? a : `[${a}]`;
    })
    .join("");
}
