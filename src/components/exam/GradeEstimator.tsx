"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { GRADE_CUT_SOURCE_LABELS } from "@/lib/constants";
import type { GradeCut, GradeCutEntry } from "@/lib/data/types";
import { estimateGrade, isMutedEstimate, orderGradeCutColumns } from "@/lib/grade-cuts";

export function GradeEstimator({
  gradeCuts,
  fixedCuts,
  maxScore = 100,
}: {
  gradeCuts: GradeCut[];
  fixedCuts?: GradeCutEntry[];
  maxScore?: number;
}) {
  const [value, setValue] = useState("");
  const score = value.trim() === "" ? null : Number(value);
  const valid = score !== null && Number.isInteger(score) && score >= 0 && score <= maxScore;

  const fixedEstimate = valid && fixedCuts ? estimateGrade(fixedCuts, score) : null;
  const estimates = useMemo(
    () =>
      valid
        ? orderGradeCutColumns(gradeCuts)
            .map((cut) => ({ cut, estimate: estimateGrade(cut.cuts, score) }))
            .filter(
              (
                x,
              ): x is { cut: GradeCut; estimate: NonNullable<ReturnType<typeof estimateGrade>> } =>
                Boolean(x.estimate),
            )
        : [],
    [gradeCuts, score, valid],
  );

  return (
    <div className="border-border bg-muted/40 rounded-md border p-3">
      <label className="text-sm font-semibold" htmlFor="grade-cut-score">
        내 원점수로 등급 확인
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id="grade-cut-score"
          type="number"
          min={0}
          max={maxScore}
          step={1}
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="예: 84"
          className="border-border bg-background h-10 w-28 rounded-md border px-3 text-sm tabular-nums"
        />
        <span className="text-muted-foreground text-xs">
          0~{maxScore}점 · 입력값은 저장하지 않습니다.
        </span>
      </div>

      {value && !valid ? (
        <p className="text-danger-strong mt-2 text-sm" role="alert">
          0~{maxScore} 사이의 정수 원점수를 입력하세요.
        </p>
      ) : null}

      {valid ? (
        <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
          {fixedEstimate ? (
            <div className="border-border bg-primary-soft min-w-32 rounded-md border px-3 py-2">
              <div className="text-xs font-semibold">절대평가 고정 기준</div>
              <p className="mt-1 text-lg font-extrabold tabular-nums">
                {fixedEstimate.grade === null ? "9등급" : fixedEstimate.label}
              </p>
            </div>
          ) : null}
          {estimates.map(({ cut, estimate }) => (
            <div
              key={cut.source}
              className={`border-border min-w-32 rounded-md border px-3 py-2 ${cut.isOfficial ? "bg-primary-soft" : isMutedEstimate(cut, gradeCuts) ? "bg-muted text-muted-foreground" : "bg-background"}`}
            >
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-semibold">{GRADE_CUT_SOURCE_LABELS[cut.source]}</span>
                <Badge variant={cut.isOfficial ? "default" : "warning"}>
                  {cut.isOfficial ? "공식" : "예상"}
                </Badge>
              </div>
              <p className="mt-1 text-lg font-extrabold tabular-nums">{estimate.label}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
