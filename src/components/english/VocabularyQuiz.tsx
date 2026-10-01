"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { VocabularyItem } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import {
  buildQuiz,
  isQuizAnswerCorrect,
  type QuizDirection,
  type QuizFormat,
  type QuizQuestion,
} from "@/lib/vocabulary-quiz";
import { readJson, writeJson } from "@/components/exam/grader-storage";

type Count = 10 | 20 | 30 | "all";
interface Answer {
  question: QuizQuestion;
  input: string;
  correct: boolean;
}

function RadioChips<T extends string | number>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label key={String(o.value)}>
            <input
              type="radio"
              name={name}
              className="peer sr-only"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className="border-border peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-ring/60 flex min-h-10 cursor-pointer items-center rounded-full border px-3 text-sm font-semibold peer-focus-visible:ring-[3px]">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function VocabularyQuiz({ examId, items }: { examId: string; items: VocabularyItem[] }) {
  const [direction, setDirection] = useState<QuizDirection>("en-ko");
  const [format, setFormat] = useState<QuizFormat>("choice");
  const [count, setCount] = useState<Count>(10);
  const [quiz, setQuiz] = useState<QuizQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<Answer | null>(null);
  const promptRef = useRef<HTMLParagraphElement>(null);
  const [lastWrong, setLastWrong] = useState<VocabularyItem[]>([]);
  const [ready, setReady] = useState(false);

  // 지난 시험에서 틀린 단어 (이 기기에 저장된 기록)
  useEffect(() => {
    const saved = readJson<{ wrong?: string[] }>(`mogo:vocab-quiz:${examId}`);
    const ids = new Set(saved?.wrong ?? []);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 저장소 동기화
    setLastWrong(items.filter((v) => ids.has(v.id)));
    setReady(true);
  }, [examId, items, quiz]);

  function start(source: VocabularyItem[] = items) {
    const next = buildQuiz(source, {
      direction,
      format,
      count: count === "all" ? "all" : Math.min(count, source.length),
    });
    setQuiz(next);
    setIndex(0);
    setAnswers([]);
    setInput("");
    setFeedback(null);
    requestAnimationFrame(() => promptRef.current?.focus());
  }

  function submit(value: string) {
    if (!quiz || feedback) return;
    const question = quiz[index]!;
    const answer = { question, input: value, correct: isQuizAnswerCorrect(question, value) };
    setFeedback(answer);
    setAnswers((prev) => [...prev, answer]);
  }

  function next() {
    if (!quiz) return;
    setFeedback(null);
    setInput("");
    if (index + 1 >= quiz.length) {
      const correct = answers.filter((a) => a.correct).length;
      writeJson(`mogo:vocab-quiz:${examId}`, {
        correct,
        total: quiz.length,
        wrong: answers.filter((a) => !a.correct).map((a) => a.question.id),
        at: new Date().toISOString(),
      });
      setIndex(quiz.length);
    } else {
      setIndex(index + 1);
    }
    requestAnimationFrame(() => promptRef.current?.focus());
  }

  // ── 설정 화면 ─────────────────────────────────
  if (!quiz) {
    return (
      <div className="space-y-4" data-testid="vocabulary-quiz" data-ready={ready ? "" : undefined}>
        <RadioChips
          legend="방향"
          name="quiz-direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "en-ko", label: "영어 → 뜻" },
            { value: "ko-en", label: "뜻 → 영어" },
          ]}
        />
        <RadioChips
          legend="형식"
          name="quiz-format"
          value={format}
          onChange={setFormat}
          options={[
            { value: "choice", label: "객관식" },
            { value: "written", label: "주관식" },
          ]}
        />
        <RadioChips<Count>
          legend="문항 수"
          name="quiz-count"
          value={count}
          onChange={setCount}
          options={[
            { value: 10, label: "10" },
            { value: 20, label: "20" },
            { value: 30, label: "30" },
            { value: "all", label: `전체 (${items.length})` },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="lg" onClick={() => start()} className="w-full sm:w-auto">
            단어 시험 시작
          </Button>
          {lastWrong.length ? (
            <Button
              size="lg"
              variant="outline"
              onClick={() => start(lastWrong)}
              className="w-full sm:w-auto"
            >
              지난번 틀린 단어 다시 ({lastWrong.length})
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  // ── 결과 화면 ─────────────────────────────────
  if (index >= quiz.length) {
    const correct = answers.filter((a) => a.correct).length;
    const wrong = answers.filter((a) => !a.correct);
    return (
      <div className="space-y-4" role="region" aria-label="단어 시험 결과">
        <p
          ref={promptRef}
          tabIndex={-1}
          className="text-3xl font-extrabold tabular-nums outline-none"
        >
          {correct} / {quiz.length}
        </p>
        {wrong.length ? (
          <div>
            <p className="mb-2 text-sm font-semibold">틀린 단어</p>
            <ul className="divide-border border-border divide-y rounded-md border text-sm">
              {wrong.map((a) => (
                <li key={a.question.id} className="flex flex-wrap gap-x-3 px-3 py-2">
                  <span className="font-semibold" lang="en">
                    {a.question.item.word}
                  </span>
                  <span>{a.question.item.meaning}</span>
                  <span className="text-danger-strong">내 답: {a.input || "(미입력)"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-success-strong font-semibold">모두 맞혔습니다!</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => start()}>다시 풀기</Button>
          {wrong.length ? (
            <Button variant="outline" onClick={() => start(wrong.map((a) => a.question.item))}>
              틀린 단어만 다시
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setQuiz(null)}>
            설정 변경
          </Button>
        </div>
      </div>
    );
  }

  // ── 문제 화면 ─────────────────────────────────
  const question = quiz[index]!;
  return (
    <div className="space-y-4">
      <div className="text-muted-foreground flex items-center justify-between text-sm">
        <span className="tabular-nums">
          {index + 1} / {quiz.length}
        </span>
        <span>{question.item.questionNumber}번 지문</span>
      </div>
      <p
        ref={promptRef}
        tabIndex={-1}
        className="text-2xl font-bold outline-none"
        lang={direction === "en-ko" ? "en" : "ko"}
      >
        {question.prompt}
      </p>

      {question.choices ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {question.choices.map((choice) => {
            const chosen = feedback?.input === choice;
            const isAnswer = feedback && choice === question.answer;
            return (
              <li key={choice}>
                <button
                  type="button"
                  disabled={Boolean(feedback)}
                  onClick={() => submit(choice)}
                  className={cn(
                    "border-border hover:border-primary flex min-h-12 w-full items-center justify-between rounded-md border px-3 text-left font-semibold disabled:cursor-default",
                    isAnswer && "border-success-strong bg-success-soft text-success-strong",
                    chosen && !isAnswer && "border-danger-strong bg-danger-soft text-danger-strong",
                  )}
                >
                  {choice}
                  {isAnswer ? <CheckIcon className="size-4" aria-label="정답" /> : null}
                  {chosen && !isAnswer ? <XIcon className="size-4" aria-label="오답" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex gap-2"
        >
          <label htmlFor="quiz-input" className="sr-only">
            답 입력
          </label>
          <input
            id="quiz-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            readOnly={Boolean(feedback)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            lang={direction === "ko-en" ? "en" : "ko"}
            className="border-border focus-visible:border-primary focus-visible:ring-ring/40 h-12 flex-1 rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]"
          />
          <Button type="submit" size="lg" disabled={Boolean(feedback)}>
            확인
          </Button>
        </form>
      )}

      <div aria-live="polite">
        {feedback ? (
          <div className="flex flex-wrap items-center gap-3">
            <p
              className={cn(
                "font-semibold",
                feedback.correct ? "text-success-strong" : "text-danger-strong",
              )}
            >
              {feedback.correct ? "정답!" : `오답 · 정답: ${question.answer}`}
            </p>
            <Button onClick={next} variant="outline">
              {index + 1 >= quiz.length ? "결과 보기" : "다음"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
