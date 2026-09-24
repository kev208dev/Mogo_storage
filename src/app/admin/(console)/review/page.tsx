import { getDb } from "@/db/client";
import { FILE_TYPE_LABELS, SUBJECT_LABELS } from "@/lib/constants";
import { reviewData } from "@/lib/server/admin-queries";
import { Panel, SmallButton } from "@/components/admin/ui";
import { approveArtifactAction, rejectArtifactAction, reviewCandidateAction } from "../../actions";
import { NoDatabase } from "../no-db";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const db = getDb();
  if (!db) return <NoDatabase />;
  const { artifacts, candidates } = await reviewData(db);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">검토 대기</h1>
      <Panel title={`자료 (manual_review) ${artifacts.length}건`}>
        <ul className="divide-border divide-y text-sm">
          {artifacts.length === 0 ? <li className="text-muted-foreground">없음</li> : null}
          {artifacts.map(({ artifact, exam, source }) => (
            <li key={artifact.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-semibold">
                {exam.year} 고{exam.grade} {exam.month}월 {SUBJECT_LABELS[artifact.subject]}{" "}
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
              <span className="text-muted-foreground text-xs">
                sha256 {artifact.sha256?.slice(0, 12)}…
              </span>
              <span className="ml-auto flex gap-1">
                <form action={approveArtifactAction}>
                  <input type="hidden" name="id" value={artifact.id} />
                  <SmallButton variant="primary">승인·공개</SmallButton>
                </form>
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
