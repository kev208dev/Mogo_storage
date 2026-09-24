import { CHOICE_SYMBOLS } from "@/lib/constants";
import type { QuestionStatistic } from "@/lib/data/types";
import { cn, formatKoreanDate } from "@/lib/utils";

/** 문항 정답률 + 선택지 분포 막대 (색만으로 구분하지 않도록 수치/라벨 병기) */
export function QuestionStatistics({
  statistic,
  answer,
}: {
  statistic: QuestionStatistic;
  answer: string;
}) {
  const correctIndex = Number(answer) - 1;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        정답률 <strong className="tabular-nums">{Math.round(statistic.correctRate)}%</strong>
      </p>
      {statistic.answerDistribution ? (
        <ul className="space-y-1" aria-label="선택지별 선택 비율">
          {statistic.answerDistribution.map((rate, index) => {
            const isAnswer = index === correctIndex;
            return (
              <li key={index} className="flex items-center gap-2 text-sm">
                <span className="w-5 text-center">{CHOICE_SYMBOLS[index]}</span>
                <span
                  className="bg-muted relative h-3 flex-1 overflow-hidden rounded-sm"
                  aria-hidden
                >
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-sm",
                      isAnswer ? "bg-primary" : "bg-muted-foreground/40",
                    )}
                    style={{ width: `${Math.min(100, Math.max(0, rate))}%` }}
                  />
                </span>
                <span className={cn("w-16 text-right tabular-nums", isAnswer && "font-bold")}>
                  {rate}%{isAnswer ? " 정답" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="text-muted-foreground text-xs">
        출처:{" "}
        {statistic.statisticsSourceUrl ? (
          <a
            href={statistic.statisticsSourceUrl}
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {statistic.statisticsSource}
          </a>
        ) : (
          statistic.statisticsSource
        )}{" "}
        · {formatKoreanDate(statistic.statisticsUpdatedAt)} 기준
      </p>
    </div>
  );
}
