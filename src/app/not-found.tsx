import Link from "next/link";
import { ExamSearch } from "@/components/search/ExamSearch";
import { GRADES } from "@/lib/constants";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-12">
      <p className="text-primary text-sm font-semibold">404</p>
      <h1 className="mt-1 text-2xl font-bold">페이지를 찾을 수 없습니다</h1>
      <p className="text-muted-foreground mt-2">
        존재하지 않는 시험이거나, 해당 시험에서 제공하지 않는 과목입니다. 아래에서 다시 검색해
        보세요.
      </p>
      <ExamSearch className="mt-6" />
      <ul className="mt-4 flex flex-wrap gap-2">
        <li>
          <Link
            href="/"
            className="border-border hover:bg-muted inline-flex min-h-11 items-center rounded-md border px-3 font-semibold"
          >
            홈으로
          </Link>
        </li>
        {GRADES.map((g) => (
          <li key={g}>
            <Link
              href={`/grade/high${g}`}
              className="border-border hover:bg-muted inline-flex min-h-11 items-center rounded-md border px-3 font-semibold"
            >
              고{g} 모의고사
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
