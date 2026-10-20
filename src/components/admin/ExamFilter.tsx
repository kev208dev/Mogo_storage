import Link from "next/link";
import { GRADES } from "@/lib/constants";
import type { AdminExamFilter } from "@/lib/admin-exam-filter";

export function ExamFilter({ path, filter }: { path: string; filter: AdminExamFilter }) {
  return (
    <div className="space-y-3">
      <nav aria-label="10월 모의고사 빠른 선택" className="flex flex-wrap gap-3 text-sm">
        <Link href={`${path}?year=2026&month=10`}>2026년 10모 전체</Link>
        {GRADES.map((grade) => (
          <Link key={grade} href={`${path}?year=2026&month=10&grade=${grade}`}>
            10모 고{grade}
          </Link>
        ))}
        <Link href={path}>필터 초기화</Link>
      </nav>
      <form action={path} className="flex flex-wrap items-end gap-3 text-sm">
        <label>
          시행 연도
          <input
            className="border-border ml-2 w-24 rounded border p-2"
            type="number"
            name="year"
            min="2000"
            max="2100"
            defaultValue={filter.year ?? ""}
          />
        </label>
        <label>
          월
          <input
            className="border-border ml-2 w-20 rounded border p-2"
            type="number"
            name="month"
            min="1"
            max="12"
            defaultValue={filter.month ?? ""}
          />
        </label>
        <label>
          학년
          <select
            className="border-border ml-2 rounded border p-2"
            name="grade"
            defaultValue={filter.grade ?? ""}
          >
            <option value="">전체</option>
            {GRADES.map((grade) => (
              <option key={grade} value={grade}>
                고{grade}
              </option>
            ))}
          </select>
        </label>
        <button className="bg-muted min-h-11 rounded px-4">보기</button>
      </form>
    </div>
  );
}
