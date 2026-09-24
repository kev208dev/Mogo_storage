"use client";

import { useMemo, useState } from "react";
import type { VocabularyItem } from "@/lib/data/types";
import { cn } from "@/lib/utils";

const DIFFICULTY_LABEL = { 1: "기본", 2: "중요", 3: "고난도" } as const;

export function VocabularyList({ items }: { items: VocabularyItem[] }) {
  const numbers = useMemo(
    () => [...new Set(items.map((v) => v.questionNumber))].sort((a, b) => a - b),
    [items],
  );
  const [selected, setSelected] = useState<number | "all">("all");
  const visible = selected === "all" ? items : items.filter((v) => v.questionNumber === selected);

  return (
    <div>
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
                <td className="text-muted-foreground px-3 py-2 tabular-nums">{v.questionNumber}</td>
                <th scope="row" className="px-3 py-2 text-left font-semibold" lang="en">
                  {v.word}
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
