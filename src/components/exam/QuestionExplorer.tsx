"use client";

import { ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DIFFICULT_RATE_THRESHOLD, VERY_DIFFICULT_RATE_THRESHOLD } from "@/lib/constants";
import type { QuestionWithStats } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { formatAnswer } from "./answer-format";
import {
  GRADED_EVENT,
  readJson,
  resultKey,
  SHOW_QUESTION_EVENT,
  type StoredResult,
} from "./grader-storage";
import { QuestionStatistics } from "./QuestionStatistics";

type Filter = "all" | "difficult" | "very-difficult" | "wrong";
type Sort = "number" | "rate";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "difficult", label: `어려운 문제 (정답률 ${DIFFICULT_RATE_THRESHOLD}% 이하)` },
  { value: "very-difficult", label: `정답률 ${VERY_DIFFICULT_RATE_THRESHOLD}% 이하` },
  { value: "wrong", label: "내가 틀린 문제" },
];

/**
 * 문항별 해설 + 정답률 + 어려운 문제/내가 틀린 문제 필터.
 * 각 문항은 id="q-{번호}" 앵커를 가져 자동 채점 결과에서 바로 이동할 수 있다.
 */
export function QuestionExplorer({
  examId,
  subject,
  questions,
}: {
  examId: string;
  subject: string;
  questions: QuestionWithStats[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("number");
  const [openSet, setOpenSet] = useState<Set<number>>(() => new Set());
  const [wrongNumbers, setWrongNumbers] = useState<number[] | null>(null);
  const hasStats = questions.some((q) => q.statistic);

  const reveal = useCallback((n: number) => {
    setFilter("all");
    setOpenSet((prev) => new Set(prev).add(n));
    requestAnimationFrame(() => {
      const el = document.getElementById(`q-${n}`);
      el?.scrollIntoView({ block: "start" });
      el?.querySelector("summary")?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    const stored = readJson<StoredResult>(resultKey(examId, subject));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 동기화
    if (stored) setWrongNumbers(stored.wrongNumbers);

    const onGraded = (e: Event) => {
      const detail = (e as CustomEvent<StoredResult | null>).detail;
      setWrongNumbers(detail ? detail.wrongNumbers : null);
    };
    const onShow = (e: Event) => reveal((e as CustomEvent<number>).detail);
    const onHash = () => {
      const match = /^#q-(\d+)$/.exec(window.location.hash);
      if (match) reveal(Number(match[1]));
    };
    onHash();
    window.addEventListener(GRADED_EVENT, onGraded);
    window.addEventListener(SHOW_QUESTION_EVENT, onShow);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener(GRADED_EVENT, onGraded);
      window.removeEventListener(SHOW_QUESTION_EVENT, onShow);
      window.removeEventListener("hashchange", onHash);
    };
  }, [examId, subject, reveal]);

  const visible = useMemo(() => {
    const rate = (q: QuestionWithStats) => q.statistic?.correctRate ?? Number.POSITIVE_INFINITY;
    let list = questions;
    if (filter === "difficult") list = list.filter((q) => rate(q) <= DIFFICULT_RATE_THRESHOLD);
    if (filter === "very-difficult")
      list = list.filter((q) => rate(q) <= VERY_DIFFICULT_RATE_THRESHOLD);
    if (filter === "wrong") {
      const wrong = new Set(wrongNumbers ?? []);
      list = list.filter((q) => wrong.has(q.questionNumber));
    }
    return sort === "rate" ? [...list].sort((a, b) => rate(a) - rate(b)) : list;
  }, [questions, filter, sort, wrongNumbers]);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="문항 필터">
        {FILTERS.filter((f) => hasStats || f.value === "all" || f.value === "wrong").map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "min-h-10 rounded-full border px-3 text-sm font-semibold",
              filter === f.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:border-primary",
            )}
          >
            {f.label}
          </button>
        ))}
        {hasStats ? (
          <button
            type="button"
            aria-pressed={sort === "rate"}
            onClick={() => setSort((s) => (s === "rate" ? "number" : "rate"))}
            className={cn(
              "min-h-10 rounded-full border px-3 text-sm font-semibold",
              sort === "rate"
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:border-foreground",
            )}
          >
            정답률 낮은 순
          </button>
        ) : null}
      </div>

      <p className="text-muted-foreground mt-2 text-sm" aria-live="polite">
        {filter === "wrong" && !wrongNumbers
          ? "자동 채점을 먼저 하면 내가 틀린 문제만 모아볼 수 있습니다."
          : `${visible.length}문항`}
      </p>

      <ul className="divide-border border-border mt-2 divide-y rounded-md border">
        {visible.map((q) => {
          const rate = q.statistic?.correctRate;
          const isWrong = wrongNumbers?.includes(q.questionNumber);
          return (
            <li key={q.id}>
              <details
                id={`q-${q.questionNumber}`}
                className="group scroll-mt-20"
                open={openSet.has(q.questionNumber)}
                onToggle={(e) => {
                  const isOpen = e.currentTarget.open;
                  setOpenSet((prev) => {
                    if (prev.has(q.questionNumber) === isOpen) return prev;
                    const next = new Set(prev);
                    if (isOpen) next.add(q.questionNumber);
                    else next.delete(q.questionNumber);
                    return next;
                  });
                }}
              >
                <summary className="hover:bg-muted focus-visible:ring-ring/60 flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 focus-visible:ring-[3px] focus-visible:outline-none">
                  <span className="w-10 font-bold tabular-nums">{q.questionNumber}번</span>
                  <span className="text-sm">
                    정답 <strong>{formatAnswer(q.answer, q.choiceCount)}</strong>
                  </span>
                  <span className="text-muted-foreground text-xs">{q.score}점</span>
                  {rate !== undefined ? (
                    <span
                      className={cn(
                        "text-sm tabular-nums",
                        rate <= DIFFICULT_RATE_THRESHOLD && "text-danger-strong font-bold",
                      )}
                    >
                      정답률 {Math.round(rate)}%
                    </span>
                  ) : null}
                  {isWrong ? <Badge variant="danger">틀림</Badge> : null}
                  <span className="text-muted-foreground ml-auto flex items-center gap-1 text-xs">
                    <span className="group-open:hidden">해설 보기</span>
                    <span className="hidden group-open:inline">접기</span>
                    <ChevronDownIcon className="size-4 group-open:rotate-180" aria-hidden />
                  </span>
                </summary>
                <div className="border-border bg-muted/40 space-y-3 border-t px-3 py-3">
                  <p className="text-sm leading-relaxed">
                    {q.explanation ?? "웹 해설 준비 중입니다. 정답·해설 PDF를 참고해 주세요."}
                  </p>
                  {q.solutionPage ? (
                    <p className="text-muted-foreground text-xs">
                      정답·해설 PDF {q.solutionPage}쪽
                    </p>
                  ) : null}
                  {q.statistic ? (
                    <QuestionStatistics statistic={q.statistic} answer={q.answer} />
                  ) : null}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
