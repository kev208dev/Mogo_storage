import Link from "next/link";
import { SampleNotice } from "@/components/layout/SampleNotice";
import { Badge } from "@/components/ui/badge";
import { GRADE_CUT_SOURCE_LABELS, type Subject } from "@/lib/constants";
import {
  GRADE_CUT_STATUS_LABELS,
  gradeCutColumnTitle,
  gradeCutStatusKind,
  gradeCutTableColumns,
  gradeCutTableGrades,
  gradeCutValueLabel,
  gradeCutValuesDiffer,
} from "@/lib/grade-cut-table";
import { isMutedEstimate } from "@/lib/grade-cuts";
import { absoluteGradeCuts } from "@/lib/grade-cut-mode";
import type { Exam, GradeCut } from "@/lib/data/types";
import { cn, formatKstDateTime } from "@/lib/utils";
import { GradeEstimator } from "./GradeEstimator";

/** 공식 결과와 지원 중인 기관별 예상 등급컷을 구분해 표시한다. */
export function GradeCutTable({
  gradeCuts,
  subject,
  exam,
  courseCuts,
}: {
  gradeCuts: GradeCut[];
  subject: Subject;
  exam: Exam;
  /** 영역 페이지: 세부과목별 등급컷 출처 (값은 세부과목 페이지에서) */
  courseCuts?: Array<{ name: string; href: string; providers: string[] }>;
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

  if (gradeCuts.length === 0)
    return (
      <div className="space-y-3" data-testid="grade-cuts-empty">
        {courseCuts && courseCuts.some((c) => c.providers.length > 0) ? (
          <div data-testid="course-grade-cuts">
            <p className="text-sm font-semibold">세부과목별 등급컷 있음</p>
            <p className="text-muted-foreground text-xs">
              선택과목마다 등급컷이 다릅니다. 과목을 선택해 출처별 값을 확인하세요.
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {courseCuts
                .filter((c) => c.providers.length > 0)
                .map((c) => (
                  <li key={c.href}>
                    <Link
                      href={c.href}
                      className="border-border hover:border-primary inline-flex min-h-10 items-center rounded-full border px-3 text-sm font-semibold"
                    >
                      {c.name}
                      <span className="text-muted-foreground ml-1 text-xs font-normal">
                        {c.providers.join("·")}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">아직 확인된 등급컷이 없습니다.</p>
        )}
        <OfficialNote />
      </div>
    );

  const columns = gradeCutTableColumns(gradeCuts);
  const grades = gradeCutTableGrades();
  const hasSample = gradeCuts.some((c) => c.isSample);
  const hasOfficial = gradeCuts.some((c) => c.isOfficial);
  const byColumn = (source: GradeCut["source"]) => gradeCuts.find((c) => c.source === source);

  return (
    <div className="space-y-3">
      {hasSample ? <SampleNotice>샘플 데이터입니다. 실제 등급컷이 아닙니다.</SampleNotice> : null}
      <GradeEstimator gradeCuts={gradeCuts} />
      {hasOfficial ? null : <OfficialNote />}
      <div className="border-border overflow-x-auto rounded-md border">
        <table className="w-full min-w-[20rem] text-sm tabular-nums">
          <caption className="sr-only">
            등급별 컷. 출처마다 값을 따로 보여주며 평균내거나 고치지 않습니다.
          </caption>
          <thead>
            <tr className="border-border bg-muted border-b">
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                등급
              </th>
              {columns.map((source) => {
                const cut = byColumn(source);
                const kind = cut ? gradeCutStatusKind(cut) : "estimate";
                return (
                  <th
                    key={source}
                    scope="col"
                    data-source={source}
                    data-status={kind}
                    className={cn(
                      "px-3 py-2 text-right font-semibold",
                      kind === "official" ? "bg-primary-soft text-primary-strong" : "",
                    )}
                  >
                    <span className="flex flex-col items-end gap-0.5">
                      {gradeCutColumnTitle(cut, source)}
                      <Badge variant={STATUS_VARIANT[kind]}>{GRADE_CUT_STATUS_LABELS[kind]}</Badge>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grades.map((grade) => {
              const differ = columns.length > 1 && gradeCutValuesDiffer(gradeCuts, grade);
              return (
                <tr key={grade} className="border-border border-b last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-semibold">
                    {grade}등급
                    {differ ? (
                      <span className="text-warning-strong ml-1 text-[11px] font-normal">
                        출처별 상이
                      </span>
                    ) : null}
                  </th>
                  {columns.map((source) => {
                    const cut = byColumn(source);
                    const official = cut?.isOfficial ?? false;
                    return (
                      <td
                        key={source}
                        className={cn(
                          "px-3 py-2 text-right",
                          official
                            ? "bg-primary-soft/60 font-bold"
                            : cut && isMutedEstimate(cut, gradeCuts)
                              ? "bg-muted/70 text-muted-foreground"
                              : "",
                        )}
                      >
                        {gradeCutValueLabel(gradeCuts, source, grade)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="border-border rounded-md border px-3 py-2 text-xs" open>
        <summary className="cursor-pointer text-sm font-semibold">출처 · 상태 · 확인 시각</summary>
        <ul className="mt-2 space-y-2" data-testid="grade-cut-provenance">
          {columns.map((source) => {
            const c = byColumn(source)!;
            const kind = gradeCutStatusKind(c);
            const via =
              c.observedVia && c.observedVia !== c.source
                ? `${GRADE_CUT_SOURCE_LABELS[c.observedVia]} 경유`
                : c.firstParty === false
                  ? "2차 출처"
                  : "원 출처 직접 확인";
            return (
              <li key={source} data-source={source} data-status={kind}>
                <p className="font-semibold">
                  {GRADE_CUT_SOURCE_LABELS[c.source]}
                  {c.providerLabel && c.providerLabel !== GRADE_CUT_SOURCE_LABELS[c.source]
                    ? ` · 표기 "${c.providerLabel}"`
                    : ""}{" "}
                  <Badge variant={STATUS_VARIANT[kind]}>{GRADE_CUT_STATUS_LABELS[kind]}</Badge>
                  {c.isSample ? (
                    <Badge variant="neutral" className="ml-1">
                      샘플
                    </Badge>
                  ) : null}
                </p>
                <p className="text-muted-foreground">
                  {c.scoreBasis === "standard" ? "표준점수 기준" : "원점수 기준"} · {via} ·{" "}
                  <time dateTime={c.updatedAt}>{formatKstDateTime(c.updatedAt)}</time> 값 확인
                  {c.sourceUrl ? (
                    <>
                      {" · "}
                      <a
                        href={c.sourceUrl}
                        className="underline"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${GRADE_CUT_SOURCE_LABELS[c.source]} 등급컷 출처 (새 창)`}
                      >
                        출처 보기
                      </a>
                    </>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground mt-2">
          기관마다 값이 다를 수 있습니다. 평균을 내거나 고치지 않고 발표된 값(소수점·범위 포함)을
          그대로 보여줍니다. 업체가 &ldquo;최종&rdquo;으로 표기한 값도 공식 발표가 아닙니다.
        </p>
      </details>
    </div>
  );
}

const STATUS_VARIANT = {
  official: "default",
  provider_final: "outline",
  estimate: "warning",
} as const;

function OfficialNote() {
  return (
    <p className="text-muted-foreground text-xs" data-testid="official-grade-cut-note">
      <strong className="font-semibold">공식 원점수 등급컷 미제공</strong> · 시행기관이 원점수
      등급컷을 공개하지 않았거나 공식 자료로 아직 확인하지 못했습니다. 아래 값은 공식 발표가
      아닙니다.
    </p>
  );
}
