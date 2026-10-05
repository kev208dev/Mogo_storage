import { desc } from "drizzle-orm";
import { Panel, formatKst } from "@/components/admin/ui";
import { getDb } from "@/db/client";
import { examSchedules } from "@/db/schema";
import { EXAM_TYPE_LABELS } from "@/lib/constants";
import { NoDatabase } from "../no-db";

export const dynamic = "force-dynamic";

const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/**
 * 시험 일정 현황 (읽기 전용). 일정은 공식 공지 URL 과 함께 data/schedules/*.json → ingest:schedules
 * (또는 Exam schedules workflow) 로만 등록한다. 시험일 기준 작업(release watch · 등급컷 감시)은 exams.exam_date 를 쓴다.
 */
export default async function SchedulesAdminPage() {
  const db = getDb();
  if (!db) return <NoDatabase />;
  const rows = await db
    .select()
    .from(examSchedules)
    .orderBy(desc(examSchedules.examDate), examSchedules.grade)
    .limit(120);
  const today = kstToday();
  const upcoming = rows.filter((r) => r.examDate >= today && r.status !== "cancelled");

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        공식 공지(교육청 · 평가원 · 교육부 https URL)로 확인된 일정만 등록합니다. 학원 · 언론 기사의
        날짜는 근거로 쓰지 않습니다. 등록 · 변경 · 취소는{" "}
        <code>npm run ingest:schedules -- --file=… --dry-run</code> 으로 먼저 확인하세요.
      </p>
      {upcoming.length === 0 ? (
        <p
          className="bg-warning-soft text-warning-strong rounded-md px-3 py-2 text-sm font-semibold"
          data-testid="no-upcoming-schedule"
        >
          오늘({today}) 이후 확인된 시험 일정이 없습니다. 다음 시험의 공식 공지를 확인해 등록하세요
          — 일정이 없으면 시험일 기준 자동 작업이 시작되지 않습니다.
        </p>
      ) : null}
      <Panel title={`시험 일정 (${rows.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-xs">
            <thead>
              <tr className="border-border border-b text-left">
                <th className="px-2 py-1.5">시험</th>
                <th className="px-2 py-1.5">시행일</th>
                <th className="px-2 py-1.5">상태</th>
                <th className="px-2 py-1.5">확인</th>
                <th className="px-2 py-1.5">변경 이력</th>
                <th className="px-2 py-1.5">근거</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-border border-b last:border-0">
                  <td className="px-2 py-1.5 font-semibold">
                    {r.year} 고{r.grade} {r.month}월 {EXAM_TYPE_LABELS[r.examType]}
                    {r.isSample ? " (샘플)" : ""}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{r.examDate}</td>
                  <td className="px-2 py-1.5">
                    {r.status}
                    {r.cancelledReason ? ` · ${r.cancelledReason}` : ""}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.verifiedBy ? `${r.verifiedBy} · ${formatKst(r.verifiedAt)}` : "기록 없음"}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.previousExamDate
                      ? `${r.previousExamDate} → ${r.examDate}${r.changeNote ? ` (${r.changeNote})` : ""}`
                      : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.announcementUrl ? (
                      <a
                        href={r.announcementUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        공식 공지
                      </a>
                    ) : (
                      "없음"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
