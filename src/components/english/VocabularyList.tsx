"use client";

import { useEffect, useMemo, useState } from "react";
import type { VocabularyItem } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { dedupeVocabulary, filterVocabulary } from "@/lib/vocab-filter";

const DIFFICULTY_LABEL = { 1: "기본", 2: "중요", 3: "고난도" } as const;

const unknownKey = (examId: string) => `mogo:unknown-words:${examId}`;
const memorizedKey = (examId: string) => `mogo:memorized-words:${examId}`;

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, value: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    /* 저장소 사용 불가 */
  }
}

export function VocabularyList({
  items: rawItems,
  title,
}: {
  items: VocabularyItem[];
  /** 인쇄 머리말 (예: "2025년 고2 9월 영어 지문별 단어장") */
  title?: string;
}) {
  const items = useMemo(() => dedupeVocabulary(rawItems), [rawItems]);
  const examId = items[0]?.examId ?? "";
  const numbers = useMemo(
    () => [...new Set(items.map((v) => v.questionNumber))].sort((a, b) => a - b),
    [items],
  );
  const [selected, setSelected] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [unknownOnly, setUnknownOnly] = useState(false);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | "all">("all");
  const [hideMemorized, setHideMemorized] = useState(false);
  const [unknown, setUnknown] = useState<Set<string>>(() => new Set());
  const [memorized, setMemorized] = useState<Set<string>>(() => new Set());
  const [ready, setReady] = useState(false);

  // 모르는 단어 · 외운 단어 표시는 이 기기에만 저장한다
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 저장소 동기화
    setUnknown(readSet(unknownKey(examId)));
    setMemorized(readSet(memorizedKey(examId)));
    setReady(true);
  }, [examId]);

  function toggleIn(setter: typeof setUnknown, key: string, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeSet(key, next);
      return next;
    });
  }

  function print() {
    document.documentElement.dataset.print = "vocabulary";
    const done = () => {
      delete document.documentElement.dataset.print;
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  }

  const visible = filterVocabulary(
    items,
    { query, questionNumber: selected, unknownOnly, difficulty, hideMemorized },
    unknown,
    memorized,
  );
  const difficulties = [...new Set(items.map((v) => v.difficulty))].sort();

  return (
    <div data-testid="vocabulary-list" data-ready={ready ? "" : undefined}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="단어·뜻 검색"
          aria-label="단어 검색"
          className="border-border focus-visible:ring-ring/60 min-h-10 flex-1 rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none"
        />
        <label className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold">
          <input
            type="checkbox"
            checked={unknownOnly}
            onChange={(e) => setUnknownOnly(e.target.checked)}
          />
          모르는 단어만 ({unknown.size})
        </label>
        <label className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold">
          <input
            type="checkbox"
            checked={hideMemorized}
            onChange={(e) => setHideMemorized(e.target.checked)}
          />
          외운 단어 숨기기 ({memorized.size})
        </label>
        <button
          type="button"
          onClick={print}
          className="border-border hover:border-primary min-h-10 rounded-md border px-3 text-sm font-semibold"
        >
          인쇄
        </button>
      </div>
      {difficulties.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="난이도로 단어 필터">
          {(["all", ...difficulties] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={difficulty === d}
              onClick={() => setDifficulty(d)}
              className={cn(
                "min-h-10 rounded-full border px-3 text-sm font-semibold",
                difficulty === d
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:border-primary",
              )}
            >
              {d === "all" ? "모든 난이도" : DIFFICULTY_LABEL[d]}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="문항 번호로 단어 필터">
        {(["all", ...numbers] as const).map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={selected === n}
            onClick={() => setSelected(n)}
            className={cn(
              "min-h-10 min-w-12 rounded-full border px-3 text-sm font-semibold tabular-nums",
              selected === n
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:border-primary",
            )}
          >
            {n === "all" ? "전체" : `${n}번`}
          </button>
        ))}
      </div>
      <div id="vocabulary-print" className="border-border mt-3 overflow-x-auto rounded-md border">
        {title ? <p className="hidden px-3 py-2 font-bold print:block">{title}</p> : null}
        <table className="w-full text-sm">
          <caption className="sr-only">
            {selected === "all" ? "전체" : `${selected}번`} 지문 단어 {visible.length}개
          </caption>
          <thead>
            <tr className="border-border bg-muted border-b text-left">
              <th scope="col" className="w-12 px-2 py-2 font-semibold">
                <span className="sr-only">모르는 단어 표시</span>
                <span aria-hidden>모름</span>
              </th>
              <th scope="col" className="w-14 px-3 py-2 font-semibold">
                문항
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                단어
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                뜻
              </th>
              <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">
                난이도
              </th>
              <th scope="col" className="print-hidden w-16 px-2 py-2 font-semibold">
                <span className="sr-only">외운 단어 표시</span>
                <span aria-hidden>외움</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((v) => (
              <tr key={v.id} className="border-border border-b last:border-0">
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={unknown.has(v.id)}
                    onChange={() => toggleIn(setUnknown, unknownKey(examId), v.id)}
                    aria-label={`${v.word} 모르는 단어로 표시`}
                    className="size-5"
                  />
                </td>
                <td className="text-muted-foreground px-3 py-2 tabular-nums">{v.questionNumber}</td>
                <th scope="row" className="px-3 py-2 text-left font-semibold" lang="en">
                  <span data-testid="vocab-word">{v.word}</span>
                  {v.partOfSpeech ? (
                    <span className="text-muted-foreground ml-1 text-xs font-normal">
                      {v.partOfSpeech}
                    </span>
                  ) : null}
                </th>
                <td className="px-3 py-2">{v.meaning}</td>
                <td className="text-muted-foreground hidden px-3 py-2 sm:table-cell">
                  {DIFFICULTY_LABEL[v.difficulty]}
                </td>
                <td className="print-hidden px-2 py-2">
                  <button
                    type="button"
                    aria-pressed={memorized.has(v.id)}
                    aria-label={`${v.word} 외운 단어로 표시`}
                    onClick={() => toggleIn(setMemorized, memorizedKey(examId), v.id)}
                    className={cn(
                      "min-h-9 rounded-md border px-2 text-xs font-semibold",
                      memorized.has(v.id)
                        ? "border-success-strong bg-success-soft text-success-strong"
                        : "border-border",
                    )}
                  >
                    {memorized.has(v.id) ? "외움" : "외우기"}
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted-foreground px-3 py-4 text-center">
                  조건에 맞는 단어가 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
