import { FILE_TYPE_LABELS, SUBJECT_LABELS, type FileType } from "@/lib/constants";
import {
  REASON_LABELS,
  type ReviewEvidence,
  type ReviewNote,
  type ReviewReasonCode,
} from "@/ingestion/manual-import/evidence";
import type { ReviewInsight } from "@/ingestion/manual-import/review";

function evidenceText(e: ReviewEvidence): string {
  switch (e.kind) {
    case "search_result":
      return `검색 결과: "${e.title.slice(0, 60)}"${e.query ? ` (검색어 ${e.query.slice(0, 40)})` : ""}`;
    case "url_check":
      return `URL 확인: HTTP ${e.status} · ${e.contentType || "-"} · PDF 서명 ${e.pdfSignature ? "있음" : "없음"}`;
    case "browser_check":
      return `브라우저 확인: HTTP ${e.status} · ${e.contentType}${e.pdfPages ? ` · ${e.pdfPages}쪽` : ""}`;
    case "page1_header":
      return `1쪽 머리말: ${e.text.slice(0, 80)}`;
    case "exam_line":
      return `문서 안 시험 문구: ${e.text ?? "없음"}`;
    case "visual_check":
      return `육안 확인: ${e.note}`;
    case "classification":
      return `분류 근거: ${e.via} · 점수 ${e.score}`;
  }
}

/** 검토 대기 자료의 보류 사유 · 근거 · 충돌 · 짝 추천 */
export function ReviewDetails({ insight, note }: { insight?: ReviewInsight; note?: ReviewNote }) {
  const reason =
    note?.reason ??
    (note?.reasonCode ? REASON_LABELS[note.reasonCode as ReviewReasonCode] : undefined);
  const warnings: Array<{ tone: "danger" | "warning" | "info"; text: string }> = [];
  if (insight?.publishedInSlot?.sameUrl)
    warnings.push({
      tone: "info",
      text: "같은 URL 이 이 슬롯에 이미 게시됨 — 확정적 중복 (정리 가능)",
    });
  else if (insight?.publishedInSlot)
    warnings.push({
      tone: "warning",
      text: `이 슬롯에는 다른 URL 이 이미 게시돼 있음 (${insight.publishedInSlot.url ?? "저장소 파일"}) — 승인 전 어느 쪽이 맞는지 확인`,
    });
  for (const o of insight?.sameUrl ?? [])
    warnings.push({
      tone: "danger",
      text: `같은 URL 이 다른 슬롯에도 연결됨: ${o.examLabel} ${SUBJECT_LABELS[o.subject]}${o.slotKey ? `/${o.slotKey}` : ""} ${FILE_TYPE_LABELS[o.type as FileType] ?? o.type} (${o.status})`,
    });
  const tone = {
    danger: "text-danger-strong",
    warning: "text-warning-strong",
    info: "text-muted-foreground",
  };
  if (!reason && !note?.evidence.length && !warnings.length && !insight?.pairs.length) return null;
  return (
    <div className="w-full space-y-0.5 text-xs" data-testid="review-details">
      {reason ? <p className="text-danger-strong font-semibold">보류 사유: {reason}</p> : null}
      {warnings.map((w) => (
        <p key={w.text} className={tone[w.tone]}>
          ⚠ {w.text}
        </p>
      ))}
      {insight?.pairs.length ? (
        <p className="text-muted-foreground">
          짝 자료:{" "}
          {insight.pairs
            .map((p) => `${FILE_TYPE_LABELS[p.type as FileType] ?? p.type} (${p.status})`)
            .join(", ")}
        </p>
      ) : null}
      {note?.evidence.length ? (
        <details>
          <summary className="text-muted-foreground cursor-pointer">
            근거 {note.evidence.length}건
          </summary>
          <ul className="text-muted-foreground list-disc pl-4">
            {note.evidence.map((e, i) => (
              <li key={i} className="break-all">
                {evidenceText(e)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
