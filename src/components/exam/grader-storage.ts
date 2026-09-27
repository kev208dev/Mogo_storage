import type { GradeResult } from "@/lib/grading";

/** localStorage 는 차단/사생활 모드에서 예외를 던질 수 있으므로 항상 감싼다. */
export function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 실패는 무시 (기능은 계속 동작) */
  }
}

export function removeKey(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

export const answersKey = (examId: string, subject: string) => `mogo:answers:${examId}:${subject}`;
export const resultKey = (examId: string, subject: string) => `mogo:result:${examId}:${subject}`;

export const GRADED_EVENT = "mogo:graded";
export const SHOW_QUESTION_EVENT = "mogo:show-question";

export type StoredResult = Pick<GradeResult, "rawScore" | "wrongNumbers"> & { gradedAt: string };
/** 입력한 답이 바뀔 때 (문항 학습 카드가 내 답을 보여준다) */
export const ANSWERS_EVENT = "mogo:answers";
/** "틀린 문제만 복습하기" */
export const SHOW_WRONG_EVENT = "mogo:show-wrong";
