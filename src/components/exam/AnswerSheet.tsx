import { ChevronDownIcon } from "lucide-react";
import type { Question } from "@/lib/data/types";
import { formatAnswer } from "./answer-format";

/**
 * 정답 바로 보기. 기본은 접힘. <details> 기반이라 JS 없이 동작한다.
 */
export function AnswerSheet({ questions }: { questions: Question[] }) {
  return (
    <details className="group border-border rounded-md border">
      <summary className="hover:bg-muted focus-visible:ring-ring/60 flex min-h-12 cursor-pointer items-center justify-between gap-2 rounded-md px-3 font-bold focus-visible:ring-[3px] focus-visible:outline-none">
        <span>
          <span className="group-open:hidden">정답 보기</span>
          <span className="hidden group-open:inline">정답 숨기기</span>
          <span className="text-muted-foreground ml-2 text-xs font-normal">
            {questions.length}문항
          </span>
        </span>
        <ChevronDownIcon
          className="size-5 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <ol
        className="border-border bg-border grid grid-cols-5 gap-px border-t sm:grid-cols-10"
        aria-label="문항별 정답"
      >
        {questions.map((q) => (
          <li key={q.id} className="bg-background flex items-baseline justify-center gap-1.5 py-2">
            <span className="text-muted-foreground text-xs tabular-nums">{q.questionNumber}</span>
            <span className="font-bold tabular-nums">
              <span className="sr-only">번 정답 </span>
              {formatAnswer(q.answer, q.choiceCount)}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
