"use client";

import { CheckIcon, DeleteIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CHOICE_SYMBOLS } from "@/lib/constants";
import type { Question } from "@/lib/data/types";
import { gradeAnswers, type UserAnswers } from "@/lib/grading";
import {
  applyQuickInput,
  moveCursor,
  quickBackspace,
  setAnswerAt,
  type QuickState,
} from "@/lib/quick-answer";
import { cn } from "@/lib/utils";
import { formatAnswer } from "./answer-format";
import {
  ANSWERS_EVENT,
  answersKey,
  GRADED_EVENT,
  readJson,
  removeKey,
  resultKey,
  SHOW_QUESTION_EVENT,
  SHOW_WRONG_EVENT,
  writeJson,
  type StoredResult,
} from "./grader-storage";

type GraderQuestion = Pick<Question, "questionNumber" | "answer" | "score" | "choiceCount">;

/**
 * 빠른 답 입력 + 실시간 채점.
 *  - 입력칸 하나에 "34244125…" 를 치거나 붙여넣으면 1번부터 차례로 채워진다 (규칙: lib/quick-answer).
 *  - 문항 칸을 눌러 이동, 아래 ①~⑤ 버튼으로도 입력. ←/→ 이동, Backspace 지우기.
 *  - 답은 이 기기(localStorage)에만 저장한다. 정답·배점은 검증돼 게시된 문항 데이터만 쓴다.
 */
