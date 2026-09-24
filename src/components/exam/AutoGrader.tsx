"use client";

import { CheckIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Question } from "@/lib/data/types";
import { gradeAnswers, type GradeResult, type UserAnswers } from "@/lib/grading";
import { cn } from "@/lib/utils";
import {
  answersKey,
  GRADED_EVENT,
  readJson,
  removeKey,
  resultKey,
  SHOW_QUESTION_EVENT,
  writeJson,
  type StoredResult,
} from "./grader-storage";

type GraderQuestion = Pick<Question, "questionNumber" | "answer" | "score" | "choiceCount">;

export function AutoGrader({
  examId,
  subject,
  questions,
}: {
  examId: string;
  subject: string;
  questions: GraderQuestion[];
}) {
  const [answers, setAnswers] = useState<UserAnswers>({});
  const [result, setResult] = useState<GradeResult | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const storageKey = answersKey(examId, subject);

  // 진행 중 답안 복원 (hydration 이후에만 localStorage 접근)
  useEffect(() => {
    const saved = readJson<UserAnswers>(storageKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 저장소 동기화
    if (saved) setAnswers(saved);
  }, [storageKey]);

  function update(number: number, value: string) {
    setAnswers((prev) => {
      const next = { ...prev, [number]: value };
      if (!value) delete next[number];
      writeJson(storageKey, next);
      return next;
    });
  }

  function grade() {
    const graded = gradeAnswers(questions, answers);
    setResult(graded);
    const stored: StoredResult = {
      rawScore: graded.rawScore,
      wrongNumbers: graded.wrongNumbers,
      gradedAt: new Date().toISOString(),
    };
    writeJson(resultKey(examId, subject), stored);
    window.dispatchEvent(new CustomEvent(GRADED_EVENT, { detail: stored }));
    requestAnimationFrame(() => resultRef.current?.focus());
  }

  function reset() {
    setAnswers({});
    setResult(null);
    removeKey(storageKey);
    removeKey(resultKey(examId, subject));
    window.dispatchEvent(new CustomEvent(GRADED_EVENT, { detail: null }));
  }

  const answeredCount = Object.keys(answers).length;
  const resultByNumber = new Map(result?.results.map((r) => [r.questionNumber, r]));

  return (
    <div>
      <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
        {questions.map((q) => {
          const r = resultByNumber.get(q.questionNumber);
          const value = answers[q.questionNumber] ?? "";
          return (
            <fieldset
              key={q.questionNumber}
              className="border-border flex items-center gap-2 border-b py-1.5"
            >
              <legend className="sr-only">{q.questionNumber}번 답안</legend>
              <span
                aria-hidden
                className={cn(
                  "w-9 shrink-0 text-right text-sm font-bold tabular-nums",
                  r && (r.isCorrect ? "text-success-strong" : "text-danger-strong"),
                )}
              >
                {q.questionNumber}
              </span>
              {q.choiceCount ? (
                <div className="flex gap-1">
                  {Array.from({ length: q.choiceCount }, (_, i) => String(i + 1)).map((choice) => (
                    <label key={choice} className="relative">
                      <input
                        type="radio"
                        name={`grader-${q.questionNumber}`}
                        value={choice}
                        checked={value === choice}
                        onChange={() => update(q.questionNumber, choice)}
                        className="peer sr-only"
                        aria-label={`${q.questionNumber}번 ${choice}번 선택`}
                      />
                      <span className="border-border peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-ring/60 hover:border-primary flex size-10 cursor-pointer items-center justify-center rounded-md border text-sm font-semibold tabular-nums peer-focus-visible:ring-[3px]">
                        {choice}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={3}
                  value={value}
                  onChange={(e) => update(q.questionNumber, e.target.value.replace(/\D/g, ""))}
                  aria-label={`${q.questionNumber}번 단답형 답`}
                  placeholder="답"
                  className="border-border focus-visible:border-primary focus-visible:ring-ring/40 h-10 w-24 rounded-md border px-2 text-base tabular-nums outline-none focus-visible:ring-[3px]"
                />
              )}
              {r ? (
                <span className="ml-auto flex items-center gap-0.5 text-xs font-semibold">
                  {r.isCorrect ? (
                    <>
                      <CheckIcon className="text-success-strong size-4" aria-hidden />
                      <span className="sr-only">정답</span>
                    </>
                  ) : (
                    <>
                      <XIcon className="text-danger-strong size-4" aria-hidden />
                      <span className="text-danger-strong">정답 {r.correctAnswer}</span>
                    </>
                  )}
                </span>
              ) : null}
            </fieldset>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={grade} size="lg" className="flex-1 sm:flex-none">
          채점하기
        </Button>
        <Button onClick={reset} variant="outline" size="lg">
          <RotateCcwIcon aria-hidden />
          초기화
        </Button>
        <span className="text-muted-foreground text-sm" aria-live="polite">
          {answeredCount} / {questions.length} 입력
        </span>
      </div>

      {result ? (
        <div
          ref={resultRef}
          tabIndex={-1}
          role="region"
          aria-label="채점 결과"
          className="border-border focus-visible:ring-ring/60 mt-4 rounded-md border p-4 outline-none focus-visible:ring-[3px]"
        >
          <p className="text-3xl font-extrabold tabular-nums">
            {result.rawScore}
            <span className="text-lg font-bold">점</span>
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              / {result.totalScore}점
            </span>
          </p>
          <dl className="mt-2 flex gap-4 text-sm">
            <div className="flex gap-1">
              <dt className="text-muted-foreground">맞음</dt>
              <dd className="text-success-strong font-bold">{result.correctCount}문항</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-muted-foreground">틀림</dt>
              <dd className="text-danger-strong font-bold">{result.wrongCount}문항</dd>
            </div>
            {result.unansweredCount ? (
              <div className="flex gap-1">
                <dt className="text-muted-foreground">미응답</dt>
                <dd className="font-bold">{result.unansweredCount}문항</dd>
              </div>
            ) : null}
          </dl>
          {result.wrongNumbers.length ? (
            <div className="mt-3">
              <p className="text-sm font-semibold">틀린 문제 (누르면 해설로 이동)</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {result.wrongNumbers.map((n) => (
                  <li key={n}>
                    <a
                      href={`#q-${n}`}
                      onClick={() =>
                        window.dispatchEvent(new CustomEvent(SHOW_QUESTION_EVENT, { detail: n }))
                      }
                      className="border-danger-strong/40 bg-danger-soft text-danger-strong hover:border-danger-strong inline-flex size-11 items-center justify-center rounded-md border font-bold tabular-nums"
                      aria-label={`${n}번 해설 보기`}
                    >
                      {n}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-success-strong mt-3 font-semibold">모든 문제를 맞혔습니다!</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
