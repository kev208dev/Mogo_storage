"use client";

import { useEffect, useMemo, useState } from "react";
import type { VocabularyItem } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { dedupeVocabulary, filterVocabulary } from "@/lib/vocab-filter";

const DIFFICULTY_LABEL = { 1: "기본", 2: "중요", 3: "고난도" } as const;

const unknownKey = (examId: string) => `mogo:unknown-words:${examId}`;

export function VocabularyList({ items: rawItems }: { items: VocabularyItem[] }) {
  const items = useMemo(() => dedupeVocabulary(rawItems), [rawItems]);
  const examId = items[0]?.examId ?? "";
  const numbers = useMemo(
    () => [...new Set(items.map((v) => v.questionNumber))].sort((a, b) => a - b),
    [items],
  );
  const [selected, setSelected] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [unknownOnly, setUnknownOnly] = useState(false);
  const [unknown, setUnknown] = useState<Set<string>>(() => new Set());

  // 모르는 단어 체크는 이 기기에만 저장한다
  useEffect(() => {
    try {
      const raw = localStorage.getItem(unknownKey(examId));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 저장소 동기화
      if (raw) setUnknown(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* 저장소 사용 불가 */
    }
  }, [examId]);

  function toggleUnknown(id: string) {
    setUnknown((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(unknownKey(examId), JSON.stringify([...next]));
      } catch {
        /* 저장소 사용 불가 */
      }
      return next;
    });
  }

  const visible = filterVocabulary(
    items,
    { query, questionNumber: selected, unknownOnly },
    unknown,
  );

  return (
    <div>
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
      </div>
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
      <div className="border-border mt-3 overflow-x-auto rounded-md border">
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
            </tr>
          </thead>
          <tbody>
            {visible.map((v) => (
              <tr key={v.id} className="border-border border-b last:border-0">
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={unknown.has(v.id)}
                    onChange={() => toggleUnknown(v.id)}
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
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-3 py-4 text-center">
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
