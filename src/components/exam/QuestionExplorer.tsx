"use client";

import { ChevronDownIcon, ExternalLinkIcon, PlayIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playListeningTrack } from "@/components/english/events";
import { Badge } from "@/components/ui/badge";
import {
  CHOICE_SYMBOLS,
  DIFFICULT_RATE_THRESHOLD,
  VERY_DIFFICULT_RATE_THRESHOLD,
} from "@/lib/constants";
import type { ListeningTrack, QuestionWithStats, VocabularyItem } from "@/lib/data/types";
import { normalizeAnswer, type UserAnswers } from "@/lib/grading";
import { cn } from "@/lib/utils";
import { formatAnswer } from "./answer-format";
import {
  ANSWERS_EVENT,
  answersKey,
  GRADED_EVENT,
  readJson,
  resultKey,
  SHOW_QUESTION_EVENT,
  SHOW_WRONG_EVENT,
  type StoredResult,
} from "./grader-storage";
import { QuestionStatistics } from "./QuestionStatistics";

type Filter = "all" | "difficult" | "very-difficult" | "wrong";
type Sort = "number" | "rate";

export interface QuestionConceptTag {
  name: string;
  href: string;
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "wrong", label: "틀린 문제만" },
  { value: "difficult", label: `어려운 문제 (정답률 ${DIFFICULT_RATE_THRESHOLD}% 이하)` },
  { value: "very-difficult", label: `정답률 ${VERY_DIFFICULT_RATE_THRESHOLD}% 이하` },
];

/**
 * 문항별 학습 카드: 번호 · 내 답/정답/배점/정오 · 보기 · 해설(해설지 쪽 연결) · 듣기·대본 · 단어 · 개념 태그 · 정답률.
 * 없는 데이터는 만들지 않는다 (해설·대본·통계가 없으면 "준비 중"/링크만).
 * 각 문항은 id="q-{번호}" 앵커 — 채점 결과·많이 틀린 문제에서 바로 이동한다.
 */
