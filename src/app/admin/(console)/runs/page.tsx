import { getDb } from "@/db/client";
import { runsData } from "@/lib/server/admin-queries";
import { formatKst, Panel } from "@/components/admin/ui";
import { NoDatabase } from "../no-db";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const db = getDb();
  if (!db) return <NoDatabase />;
  const { runs, errors } = await runsData(db);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">실행 기록</h1>
      <Panel title="최근 수집 실행">
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-border border-b text-left">
                {[
                  "시작",
                  "source",
                  "mode",
                  "상태",
                  "발견",
                  "생성",
                  "변경",
                  "실패",
                  "오류 요약",
                ].map((h) => (
                  <th key={h} className="py-1.5 pr-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-border border-b align-top last:border-0">
                  <td className="py-1.5 pr-3">{formatKst(r.startedAt)}</td>
                  <td className="py-1.5 pr-3">{r.sourceId}</td>
                  <td className="py-1.5 pr-3">{r.mode}</td>
                  <td className="py-1.5 pr-3 font-semibold">{r.status}</td>
                  <td className="py-1.5 pr-3">{r.discoveredCount}</td>
                  <td className="py-1.5 pr-3">{r.createdCount}</td>
                  <td className="py-1.5 pr-3">{r.updatedCount}</td>
                  <td className="py-1.5 pr-3">{r.failedCount}</td>
                  <td className="text-danger-strong py-1.5 text-xs whitespace-pre-line">
                    {r.errorSummary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="최근 오류">
        <ul className="divide-border divide-y text-sm">
          {errors.map((e) => (
            <li key={e.id} className="py-1.5">
              <span className="font-mono text-xs">{e.code}</span> · {e.sourceId} ·{" "}
              {formatKst(e.createdAt)}
              {e.resolvedAt ? " · 확인됨" : ""}
              <span className="text-muted-foreground block text-xs">
                {e.message}
                {e.url ? ` (${e.url})` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
