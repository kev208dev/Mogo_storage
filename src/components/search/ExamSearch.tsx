import { SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** 자유 검색창 ("25 고2 9모" 등). GET /search?q= 로 제출된다. */
export function ExamSearch({
  defaultQuery,
  className,
  autoFocus,
}: {
  defaultQuery?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <form action="/search" method="get" role="search" className={cn("relative", className)}>
      <label htmlFor="exam-search-q" className="sr-only">
        모의고사 검색
      </label>
      <input
        id="exam-search-q"
        name="q"
        type="search"
        defaultValue={defaultQuery}
        placeholder="예: 25 고2 9모, 2024년 고3 6월"
        autoComplete="off"
        enterKeyHint="search"
        autoFocus={autoFocus}
        className="border-border bg-background placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-ring/40 h-12 w-full rounded-md border pr-14 pl-3 text-base outline-none focus-visible:ring-[3px]"
      />
      <button
        type="submit"
        aria-label="검색"
        className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/60 absolute top-0.5 right-0.5 inline-flex size-11 items-center justify-center rounded-md focus-visible:ring-[3px] focus-visible:outline-none"
      >
        <SearchIcon className="size-5" aria-hidden />
      </button>
    </form>
  );
}
