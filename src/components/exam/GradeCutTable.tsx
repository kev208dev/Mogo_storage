import { SampleNotice } from "@/components/layout/SampleNotice";
import { Badge } from "@/components/ui/badge";
import { GRADE_CUT_SOURCE_LABELS, type Subject } from "@/lib/constants";
import { isMutedEstimate, orderGradeCutColumns } from "@/lib/grade-cuts";
import { absoluteGradeCuts } from "@/lib/grade-cut-mode";
import type { Exam, GradeCut } from "@/lib/data/types";
import { cn, formatKoreanDate } from "@/lib/utils";
import { GradeEstimator } from "./GradeEstimator";

/**
 * 등급컷 표. 공식 자료와 예상 등급컷(메가스터디/대성/EBS)을 시각적으로 구분하고,
 * 예상치에는 반드시 "예상" 표시를 붙인다.
 */
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
  if (gradeCuts.length === 0) {
    return <p className="text-muted-foreground text-sm">등급컷 자료 준비 중입니다.</p>;
  }
  const columns = orderGradeCutColumns(gradeCuts);
  const grades = [...new Set(columns.flatMap((c) => c.cuts.map((x) => x.grade)))].sort(
    (a, b) => a - b,
  );
  const hasSample = columns.some((c) => c.isSample);

  return (
    <div className="space-y-3">
      {hasSample ? <SampleNotice>샘플 데이터입니다. 실제 등급컷이 아닙니다.</SampleNotice> : null}
      <GradeEstimator gradeCuts={columns} />
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
              {columns.map((c) => (
                <th
                  key={c.source}
                  scope="col"
                  className={cn(
                    "px-3 py-2 text-right font-semibold",
                    c.isOfficial
                      ? "bg-primary-soft text-primary-strong"
                      : isMutedEstimate(c, columns)
                        ? "bg-muted text-muted-foreground"
                        : "",
                  )}
                >
                  <span className="flex flex-col items-end gap-0.5">
                    {c.isOfficial ? "공식 확정" : `${GRADE_CUT_SOURCE_LABELS[c.source]} 예상`}
                    {c.isOfficial ? (
                      <Badge variant="default">공식</Badge>
                    ) : (
                      <Badge variant="warning">예상</Badge>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grades.map((grade) => (
              <tr key={grade} className="border-border border-b last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-semibold">
                  {grade}등급
                </th>
                {columns.map((c) => {
                  const value = c.cuts.find((x) => x.grade === grade)?.rawScore;
                  return (
                    <td
                      key={c.source}
                      className={cn(
                        "px-3 py-2 text-right",
                        c.isOfficial
                          ? "bg-primary-soft/60 font-bold"
                          : isMutedEstimate(c, columns)
                            ? "bg-muted/70 text-muted-foreground"
                            : "",
                      )}
                    >
                      {value ?? "-"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="text-muted-foreground space-y-0.5 text-xs">
        {columns.map((c) => (
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
