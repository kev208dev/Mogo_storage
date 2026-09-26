import Link from "next/link";
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
  const db = getDb();
  if (!db) return <NoDatabase />;
  const params = await searchParams;
  const year = intParam(params.year);
  const grade = intParam(params.grade);
  const page = intParam(params.page) ?? 1;
  const coverage = await computeFeatureCoverage(db, {
    year,
    grade: grade && grade <= 3 ? (grade as Grade) : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(coverage.total / PAGE_SIZE));
  const href = (p: number) =>
    `/admin/coverage?${new URLSearchParams({
      ...(year ? { year: String(year) } : {}),
      ...(grade ? { grade: String(grade) } : {}),
      page: String(p),
    })}`;

  return (
    <div className="space-y-4" data-testid="feature-coverage">
      <h1 className="text-xl font-bold">기능 coverage</h1>
      <p className="text-muted-foreground text-sm">
        시험별로 시험지·해설, 정답·채점, 등급컷, 영어 듣기·단어장이 어디까지 채워졌는지 보여줍니다.
        &ldquo;정책상 수동&rdquo;은 robots.txt 등으로 자동 수집하지 않는 항목입니다. 합계는 현재 쪽 기준입니다.
      </p>
      <form className="flex flex-wrap items-end gap-2 text-sm" action="/admin/coverage">
        <label className="flex flex-col">
          시행 연도
          <input name="year" defaultValue={year ?? ""} inputMode="numeric" className="border-border w-24 rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col">
          학년
          <select name="grade" defaultValue={grade ?? ""} className="border-border rounded border px-2 py-1">
            <option value="">전체</option>
            <option value="1">고1</option>
            <option value="2">고2</option>
            <option value="3">고3</option>
          </select>
        </label>
        <button className="bg-muted rounded px-3 py-1 font-semibold">보기</button>
      </form>

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
                      <span className="text-muted-foreground block text-xs">{r.features[f].detail}</span>
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
