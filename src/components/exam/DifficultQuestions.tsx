import { DIFFICULT_RATE_THRESHOLD } from "@/lib/constants";
import type { QuestionWithStats } from "@/lib/data/types";

/** 정답률 낮은 문항 요약 (서버 컴포넌트). 누르면 문항 해설로 이동한다. */
export function DifficultQuestions({
  questions,
  limit = 5,
}: {
  questions: QuestionWithStats[];
  limit?: number;
}) {
  const hardest = questions
    .filter((q) => q.statistic && q.statistic.correctRate <= DIFFICULT_RATE_THRESHOLD)
    .sort((a, b) => a.statistic!.correctRate - b.statistic!.correctRate)
    .slice(0, limit);
  if (hardest.length === 0) return null;
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-bold">정답률 낮은 문제</h3>
      <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        {hardest.map((q) => (
          <li key={q.id}>
            <a
              href={`#q-${q.questionNumber}`}
              className="border-border hover:border-primary flex min-h-12 flex-col justify-center rounded-md border px-3 py-1.5"
            >
              <span className="font-bold">{q.questionNumber}번</span>
              <span className="text-danger-strong text-xs tabular-nums">
                정답률 {Math.round(q.statistic!.correctRate)}%
              </span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
