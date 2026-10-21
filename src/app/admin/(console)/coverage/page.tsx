import Link from "next/link";
import { ExamFilter } from "@/components/admin/ExamFilter";
import { adminExamFilter, matchesExam } from "@/lib/admin-exam-filter";
import { adminCoverageDetails } from "@/lib/server/admin-coverage";
import { cutLabel } from "@/lib/admin-coverage-model";
import { FILE_TYPE_LABELS, GRADE_CUT_SOURCE_LABELS, type FileType } from "@/lib/constants";
import { requireAdmin } from "@/lib/server/admin-session";
import { getDb } from "@/db/client";
import { Panel } from "@/components/admin/ui";
import {
  computeFeatureCoverage,
  FEATURE_LABELS,
  FEATURE_STATUSES,
  FEATURES,
  STATUS_LABELS,
  type FeatureStatus,
} from "@/ingestion/feature-coverage";
import type { Grade } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { NoDatabase } from "../no-db";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const TONE: Record<FeatureStatus, string> = {
  complete: "text-success-strong",
  partial: "text-warning-strong",
  manual_review: "text-warning-strong",
  missing: "text-danger-strong",
  blocked_policy: "text-muted-foreground",
  not_applicable: "text-muted-foreground",
};

function intParam(value: string | string[] | undefined): number | undefined {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export default async function CoveragePage({ searchParams }: PageProps<"/admin/coverage">) {
  await requireAdmin();
  const db = getDb();
  if (!db) return <NoDatabase />;
  const params = await searchParams;
  const filter = adminExamFilter(params);
  const { year, grade, month } = filter;
  const page = intParam(params.page) ?? 1;
  const all = await computeFeatureCoverage(db, { year, grade: grade as Grade | undefined });
  const filtered = all.rows.filter((r) => matchesExam(r, filter));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const coverage = {
    ...all,
    total: filtered.length,
    rows,
    summary: Object.fromEntries(
      FEATURES.map((f) => [
        f,
        Object.fromEntries(
          FEATURE_STATUSES.map((s) => [s, rows.filter((r) => r.features[f].status === s).length]),
        ),
      ]),
    ) as typeof all.summary,
  };
  const details = await adminCoverageDetails(
    db,
    rows.map((r) => r.examId),
  );
  const pages = Math.max(1, Math.ceil(coverage.total / PAGE_SIZE));
  const href = (p: number) =>
    `/admin/coverage?${new URLSearchParams({
      ...(year ? { year: String(year) } : {}),
      ...(grade ? { grade: String(grade) } : {}),
      ...(month ? { month: String(month) } : {}),
      page: String(p),
    })}`;

  return (
    <div className="space-y-4" data-testid="feature-coverage">
      <h1 className="text-xl font-bold">기능 coverage</h1>
      <p className="text-muted-foreground text-sm">
        시험별로 시험지·해설, 정답·채점, 등급컷, 영어 듣기·단어장이 어디까지 채워졌는지 보여줍니다.
        &ldquo;정책상 수동&rdquo;은 robots.txt 등으로 자동 수집하지 않는 항목입니다. 합계는 현재 쪽
        기준입니다.
      </p>
      <ExamFilter path="/admin/coverage" filter={filter} />
      <p className="text-muted-foreground text-sm">
        현재 연결된 DB 기준 · 샘플 제외. Production 여부는 이 화면에서 판정하지 않습니다. 대상일:
        2026-10-20 (실제 일정 확인 상태는 아래 표시).
      </p>
      {rows.length === 0 ? (
        <p role="status">
          선택한 시험의 실자료가 없습니다. 일정과 과목 편성 등록 여부를 확인하세요. 자료가 없다는
          사실만으로 원문 미공개라고 판정하지 않습니다.
        </p>
      ) : null}
      {details.map(({ exam, schedule, pending, cuts, slots }) => (
        <Panel key={exam.id} title={`${exam.year} 고${exam.grade} ${exam.month}월 · 과목별 자료`}>
          <p className="text-sm">
            일정: {schedule?.verifiedAt ? "확인됨" : "미확인"} ·{" "}
            {schedule?.examDate ?? exam.examDate ?? "날짜 미등록"} ·{" "}
            {schedule?.status ?? "일정 미등록"}
          </p>
          <Link
            className="text-primary text-sm underline"
            href={`/admin/imports?year=${exam.year}&month=${exam.month}&grade=${exam.grade}`}
          >
            공식 URL 검토 대기 {pending}건 · 등록/승인
          </Link>
          <p className="my-2 text-sm">
            등급컷:{" "}
            {cuts.length
              ? [
                  ...new Set(
                    cuts.map((c) => `${GRADE_CUT_SOURCE_LABELS[c.source]} — ${cutLabel(c)}`),
                  ),
                ].join(" / ")
              : "제공 자료 없음"}
          </p>
          {!slots.length ? (
            <p>과목 편성 정보 없음 · 누락 개수를 계산할 수 없습니다.</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {slots.map((slot) => (
                <li
                  className="border-border rounded border p-3"
                  key={`${slot.subject}:${slot.courseId}`}
                >
                  <h3 className="font-semibold">{slot.name}</h3>
                  {slot.materials.map((m) => (
                    <p key={m.type} className="mt-1 text-sm" data-status={m.status}>
                      <span className={TONE[m.status]}>
                        {FILE_TYPE_LABELS[m.type as FileType]} · {STATUS_LABELS[m.status]}
                      </span>
                      <span className="text-muted-foreground block text-xs">{m.detail}</span>
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ))}

      <Panel title="기능별 합계 (현재 쪽)">
        <table className="w-full text-sm tabular-nums">
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f} className="border-border border-b last:border-0" data-feature={f}>
                <th className="py-1 pr-3 text-left">{FEATURE_LABELS[f]}</th>
                <td className="py-1">
                  {FEATURE_STATUSES.filter((s) => coverage.summary[f][s]).map((s) => (
                    <span key={s} className={cn("mr-3", TONE[s])}>
                      {STATUS_LABELS[s]} {coverage.summary[f][s]}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title={`시험 ${coverage.total}개 · ${page}/${pages}쪽`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-border border-b text-left">
                <th className="py-1.5 pr-3">시험</th>
                {FEATURES.map((f) => (
                  <th key={f} className="py-1.5 pr-3">
                    {FEATURE_LABELS[f]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {coverage.rows.map((r) => (
                <tr key={r.examId} className="border-border border-b align-top last:border-0">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {r.year} 고{r.grade} {r.month}월
                  </td>
                  {FEATURES.map((f) => (
                    <td key={f} className="py-1.5 pr-3" data-status={r.features[f].status}>
                      <span className={cn("font-semibold", TONE[r.features[f].status])}>
                        {STATUS_LABELS[r.features[f].status]}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {r.features[f].detail}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <nav aria-label="쪽 이동" className="mt-3 flex gap-2 text-sm">
            {page > 1 ? <Link href={href(page - 1)}>← 이전</Link> : null}
            {page < pages ? <Link href={href(page + 1)}>다음 →</Link> : null}
          </nav>
        ) : null}
      </Panel>
    </div>
  );
}
