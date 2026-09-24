import { getDb } from "@/db/client";
import { FILE_TYPE_LABELS, SUBJECT_LABELS } from "@/lib/constants";
import { reviewData } from "@/lib/server/admin-queries";
import { Panel, SmallButton } from "@/components/admin/ui";
import { resolveCourse } from "@/ingestion/canonical/course";
import {
  approveArtifactAction,
  mapCourseAction,
  rejectArtifactAction,
  reviewCandidateAction,
} from "../../actions";
import { AdminNotice } from "../notice";
import { NoDatabase } from "../no-db";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: PageProps<"/admin/review">) {
  const db = getDb();
  if (!db) return <NoDatabase />;
  const notice = (await searchParams).notice;
  const { artifacts, candidates, catalog } = await reviewData(db);
  const unresolved = artifacts.filter(({ artifact }) => artifact.slotKey.startsWith("unresolved:"));
  const reviewable = artifacts.filter(
    ({ artifact }) => !artifact.slotKey.startsWith("unresolved:"),
  );
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">검토 대기</h1>
      <AdminNotice value={notice} />
      <Panel title={`과목 미확정 자료 ${unresolved.length}건`}>
        <p className="text-muted-foreground mb-2 text-xs">
          source 표기만으로 세부과목을 확정할 수 없는 자료입니다 (예: &quot;윤리&quot;). 원본을
          확인하고 과목을 지정하면 표기가 저장되어 다음 수집부터 자동으로 같은 과목으로 처리됩니다.
        </p>
        <ul className="divide-border divide-y text-sm">
          {unresolved.length === 0 ? <li className="text-muted-foreground">없음</li> : null}
          {unresolved.map(({ artifact, exam, source }) => {
            const suggested = resolveCourse(artifact.courseLabel ?? "", {
              subject: artifact.subject,
            });
            // 모호한 표기의 후보, 또는 체제 검증으로 보류된 카탈로그 판정
            const suggestedCodes =
              suggested.status === "ambiguous"
                ? suggested.candidates
                : suggested.status === "resolved"
                  ? [suggested.code]
                  : [];
            const options = [
              ...catalog.filter((c) => suggestedCodes.includes(c.code)),
              ...catalog.filter(
                (c) => c.subject === artifact.subject && !suggestedCodes.includes(c.code),
              ),
            ];
            return (
              <li key={artifact.id} className="py-2" data-testid="unresolved-artifact">
                <p className="font-semibold">
                  {exam.year} 고{exam.grade} {exam.month}월 {SUBJECT_LABELS[artifact.subject]}{" "}
                  {FILE_TYPE_LABELS[artifact.type]} · 표기 &quot;{artifact.courseLabel}&quot;
                </p>
                <p className="text-muted-foreground text-xs" data-testid="source-label">
                  source 원문: &quot;{artifact.sourceLabel ?? artifact.courseLabel}&quot;
                  {artifact.statusReason ? ` · ${artifact.statusReason}` : ""}
                </p>
                <p className="text-muted-foreground text-xs">
                  {source.name} · {artifact.status} ·{" "}
                  <a
                    href={artifact.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    원본 확인
                  </a>
                </p>
                <form
                  action={mapCourseAction}
                  className="mt-1.5 flex flex-wrap items-center gap-1.5"
                >
                  <input type="hidden" name="id" value={artifact.id} />
                  <label className="sr-only" htmlFor={`course-${artifact.id}`}>
                    세부과목
                  </label>
                  <select
                    id={`course-${artifact.id}`}
                    name="course"
                    required
                    defaultValue=""
                    className="border-border h-9 rounded border px-1 text-sm"
                  >
                    <option value="" disabled>
                      과목 선택
                    </option>
                    {options.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                        {suggestedCodes.includes(c.code) ? " (후보)" : ""}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" name="scope" value="global" /> 모든 source 에 적용
                  </label>
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" name="regimeOnly" value="1" /> 이 시험 체제에만 적용
                  </label>
                  <SmallButton variant="primary">과목 지정</SmallButton>
                </form>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title={`자료 (manual_review) ${reviewable.length}건`}>
        <ul className="divide-border divide-y text-sm">
          {reviewable.length === 0 ? <li className="text-muted-foreground">없음</li> : null}
          {reviewable.map(({ artifact, exam, source }) => (
            <li key={artifact.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-semibold">
                {exam.year} 고{exam.grade} {exam.month}월 {SUBJECT_LABELS[artifact.subject]}
                {artifact.courseId
                  ? ` ${catalog.find((c) => c.id === artifact.courseId)?.name ?? ""}`
                  : ""}{" "}
                {FILE_TYPE_LABELS[artifact.type]}
              </span>
              <a
                href={artifact.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary text-xs underline"
              >
                원본 확인 ({source.name})
              </a>
              {artifact.containerType === "archive" ? (
                <span className="text-warning-strong text-xs">
                  압축 파일 (여러 과목 포함 가능) — 압축 해제 미구현, 공개 불가
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">
                  sha256 {artifact.sha256?.slice(0, 12)}…
                </span>
              )}
              <span className="ml-auto flex gap-1">
                {artifact.containerType !== "archive" ? (
                  <form action={approveArtifactAction}>
                    <input type="hidden" name="id" value={artifact.id} />
                    <SmallButton variant="primary">승인·공개</SmallButton>
                  </form>
                ) : null}
                <form action={rejectArtifactAction}>
                  <input type="hidden" name="id" value={artifact.id} />
                  <SmallButton variant="danger">거절</SmallButton>
                </form>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title={`단어 후보 (needs_review) ${candidates.length}건`}>
        <p className="text-muted-foreground mb-2 text-xs">
          원본 해설 자료에서 추출된 단어만 표시됩니다. 신뢰도가 낮아 자동 승인되지 않은 항목입니다.
        </p>
        <ul className="divide-border divide-y text-sm">
          {candidates.length === 0 ? <li className="text-muted-foreground">없음</li> : null}
          {candidates.map(({ candidate, exam }) => (
            <li key={candidate.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="text-muted-foreground w-28 text-xs">
                {exam.year} 고{exam.grade} {exam.month}월 {candidate.questionNumber}번
              </span>
              <span className="font-semibold" lang="en">
                {candidate.word}
              </span>
              <span>{candidate.meaning ?? "(뜻 없음)"}</span>
              <span className="text-muted-foreground text-xs">
                신뢰도 {Math.round(candidate.confidence * 100)}%
              </span>
              <span className="ml-auto flex gap-1">
                <form action={reviewCandidateAction}>
                  <input type="hidden" name="id" value={candidate.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <SmallButton variant="primary">승인</SmallButton>
                </form>
                <form action={reviewCandidateAction}>
                  <input type="hidden" name="id" value={candidate.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <SmallButton variant="danger">제외</SmallButton>
                </form>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
