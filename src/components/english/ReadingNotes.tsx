import { Badge } from "@/components/ui/badge";
import { ORIGIN_BADGES, type ReadingNote } from "@/lib/study";

/**
 * 독해 학습 노트 (관리자 승인 후 게시된 것만). 지문 전문은 싣지 않고 공식 해설 PDF 로 연결한다.
 */
export function ReadingNotes({
  notes,
  solutionHref,
}: {
  notes: ReadingNote[];
  solutionHref: string | null;
}) {
  return (
    <div className="space-y-3" data-testid="reading-notes">
      <p className="text-muted-foreground text-xs">
        지문 원문은 공식 문제지·해설 PDF에서 확인하세요.
        {solutionHref ? (
          <>
            {" "}
            <a href={solutionHref} target="_blank" rel="noopener" className="underline">
              정답·해설 PDF 열기<span className="sr-only"> (새 창)</span>
            </a>
          </>
        ) : null}
      </p>
      <ul className="divide-border border-border divide-y rounded-md border">
        {notes.map((n) => (
          <li key={n.questionNumber} className="space-y-1.5 px-3 py-2.5 text-sm">
            <p className="flex flex-wrap items-center gap-1.5">
              <strong>{n.questionNumber}번</strong>
              {n.questionType ? <Badge variant="outline">{n.questionType}</Badge> : null}
              <Badge variant={n.origin === "ai_assisted" ? "warning" : "neutral"}>
                {ORIGIN_BADGES[n.origin]}
              </Badge>
            </p>
            {n.keyPoints.length ? <List title="핵심" items={n.keyPoints} /> : null}
            {n.grammarPoints.length ? <List title="문법·구문" items={n.grammarPoints} /> : null}
            {n.answerRationale ? (
              <p>
                <span className="font-semibold">정답 근거 </span>
                {n.answerRationale}
              </p>
            ) : null}
            {n.wrongChoices.length ? (
              <List
                title="오답 선택지"
                items={n.wrongChoices.map((w) => `${w.choice}번: ${w.reason}`)}
              />
            ) : null}
            {n.tags.length ? (
              <p className="text-muted-foreground text-xs">#{n.tags.join(" #")}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="font-semibold">{title}</p>
      <ul className="list-disc pl-5">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