export function QuestionExplorer({
  examId,
  subject,
  questions,
  solutionHref = null,
  tracks = [],
  vocabulary = [],
  concepts = {},
}: {
  examId: string;
  subject: string;
  questions: QuestionWithStats[];
  /** 이 과목 정답·해설 PDF 보기 URL (있을 때만) */
  solutionHref?: string | null;
  tracks?: ListeningTrack[];
  vocabulary?: VocabularyItem[];
  /** question id → 승인된 개념 태그 */
  concepts?: Record<string, QuestionConceptTag[]>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("number");
  const [openSet, setOpenSet] = useState<Set<number>>(() => new Set());
  const [wrongNumbers, setWrongNumbers] = useState<number[] | null>(null);
  const [answers, setAnswers] = useState<UserAnswers>({});
  const [ready, setReady] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const hasStats = questions.some((q) => q.statistic);
  const trackBy = useMemo(
    () =>
      new Map(tracks.filter((t) => t.questionNumber !== null).map((t) => [t.questionNumber!, t])),
    [tracks],
  );
  const vocabBy = useMemo(() => {
    const m = new Map<number, VocabularyItem[]>();
    for (const v of vocabulary) m.set(v.questionNumber, [...(m.get(v.questionNumber) ?? []), v]);
    return m;
  }, [vocabulary]);

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
    // hydration 전에 사용자가 연 카드(네이티브 <details>)는 상태로 받아서, 다음 렌더에서 닫히지 않게 한다
    const openedEarly = [
      ...(listRef.current?.querySelectorAll<HTMLDetailsElement>("details[open][id^='q-']") ?? []),
    ].map((el) => Number(el.id.slice(2)));
    if (openedEarly.length) setOpenSet((prev) => new Set([...prev, ...openedEarly]));
    setReady(true);
    const stored = readJson<StoredResult>(resultKey(examId, subject));
    if (stored) setWrongNumbers(stored.wrongNumbers);
    const saved = readJson<UserAnswers>(answersKey(examId, subject));
    if (saved) setAnswers(saved);

    const onGraded = (e: Event) => {
      const detail = (e as CustomEvent<StoredResult | null>).detail;
      setWrongNumbers(detail ? detail.wrongNumbers : null);
    };
    const onAnswers = (e: Event) => setAnswers((e as CustomEvent<UserAnswers>).detail);
    const onShow = (e: Event) => reveal((e as CustomEvent<number>).detail);
    const onShowWrong = () => {
      setFilter("wrong");
      const latest = readJson<StoredResult>(resultKey(examId, subject));
      if (latest) setOpenSet(new Set(latest.wrongNumbers));
      requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: "start" }));
    };
    const onHash = () => {
      const match = /^#q-(\d+)$/.exec(window.location.hash);
      if (match) reveal(Number(match[1]));
    };
    onHash();
    window.addEventListener(GRADED_EVENT, onGraded);
    window.addEventListener(ANSWERS_EVENT, onAnswers);
    window.addEventListener(SHOW_QUESTION_EVENT, onShow);
    window.addEventListener(SHOW_WRONG_EVENT, onShowWrong);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener(GRADED_EVENT, onGraded);
      window.removeEventListener(ANSWERS_EVENT, onAnswers);
      window.removeEventListener(SHOW_QUESTION_EVENT, onShow);
      window.removeEventListener(SHOW_WRONG_EVENT, onShowWrong);
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
    <div
      ref={listRef}
      className="scroll-mt-4"
      data-testid="question-explorer"
      data-ready={ready ? "" : undefined}
    >
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
          ? "위에서 채점하면 틀린 문제만 모아볼 수 있습니다."
          : `${visible.length}문항`}
      </p>

      <ul className="divide-border border-border mt-2 divide-y rounded-md border">
        {visible.map((q) => {
          const rate = q.statistic?.correctRate;
          const mine = answers[q.questionNumber] ?? null;
          const state =
            mine === null
              ? "unanswered"
              : normalizeAnswer(mine) === normalizeAnswer(q.answer)
                ? "correct"
                : "wrong";
          const graded = wrongNumbers !== null;
          const track = trackBy.get(q.questionNumber);
          const words = vocabBy.get(q.questionNumber) ?? [];
          const tags = concepts[q.id] ?? [];
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
                <summary className="hover:bg-muted focus-visible:ring-ring/60 flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 focus-visible:ring-[3px] focus-visible:outline-none">
                  <span className="w-10 font-bold tabular-nums">{q.questionNumber}번</span>
                  {mine !== null ? (
                    <span className="text-sm">
                      내 답 <strong>{formatAnswer(mine, q.choiceCount)}</strong>
                    </span>
                  ) : null}
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
                  {graded && state === "wrong" ? <Badge variant="danger">틀림</Badge> : null}
                  {graded && state === "correct" ? <Badge variant="success">맞음</Badge> : null}
                  {graded && state === "unanswered" ? <Badge>미입력</Badge> : null}
                  <span className="text-muted-foreground ml-auto flex items-center gap-1 text-xs">
                    <span className="group-open:hidden">자세히</span>
                    <span className="hidden group-open:inline">접기</span>
                    <ChevronDownIcon className="size-4 group-open:rotate-180" aria-hidden />
                  </span>
                </summary>
                <div className="border-border bg-muted/40 space-y-4 border-t px-3 py-3">
                  {q.choiceCount ? (
                    <ol
                      className="flex flex-wrap gap-1.5"
                      aria-label={`${q.questionNumber}번 선택지`}
                    >
                      {Array.from({ length: q.choiceCount }, (_, i) => String(i + 1)).map((c) => {
                        const isAnswer = c === normalizeAnswer(q.answer);
                        const isMine = c === mine;
                        return (
                          <li
                            key={c}
                            className={cn(
                              "flex min-h-10 min-w-16 items-center justify-center gap-1 rounded-md border px-2 text-sm",
                              isAnswer
                                ? "border-primary bg-primary/10 font-bold"
                                : isMine
                                  ? "border-danger-strong bg-danger-soft"
                                  : "border-border bg-background",
                            )}
                          >
                            <span className="text-base">{CHOICE_SYMBOLS[Number(c) - 1]}</span>
                            {isAnswer ? <span className="text-xs">정답</span> : null}
                            {isMine && !isAnswer ? <span className="text-xs">내 답</span> : null}
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}

                  <div>
                    <h4 className="text-sm font-bold">해설</h4>
                    {q.explanation ? (
                      <p className="mt-1 text-sm leading-relaxed">{q.explanation}</p>
                    ) : (
                      <p className="text-muted-foreground mt-1 text-sm">
                        문항별 웹 해설은 준비 중입니다.
                      </p>
                    )}
                    {solutionHref ? (
                      <a
                        href={
                          q.solutionPage ? `${solutionHref}#page=${q.solutionPage}` : solutionHref
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary mt-1 inline-flex min-h-10 items-center gap-1 text-sm font-semibold underline-offset-2 hover:underline"
                      >
                        {q.solutionPage ? `해설지 ${q.solutionPage}쪽 보기` : "해설지 보기"}
                        <ExternalLinkIcon className="size-3.5" aria-hidden />
                      </a>
                    ) : null}
                  </div>

                  {track ? (
                    <div>
                      <h4 className="text-sm font-bold">듣기</h4>
                      <button
                        type="button"
                        onClick={() => playListeningTrack(q.questionNumber)}
                        className="border-border hover:border-primary mt-1 inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold"
                      >
                        <PlayIcon className="size-4" aria-hidden />
                        {q.questionNumber}번 듣기
                      </button>
                      <details className="mt-2">
                        <summary className="text-sm font-semibold">듣기 대본</summary>
                        {track.transcript?.length ? (
                          <div className="mt-1 space-y-1 text-sm leading-relaxed">
                            {track.transcript.map((line, i) => (
                              <p key={i}>
                                {line.speaker ? (
                                  <strong className="mr-1">{line.speaker}:</strong>
                                ) : null}
                                {line.text}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground mt-1 text-sm">대본 준비 중</p>
                        )}
                      </details>
                    </div>
                  ) : null}

                  {words.length ? (
                    <div>
                      <h4 className="text-sm font-bold">핵심 단어</h4>
                      <ul className="mt-1 grid gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
                        {words.map((w) => (
                          <li key={w.id}>
                            <strong>{w.word}</strong>
                            {w.partOfSpeech ? (
                              <span className="text-muted-foreground ml-1 text-xs">
                                {w.partOfSpeech}
                              </span>
                            ) : null}{" "}
                            {w.meaning}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {tags.length ? (
                    <ul className="flex flex-wrap gap-1.5" aria-label="기본 개념">
                      {tags.map((t) => (
                        <li key={t.href}>
                          <Link
                            href={t.href}
                            prefetch={false}
                            className="bg-background border-border hover:border-primary inline-flex min-h-9 items-center rounded-full border px-3 text-sm"
                          >
                            #{t.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
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
