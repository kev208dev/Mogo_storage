import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { GRADES, MONTHS } from "@/lib/constants";

/**
 * 년도/학년/월 선택 → /search 로 GET 제출 → 서버가 /exam/{year}/high{grade}/{month} 로 redirect.
 * JS 없이 동작하는 순수 form (Server Component).
 */
export function ExamFinder({
  years,
  defaultValue,
}: {
  years: number[];
  defaultValue: { year: number; grade: number; month: number };
}) {
  // 등록된 시험이 없어도 선택 UI 가 비지 않도록 기본값 년도를 포함한다.
  const yearOptions = years.length ? years : [defaultValue.year];
  return (
    <form action="/search" method="get" aria-label="모의고사 찾기" className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label htmlFor="finder-year" className="sr-only">
            년도
          </label>
          <NativeSelect id="finder-year" name="year" defaultValue={defaultValue.year}>
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}년
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor="finder-grade" className="sr-only">
            학년
          </label>
          <NativeSelect id="finder-grade" name="grade" defaultValue={defaultValue.grade}>
            {GRADES.map((grade) => (
              <option key={grade} value={grade}>
                고{grade}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor="finder-month" className="sr-only">
            월
          </label>
          <NativeSelect id="finder-month" name="month" defaultValue={defaultValue.month}>
            {MONTHS.map((month) => (
              <option key={month} value={month}>
                {month}월
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <Button type="submit" size="lg" className="w-full">
        <SearchIcon aria-hidden />
        모의고사 찾기
      </Button>
    </form>
  );
}
