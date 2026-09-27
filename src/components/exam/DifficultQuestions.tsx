import type { QuestionWithStats } from "@/lib/data/types";

/**
 * 많이 틀린 문제 TOP N (서버 컴포넌트). 누르면 문항 해설로 이동한다.
 * 출처(statisticsSource)가 기록된 통계만 쓴다. 통계가 없으면 %를 만들지 않고 "통계 데이터 없음".
 */
export function DifficultQuestions({
  questions,
  limit = 5,
}: {
  questions: QuestionWithStats[];
  limit?: number;
}) {
  const withStats = questions.filter(
    (q) => q.statistic && q.statistic.statisticsSource && Number.isFinite(q.statistic.correctRate),
  );
  const hardest = [...withStats]
    .sort((a, b) => a.statistic!.correctRate - b.statistic!.correctRate)
    .slice(0, limit);
  const sources = [...new Set(hardest.map((q) => q.statistic!.statisticsSource))];
  return (
    <div className="mb-4" data-testid="most-missed">
      <h3 className="mb-2 text-sm font-bold">많이 틀린 문제 TOP {limit}</h3>
      {hardest.length === 0 ? (
        <p className="text-muted-foreground text-sm">통계 데이터 없음</p>
      ) : (
        <>
          <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
            {hardest.map((q, i) => (
              <li key={q.id}>
                <a
                  href={`#q-${q.questionNumber}`}
                  className="border-border hover:border-primary flex min-h-12 flex-col justify-center rounded-md border px-3 py-1.5"
                >
                  <span className="font-bold">
                    <span className="text-muted-foreground mr-1 text-xs">{i + 1}위</span>
                    {q.questionNumber}번
                  </span>
                  <span className="text-danger-strong text-xs tabular-nums">
                    오답률 {Math.round(100 - q.statistic!.correctRate)}%
                  </span>
                </a>
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground mt-1.5 text-xs">출처: {sources.join(", ")}</p>
        </>
      )}
    </div>
  );
}
