import type { ListeningTrack } from "@/lib/data/types";
import { TranscriptSource } from "./TranscriptSource";

/**
 * 문항별 구간이 검증되지 않은 시험의 대본 열람 (재생 위치와 연결하지 않는다).
 * 공식·허락된 대본만 들어온다.
 */
export function TranscriptList({ tracks }: { tracks: ListeningTrack[] }) {
  return (
    <ul
      className="divide-border border-border mt-3 divide-y rounded-md border"
      data-testid="transcript-list"
    >
      {tracks.map((t) => (
        <li key={t.id} data-question={t.questionNumber}>
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center px-3 font-semibold">
              {t.label} 대본
            </summary>
            <div className="space-y-1 px-3 pb-3 text-sm" lang="en">
              {t.transcript!.map((line, i) => (
                <p key={i}>
                  {line.speaker ? <strong className="mr-1.5">{line.speaker}:</strong> : null}
                  {line.text}
                </p>
              ))}
              <TranscriptSource origin={t.transcriptOrigin} url={t.transcriptSourceUrl} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
