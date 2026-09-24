import type { FileType } from "../../lib/constants";
import type { DiscoveredArtifact } from "../types";

/** source 표기(버튼 텍스트, 파일명) → 자료 종류 */
export function normalizeArtifactType(raw: string): FileType | null {
  const text = raw.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  if (/대본|스크립트|script/.test(text)) return "listening_script";
  if (/듣기|음원|mp3|audio/.test(text)) return "listening_audio";
  if (/해설|정답|answer|solution/.test(text)) return "solution";
  if (/문제|시험지|question|paper/.test(text)) return "question";
  return null;
}

/** 같은 슬롯 후보 중 우선순위 (높을수록 선호) */
function labelRank(artifact: DiscoveredArtifact): number {
  const text = artifact.label.replace(/\s+/g, "");
  if (artifact.type === "solution") {
    if (/정답.*해설|해설/.test(text)) return 3; // 해설 포함본 > 정답표만
    if (/정답/.test(text)) return 1;
  }
  return 2;
}

/**
 * 한 시험 안에서 (과목, 종류) 슬롯당 하나만 남긴다.
 * 탐구 선택과목처럼 한 슬롯에 서로 다른 파일이 여러 개면 모두 버리지 않고 conflicts 로 돌려준다.
 */
export function dedupeArtifacts(artifacts: DiscoveredArtifact[]): {
  artifacts: DiscoveredArtifact[];
  conflicts: DiscoveredArtifact[][];
} {
  const slots = new Map<string, DiscoveredArtifact[]>();
  for (const a of artifacts) {
    const key = `${a.subject}:${a.type}`;
    const list = slots.get(key) ?? [];
    if (!list.some((x) => x.url === a.url)) list.push(a);
    slots.set(key, list);
  }
  const result: DiscoveredArtifact[] = [];
  const conflicts: DiscoveredArtifact[][] = [];
  for (const list of slots.values()) {
    const best = [...list].sort((a, b) => labelRank(b) - labelRank(a));
    const top = best[0]!;
    const sameRank = best.filter((a) => labelRank(a) === labelRank(top));
    if (sameRank.length > 1) conflicts.push(sameRank);
    else result.push(top);
  }
  return { artifacts: result, conflicts };
}
