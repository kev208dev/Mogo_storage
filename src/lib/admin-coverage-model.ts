import type { FeatureStatus } from "@/ingestion/feature-coverage";
export interface CoverageFile {
  subject: string;
  courseId: string | null;
  type: string;
}
export interface CoverageArtifact extends CoverageFile {
  status: string;
  statusReason: string | null;
  policyBlocked?: boolean;
}
export function slotStatus(
  slot: Omit<CoverageFile, "type">,
  type: string,
  files: CoverageFile[],
  artifacts: CoverageArtifact[],
): { status: FeatureStatus; detail: string } {
  const match = (f: CoverageFile) =>
    f.subject === slot.subject && f.courseId === slot.courseId && f.type === type;
  const found = artifacts.filter(match);
  const reasons = found
    .map((a) => a.statusReason)
    .filter(Boolean)
    .join(" · ");
  if (files.some(match))
    return {
      status: "complete",
      detail: `게시됨${found.some((a) => a.status === "manual_review") ? " · 변경 후보 검토 대기" : ""}`,
    };
  if (found.some((a) => a.status === "manual_review"))
    return { status: "manual_review", detail: reasons || "공식 URL 확인·승인 필요" };
  if (found.some((a) => a.policyBlocked))
    return { status: "blocked_policy", detail: reasons || "정책상 자동 수집 제한" };
  if (found.some((a) => a.status === "unavailable"))
    return { status: "missing", detail: reasons || "원문 이용 불가 · 재확인 필요" };
  if (found.some((a) => a.status === "failed"))
    return { status: "manual_review", detail: reasons || "수집·검증 실패 · 재검토 필요" };
  if (found.length)
    return {
      status: "partial",
      detail: reasons || `후보 확보 · 미게시 (${found.map((a) => a.status).join(", ")})`,
    };
  return { status: "missing", detail: "자료 미확보 · 원문 공개 여부 미확인" };
}
export function cutLabel(cut: { isOfficial: boolean; providerStatus: string }) {
  return cut.isOfficial && cut.providerStatus === "official_final"
    ? "공식 등급컷"
    : "업체 제공 · 공식 확정 아님";
}
