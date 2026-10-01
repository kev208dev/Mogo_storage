import type { ListeningTrack, TranscriptLine } from "./data/types";

/**
 * 듣기 재생 규칙.
 *  - 문항 구간 재생은 timingVerified 인 트랙만 쓴다. 검증되지 않은 구간은 절대 추측해 쓰지 않는다.
 *  - 구간이 하나도 검증되지 않았으면 전체 음원 재생만 제공한다 (대본 열람·받아쓰기는 가능).
 */
export type ListeningMode = "segments" | "full_only";

export function verifiedSegments(tracks: readonly ListeningTrack[]): ListeningTrack[] {
  return tracks
    .filter(
      (t) =>
        t.questionNumber !== null &&
        t.timingVerified &&
        Number.isFinite(t.startSeconds) &&
        Number.isFinite(t.endSeconds) &&
        t.endSeconds > t.startSeconds,
    )
    .sort((a, b) => a.questionNumber! - b.questionNumber!);
}

export function listeningMode(tracks: readonly ListeningTrack[]): ListeningMode {
  return verifiedSegments(tracks).length > 0 ? "segments" : "full_only";
}

/** 공개 가능한 대본이 있는 문항 트랙 (구간 검증 여부와 무관) */
export function transcriptTracks(tracks: readonly ListeningTrack[]): ListeningTrack[] {
  return tracks
    .filter((t) => t.questionNumber !== null && t.transcript && t.transcript.length > 0)
    .sort((a, b) => a.questionNumber! - b.questionNumber!);
}

/** 이전/다음 문항 (목록 끝에서는 멈춘다) */
export function neighborSegment(
  segments: readonly ListeningTrack[],
  currentId: string | null,
  delta: -1 | 1,
): ListeningTrack | null {
  if (segments.length === 0) return null;
  const index = segments.findIndex((t) => t.id === currentId);
  if (index < 0) return delta === 1 ? segments[0]! : null;
  return segments[index + delta] ?? null;
}

/** 현재 시각이 속한 문장 (문장 구간이 공식 자료로 주어진 경우에만) */
export function activeLineIndex(lines: readonly TranscriptLine[], time: number): number | null {
  for (let i = 0; i < lines.length; i += 1) {
    const { startSeconds: s, endSeconds: e } = lines[i]!;
    if (typeof s === "number" && typeof e === "number" && time >= s && time < e) return i;
  }
  return null;
}

/** 구간 안에서만 이동 (구간 끝 0.25초 전까지) */
export function clampSeek(track: Pick<ListeningTrack, "startSeconds" | "endSeconds">, t: number) {
  return Math.min(
    Math.max(t, track.startSeconds),
    Math.max(track.startSeconds, track.endSeconds - 0.25),
  );
}
