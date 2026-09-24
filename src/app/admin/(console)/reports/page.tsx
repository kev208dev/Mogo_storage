import { getDb } from "@/db/client";
import { REPORT_CATEGORY_LABELS, REPORT_STATUSES, SUBJECT_LABELS } from "@/lib/constants";
import { reportsData } from "@/lib/server/admin-queries";
import { formatKst, Panel, SmallButton } from "@/components/admin/ui";
import { reportStatusAction } from "../../actions";
import { NoDatabase } from "../no-db";

export const dynamic = "force-dynamic";

const STATUS_LABEL = {
  pending: "접수",
  reviewing: "확인 중",
  resolved: "해결",
  dismissed: "기각",
} as const;

export default async function ReportsPage() {
  const db = getDb();
  if (!db) return <NoDatabase />;
  const rows = await reportsData(db);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">오류 신고</h1>
      <Panel title={`최근 ${rows.length}건`}>
        <ul className="divide-border divide-y text-sm">
          {rows.length === 0 ? <li className="text-muted-foreground">신고가 없습니다.</li> : null}
          {rows.map(({ report, exam }) => (
            <li key={report.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-semibold">
                {exam.year} 고{exam.grade} {exam.month}월{" "}
                {report.subject ? SUBJECT_LABELS[report.subject] : ""}
              </span>
              <span>{REPORT_CATEGORY_LABELS[report.category]}</span>
              <span className="text-muted-foreground text-xs">{formatKst(report.createdAt)}</span>
              {report.message ? (
                <span className="text-muted-foreground w-full">{report.message}</span>
              ) : null}
              <form action={reportStatusAction} className="ml-auto flex items-center gap-1">
                <input type="hidden" name="id" value={report.id} />
                <label className="sr-only" htmlFor={`st-${report.id}`}>
                  상태
                </label>
                <select
                  id={`st-${report.id}`}
                  name="status"
                  defaultValue={report.status}
                  className="border-border h-9 rounded border px-1 text-sm"
                >
                  {REPORT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <SmallButton>변경</SmallButton>
              </form>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
