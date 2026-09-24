import { getDb } from "@/db/client";
import { mappingData } from "@/lib/server/admin-queries";
import { formatKst, Panel, SmallButton } from "@/components/admin/ui";
import { remapAction } from "../../actions";
import { NoDatabase } from "../no-db";

export const dynamic = "force-dynamic";

export default async function MappingsPage() {
  const db = getDb();
  if (!db) return <NoDatabase />;
  const rows = await mappingData(db);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Source mapping</h1>
      <p className="text-muted-foreground text-sm">
        외부 source 의 시험이 어느 내부 시험에 연결됐는지 확인합니다. 잘못된 연결을 고치면
        고정(lock)되어 자동 수집이 되돌리지 않습니다.
      </p>
      <Panel title={`최근 ${rows.length}건`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border border-b text-left">
                <th className="py-1.5 pr-3">source</th>
                <th className="py-1.5 pr-3">원래 시험명</th>
                <th className="py-1.5 pr-3">내부 시험</th>
                <th className="py-1.5 pr-3">마지막 확인</th>
                <th className="py-1.5">수정</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ mapping, exam, source }) => (
                <tr key={mapping.id} className="border-border border-b align-top last:border-0">
                  <td className="py-1.5 pr-3">{source.name}</td>
                  <td className="py-1.5 pr-3">
                    {mapping.sourceTitle}
                    <span className="text-muted-foreground block text-xs">
                      {mapping.externalId}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 font-semibold">
                    {exam.year} 고{exam.grade} {exam.month}월 ({exam.examType})
                    {mapping.mappingLocked ? (
                      <span className="text-warning-strong ml-1 text-xs">고정</span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-3 text-xs">{formatKst(mapping.lastSeenAt)}</td>
                  <td className="py-1.5">
                    <form action={remapAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={mapping.id} />
                      <label className="sr-only" htmlFor={`y-${mapping.id}`}>
                        연도
                      </label>
                      <input
                        id={`y-${mapping.id}`}
                        name="year"
                        defaultValue={exam.year}
                        className="border-border h-9 w-16 rounded border px-1"
                        inputMode="numeric"
                      />
                      <label className="sr-only" htmlFor={`g-${mapping.id}`}>
                        학년
                      </label>
                      <input
                        id={`g-${mapping.id}`}
                        name="grade"
                        defaultValue={exam.grade}
                        className="border-border h-9 w-10 rounded border px-1"
                        inputMode="numeric"
                      />
                      <label className="sr-only" htmlFor={`m-${mapping.id}`}>
                        월
                      </label>
                      <input
                        id={`m-${mapping.id}`}
                        name="month"
                        defaultValue={exam.month}
                        className="border-border h-9 w-10 rounded border px-1"
                        inputMode="numeric"
                      />
                      <SmallButton>이동</SmallButton>
                    </form>
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
