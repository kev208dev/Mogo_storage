import { SampleNotice } from "@/components/layout/SampleNotice";
import { Badge } from "@/components/ui/badge";
import { GRADE_CUT_SOURCE_LABELS, type Subject } from "@/lib/constants";
import {
  gradeCutTableColumns,
  gradeCutTableGrades,
  gradeCutValueLabel,
  isOfficialGradeCutColumn,
} from "@/lib/grade-cut-table";
import { isMutedEstimate } from "@/lib/grade-cuts";
import { absoluteGradeCuts } from "@/lib/grade-cut-mode";
import type { Exam, GradeCut } from "@/lib/data/types";
import { cn, formatKoreanDate } from "@/lib/utils";
import { GradeEstimator } from "./GradeEstimator";

/** 공식 결과와 지원 중인 기관별 예상 등급컷을 구분해 표시한다. */
export function GradeCutTable({
  gradeCuts,
  subject,
  exam,
}: {
  gradeCuts: GradeCut[];
  subject: Subject;
  exam: Exam;
}) {
  const absolute = absoluteGradeCuts(exam, subject);
  if (absolute)
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          절대평가 · 시험별 예상컷 수집 없이 고정 원점수 기준을 적용합니다.
        </p>
        <GradeEstimator gradeCuts={[]} fixedCuts={absolute.cuts} maxScore={absolute.maxScore} />
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full min-w-[20rem] text-sm tabular-nums">
            <caption className="sr-only">절대평가 고정 원점수 등급 기준</caption>
            <thead>
              <tr className="border-border bg-muted border-b">
                <th scope="col" className="px-3 py-2 text-left">
                  등급
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  고정 원점수 기준
                </th>
              </tr>
            </thead>
            <tbody>
              {absolute.cuts.map(({ grade, rawScore }) => (
                <tr key={grade} className="border-border border-b last:border-0">
                  <th scope="row" className="px-3 py-2 text-left">
                    {grade}등급
                  </th>
                  <td className="px-3 py-2 text-right">{rawScore}점 이상</td>
                </tr>
              ))}
              <tr>
                <th scope="row" className="px-3 py-2 text-left">
                  9등급
                </th>
                <td className="px-3 py-2 text-right">{absolute.cuts[7]!.rawScore}점 미만</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );

  const columns = gradeCutTableColumns(gradeCuts);
  const grades = gradeCutTableGrades();
  const hasSample = gradeCuts.some((c) => c.isSample);

  return (
    <div className="space-y-3">
      {hasSample ? <SampleNotice>샘플 데이터입니다. 실제 등급컷이 아닙니다.</SampleNotice> : null}
      <GradeEstimator gradeCuts={gradeCuts} />
      <div className="border-border overflow-x-auto rounded-md border">
        <table className="w-full min-w-[20rem] text-sm tabular-nums">
          <caption className="sr-only">
            등급별 원점수 컷. 공식 자료와 기관별 예상 등급컷을 구분해 표시합니다.
          </caption>
          <thead>
            <tr className="border-border bg-muted border-b">
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                등급
              </th>
              {columns.map((source) => {
                const official = isOfficialGradeCutColumn(source);
                return (
                  <th
                    key={source}
                    scope="col"
                    className={cn(
                      "px-3 py-2 text-right font-semibold",
                      official ? "bg-primary-soft text-primary-strong" : "",
                    )}
                  >
                    <span className="flex flex-col items-end gap-0.5">
                      {official ? "공식 확정" : `${GRADE_CUT_SOURCE_LABELS[source]} 예상`}
                      <Badge variant={official ? "default" : "warning"}>
                        {official ? "공식" : "예상"}
                      </Badge>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grades.map((grade) => (
              <tr key={grade} className="border-border border-b last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-semibold">
                  {grade}등급
                </th>
                {columns.map((source) => {
                  const value = gradeCutValueLabel(gradeCuts, source, grade);
                  const official = source === "official";
                  const estimateColumn = gradeCuts.find((c) => c.source === source);
                  return (
                    <td
                      key={source}
                      className={cn(
                        "px-3 py-2 text-right",
                        official
                          ? "bg-primary-soft/60 font-bold"
                          : estimateColumn && isMutedEstimate(estimateColumn, gradeCuts)
                            ? "bg-muted/70 text-muted-foreground"
                            : "",
                      )}
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {gradeCuts.length === 0 ? (
        <p className="text-muted-foreground text-xs">현재 확인된 자료부터 표시하고 있습니다.</p>
      ) : null}
      <ul className="text-muted-foreground space-y-0.5 text-xs">
        {gradeCuts.map((c) => (
          <li key={c.source}>
            {GRADE_CUT_SOURCE_LABELS[c.source]}
            {c.isOfficial ? " (공식)" : " (예상)"}
            {c.isSample ? " · 샘플" : ""} · {formatKoreanDate(c.updatedAt)} 업데이트
            {c.sourceUrl ? (
              <>
                {" · "}
                <a
                  href={c.sourceUrl}
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  출처
                </a>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