export function QuickGrader({
  examId,
  subject,
  questions,
}: {
  examId: string;
  subject: string;
  questions: GraderQuestion[];
}) {
  const [state, setState] = useState<QuickState>({ answers: {}, cursor: 0 });
  const [graded, setGraded] = useState(false);
  const [live, setLive] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const storageKey = answersKey(examId, subject);
  const quick = useMemo(
    () => questions.map((q) => ({ questionNumber: q.questionNumber, choiceCount: q.choiceCount })),
    [questions],
  );

  useEffect(() => {
    const saved = readJson<UserAnswers>(storageKey);
    if (!saved) return;
    const firstEmpty = questions.findIndex((q) => !saved[q.questionNumber]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 저장소 동기화
    setState({ answers: saved, cursor: firstEmpty === -1 ? questions.length : firstEmpty });
    if (readJson<StoredResult>(resultKey(examId, subject))) setGraded(true);
  }, [storageKey, examId, subject, questions]);

  const commit = useCallback(
    (next: QuickState) => {
      setState(next);
      writeJson(storageKey, next.answers);
      window.dispatchEvent(new CustomEvent(ANSWERS_EVENT, { detail: next.answers }));
    },
    [storageKey],
  );

  const result = useMemo(() => gradeAnswers(questions, state.answers), [questions, state.answers]);
  const answered = Object.keys(state.answers).length;
  const answeredCorrect = result.results.filter((r) => r.isCorrect).length;
  const reveal = graded || live;
  const current = questions[state.cursor];

  function grade() {
    setGraded(true);
    const stored: StoredResult = {
      rawScore: result.rawScore,
      wrongNumbers: result.wrongNumbers,
      gradedAt: new Date().toISOString(),
    };
    writeJson(resultKey(examId, subject), stored);
    window.dispatchEvent(new CustomEvent(GRADED_EVENT, { detail: stored }));
    requestAnimationFrame(() => resultRef.current?.focus());
  }

  function reset() {
    commit({ answers: {}, cursor: 0 });
    setGraded(false);
    removeKey(storageKey);
    removeKey(resultKey(examId, subject));
    window.dispatchEvent(new CustomEvent(GRADED_EVENT, { detail: null }));
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      commit(quickBackspace(state, quick));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      setState((s) => moveCursor(s, -1, quick));
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      setState((s) => moveCursor(s, 1, quick));
    } else if (e.key === "Home") {
      e.preventDefault();
      setState((s) => ({ ...s, cursor: 0 }));
    } else if (e.key === "End") {
      e.preventDefault();
      setState((s) => ({ ...s, cursor: questions.length }));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (current && !current.choiceCount) commit(applyQuickInput(state, " ", quick));
      else grade();
    }
  }

  function openQuestion(n: number) {
    window.dispatchEvent(new CustomEvent(SHOW_QUESTION_EVENT, { detail: n }));
  }

  const byNumber = new Map(result.results.map((r) => [r.questionNumber, r]));

  return (
    <div data-testid="quick-grader">
      <div className="bg-background/95 border-border sticky top-0 z-10 -mx-1 border-b px-1 pt-1 pb-2 backdrop-blur">
        <label htmlFor="quick-answer" className="text-sm font-bold">
          빠른 입력
          <span className="text-muted-foreground ml-2 text-xs font-normal">
            숫자를 이어서 입력하거나 붙여넣기 (예: 34244125). 건너뛰기 “-”, 단답형은 띄어쓰기로 구분
          </span>
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            ref={inputRef}
            id="quick-answer"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value=""
            onChange={(e) => {
              const text = e.target.value;
              if (text) commit(applyQuickInput(state, text, quick));
            }}
            onKeyDown={onKeyDown}
            placeholder={
              current
                ? `${current.questionNumber}번부터 입력`
                : "모든 문항 입력 완료 — Enter 로 채점"
            }
            aria-describedby="quick-progress"
            className="border-border focus-visible:border-primary focus-visible:ring-ring/40 h-12 min-w-0 flex-1 rounded-md border px-3 text-lg tabular-nums outline-none focus-visible:ring-[3px]"
          />
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => {
              commit(quickBackspace(state, quick));
              inputRef.current?.focus();
            }}
            aria-label="이전 답 지우기"
          >
            <DeleteIcon aria-hidden />
          </Button>
        </div>
        <div
          id="quick-progress"
          className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
          aria-live="polite"
        >
          <span>
            입력 <strong className="tabular-nums">{answered}</strong> / {questions.length}
          </span>
          <span
            className="bg-muted relative h-2 w-28 overflow-hidden rounded-full"
            role="progressbar"
            aria-label="입력 진행률"
            aria-valuemin={0}
            aria-valuemax={questions.length}
            aria-valuenow={answered}
          >
            <span
              className="bg-primary absolute inset-y-0 left-0"
              style={{ width: `${questions.length ? (answered / questions.length) * 100 : 0}%` }}
            />
          </span>
          {reveal ? (
            <span data-testid="live-score">
              <strong className="tabular-nums">{result.rawScore}</strong>점 · 맞음{" "}
              <strong className="text-success-strong tabular-nums">{answeredCorrect}</strong> · 틀림{" "}
              <strong className="text-danger-strong tabular-nums">
                {answered - answeredCorrect}
              </strong>
            </span>
          ) : null}
          <label className="text-muted-foreground ml-auto flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
              className="size-4"
            />
            실시간 채점
          </label>
        </div>
      </div>

      {current ? (
        <div className="mt-3" role="group" aria-label={`${current.questionNumber}번 답 선택`}>
          <p className="text-sm font-semibold">
            {current.questionNumber}번{" "}
            <span className="text-muted-foreground font-normal">({current.score}점)</span>
          </p>
          {current.choiceCount ? (
            <div className="mt-1.5 flex gap-1.5">
              {Array.from({ length: current.choiceCount }, (_, i) => String(i + 1)).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={state.answers[current.questionNumber] === c}
                  onClick={() => {
                    commit(setAnswerAt(state, state.cursor, c, quick));
                    inputRef.current?.focus();
                  }}
                  className={cn(
                    "flex size-12 items-center justify-center rounded-md border text-xl font-bold",
                    state.answers[current.questionNumber] === c
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-primary",
                  )}
                >
                  {CHOICE_SYMBOLS[Number(c) - 1]}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground mt-1 text-sm">
              단답형 — 숫자를 입력하고 띄어쓰기·Enter 로 다음 문항
            </p>
          )}
        </div>
      ) : null}

      <ol className="mt-3 grid grid-cols-5 gap-1 sm:grid-cols-10" aria-label="문항별 입력 상태">
        {questions.map((q, i) => {
          const r = byNumber.get(q.questionNumber)!;
          const value = state.answers[q.questionNumber];
          const mark = reveal && value ? (r.isCorrect ? "correct" : "wrong") : null;
          return (
            <li key={q.questionNumber}>
              <button
                type="button"
                onClick={() => {
                  setState((s) => ({ ...s, cursor: i }));
                  inputRef.current?.focus();
                }}
                aria-current={i === state.cursor ? "step" : undefined}
                aria-label={`${q.questionNumber}번 ${value ? `답 ${value}` : "미입력"}${mark === "correct" ? " 정답" : mark === "wrong" ? " 오답" : ""}`}
                className={cn(
                  "flex h-12 w-full flex-col items-center justify-center rounded-md border text-xs tabular-nums",
                  i === state.cursor ? "border-primary ring-primary/40 ring-2" : "border-border",
                  mark === "correct" && "bg-success-soft",
                  mark === "wrong" && "bg-danger-soft",
                )}
              >
                <span className="text-muted-foreground">{q.questionNumber}</span>
                <span className="text-base leading-none font-bold">
                  {value ? formatAnswer(value, q.choiceCount) : "·"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={grade} size="lg" className="flex-1 sm:flex-none">
          채점 결과 보기
        </Button>
        <Button onClick={reset} variant="outline" size="lg">
          <RotateCcwIcon aria-hidden />
          초기화
        </Button>
      </div>

      {graded ? (
        <div
          ref={resultRef}
          tabIndex={-1}
          role="region"
          aria-label="채점 결과"
          data-testid="grade-result"
          className="border-border focus-visible:ring-ring/60 mt-4 rounded-md border p-4 outline-none focus-visible:ring-[3px]"
        >
          <p className="text-3xl font-extrabold tabular-nums">
            {result.rawScore}
            <span className="text-lg font-bold">점</span>
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              / {result.totalScore}점
            </span>
          </p>
          <p className="mt-1 text-sm">
            맞음 <strong className="text-success-strong">{result.correctCount}</strong> · 틀림{" "}
            <strong className="text-danger-strong">
              {result.wrongCount - result.unansweredCount}
            </strong>{" "}
            · 미입력 <strong>{result.unansweredCount}</strong>
          </p>
          {result.wrongNumbers.length ? (
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => window.dispatchEvent(new CustomEvent(SHOW_WRONG_EVENT))}
            >
              틀린 문제만 복습하기
            </Button>
          ) : (
            <p className="text-success-strong mt-3 font-semibold">모든 문제를 맞혔습니다!</p>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm tabular-nums">
              <caption className="sr-only">문항별 채점 결과</caption>
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs">
                  <th className="py-1.5 pr-2">번호</th>
                  <th className="py-1.5 pr-2">내 답</th>
                  <th className="py-1.5 pr-2">정답</th>
                  <th className="py-1.5 pr-2">배점</th>
                  <th className="py-1.5">결과</th>
                </tr>
              </thead>
              <tbody>
                {questions.map((q) => {
                  const r = byNumber.get(q.questionNumber)!;
                  return (
                    <tr key={q.questionNumber} className="border-border border-b last:border-0">
                      <td className="py-1.5 pr-2">
                        <a
                          href={`#q-${q.questionNumber}`}
                          onClick={() => openQuestion(q.questionNumber)}
                          className="font-bold underline-offset-2 hover:underline"
                        >
                          {q.questionNumber}번
                        </a>
                      </td>
                      <td className="py-1.5 pr-2">
                        {r.userAnswer ? formatAnswer(r.userAnswer, q.choiceCount) : "—"}
                      </td>
                      <td className="py-1.5 pr-2 font-semibold">
                        {formatAnswer(q.answer, q.choiceCount)}
                      </td>
                      <td className="py-1.5 pr-2">{q.score}</td>
                      <td className="py-1.5">
                        {r.userAnswer === null ? (
                          <span className="text-muted-foreground">미입력</span>
                        ) : r.isCorrect ? (
                          <span className="text-success-strong inline-flex items-center gap-0.5 font-semibold">
                            <CheckIcon className="size-4" aria-hidden />
                            정답
                          </span>
                        ) : (
                          <a
                            href={`#q-${q.questionNumber}`}
                            onClick={() => openQuestion(q.questionNumber)}
                            className="text-danger-strong inline-flex items-center gap-0.5 font-semibold underline-offset-2 hover:underline"
                          >
                            <XIcon className="size-4" aria-hidden />
                            오답 · 해설
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
