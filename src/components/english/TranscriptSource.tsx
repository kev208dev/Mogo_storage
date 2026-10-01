import type { TranscriptOrigin } from "@/lib/study";

const LABEL: Record<TranscriptOrigin, string> = {
  official: "출처: 공식 듣기 대본",
  authorized: "출처: 이용 허락을 받은 대본",
  sample: "개발용 샘플 대본 (실제 시험 대본 아님)",
  unverified: "",
};

/** 대본 출처 표시. 출처 미확인 대본은 애초에 화면에 오지 않는다 */
export function TranscriptSource({
  origin,
  url,
}: {
  origin: TranscriptOrigin | null;
  url: string | null;
}) {
  if (!origin || origin === "unverified") return null;
  return (
    <p className="text-muted-foreground mt-2 text-xs" data-testid="transcript-source">
      {LABEL[origin]}
      {url ? (
        <>
          {" · "}
          <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
            원본 보기<span className="sr-only"> (새 창)</span>
          </a>
        </>
      ) : null}
    </p>
  );
}
