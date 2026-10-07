import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { Panel, SmallButton, formatKst } from "@/components/admin/ui";
import { getDb } from "@/db/client";
import {
  examFiles,
  exams,
  listeningTracks,
  listeningTranscripts,
  studyMaterials,
  vocabulary,
} from "@/db/schema";
import { FILE_TYPE_LABELS, type FileType } from "@/lib/constants";
import { examPath, examTitle } from "@/lib/exam-path";
import {
  ORIGIN_BADGES,
  READING_NOTE_KIND,
  STUDY_MATERIAL_STATUS_LABELS,
  type StudyMaterialStatus,
} from "@/lib/study";
import type { Grade } from "@/lib/constants";
import { AdminNotice } from "../notice";
import { NoDatabase } from "../no-db";
import {
  attestStudyArtifactAction,
  regenerateStudyMaterialsAction,
  reviewStudyMaterialAction,
} from "./actions";
import { listStudyAttestationCandidates } from "@/ingestion/study/operator-attest";

export const dynamic = "force-dynamic";

const kindLabel = (kind: string) =>
  kind === READING_NOTE_KIND ? "독해 학습 노트" : (FILE_TYPE_LABELS[kind as FileType] ?? kind);

const NEXT_ACTIONS: Record<StudyMaterialStatus, Array<{ action: string; label: string }>> = {
  draft: [],
  generated: [
    { action: "start_review", label: "검토 시작" },
    { action: "approve", label: "승인" },
  ],
  reviewing: [{ action: "approve", label: "승인" }],
  approved: [{ action: "publish", label: "게시" }],
  published: [],
  rejected: [],
};

export default async function StudyAdminPage({ searchParams }: PageProps<"/admin/study">) {
  const sp = await searchParams;
  const db = getDb();
  if (!db) return <NoDatabase />;

  const recentExams = await db
    .select()
    .from(exams)
    .where(eq(exams.isSample, false))
    .orderBy(desc(exams.year), desc(exams.month), desc(exams.grade))
    .limit(24);
  const ids = recentExams.map((e) => e.id);
  const attestable = await listStudyAttestationCandidates(db);
  const [pending, published, files, vocab, transcripts, tracks] = await Promise.all([
    db
      .select({ material: studyMaterials, exam: exams })
      .from(studyMaterials)
      .innerJoin(exams, eq(exams.id, studyMaterials.examId))
      .where(inArray(studyMaterials.status, ["generated", "reviewing", "approved"]))
      .orderBy(desc(studyMaterials.updatedAt))
      .limit(200),
    db
      .select({ material: studyMaterials, exam: exams })
      .from(studyMaterials)
      .innerJoin(exams, eq(exams.id, studyMaterials.examId))
      .where(eq(studyMaterials.status, "published"))
      .orderBy(desc(studyMaterials.publishedAt))
      .limit(50),
    ids.length
      ? db
          .select({
            examId: examFiles.examId,
            type: examFiles.type,
            origin: examFiles.artifactOrigin,
          })
          .from(examFiles)
          .where(
            and(
              inArray(examFiles.examId, ids),
              eq(examFiles.subject, "english"),
              isNull(examFiles.courseId),
            ),
          )
      : Promise.resolve([]),
    ids.length
      ? db
          .select({ examId: vocabulary.examId, n: count() })
          .from(vocabulary)
          .where(inArray(vocabulary.examId, ids))
          .groupBy(vocabulary.examId)
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            examId: listeningTracks.examId,
            origin: listeningTranscripts.origin,
            n: count(),
          })
          .from(listeningTranscripts)
          .innerJoin(listeningTracks, eq(listeningTracks.id, listeningTranscripts.trackId))
          .where(inArray(listeningTracks.examId, ids))
          .groupBy(listeningTracks.examId, listeningTranscripts.origin)
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            examId: listeningTracks.examId,
            verified: listeningTracks.timingVerified,
            n: count(),
          })
          .from(listeningTracks)
          .where(inArray(listeningTracks.examId, ids))
          .groupBy(listeningTracks.examId, listeningTracks.timingVerified)
      : Promise.resolve([]),
  ]);
  const has = (examId: string, type: FileType) =>
    files.some((f) => f.examId === examId && f.type === type);

  return (
    <div className="space-y-4">
      <AdminNotice value={sp.notice} />
      <p className="text-muted-foreground text-sm">
        모의고사 창고가 만든 학습 자료(학습지 PDF · 독해 노트)는 자동으로 게시하지 않습니다. 생성 →
        검토 → 승인 → 게시 순서이며, 게시된 학습지는 공개 화면에 &ldquo;모의고사 창고
        제작&rdquo;으로 표시됩니다. 공식·수동 파일이 있는 슬롯은 덮어쓰지 않습니다.
      </p>

      <Panel title={`검토 대기 (${pending.length})`}>
        {pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">검토할 학습 자료가 없습니다.</p>
        ) : (
          <ul className="divide-border divide-y text-sm" data-testid="study-pending">
            {pending.map(({ material: m, exam }) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-semibold">
                  {examTitle({ ...exam, grade: exam.grade as Grade })}
                </span>
                <span>{kindLabel(m.kind)}</span>
                {m.questionNumber ? <span>{m.questionNumber}번</span> : null}
                <span className="text-muted-foreground text-xs">
                  {ORIGIN_BADGES[m.origin]} · {STUDY_MATERIAL_STATUS_LABELS[m.status]} ·{" "}
                  {formatKst(m.updatedAt)}
                </span>
                {m.storageKey ? (
                  <a
                    href={`/admin/study/preview/${m.id}`}
                    target="_blank"
                    rel="noopener"
                    className="text-xs underline"
                  >
                    미리보기
                  </a>
                ) : null}
                <span className="ml-auto flex flex-wrap gap-1">
                  {NEXT_ACTIONS[m.status].map((a) => (
                    <form key={a.action} action={reviewStudyMaterialAction}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="action" value={a.action} />
                      <SmallButton variant={a.action === "publish" ? "primary" : "outline"}>
                        {a.label}
                      </SmallButton>
                    </form>
                  ))}
                  <form action={reviewStudyMaterialAction} className="flex gap-1">
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="action" value="reject" />
                    <input
                      name="note"
                      placeholder="반려 사유"
                      aria-label="반려 사유"
                      className="border-border h-9 w-28 rounded-md border px-2 text-xs"
                    />
                    <SmallButton variant="danger">반려</SmallButton>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="최근 게시">
        <ul className="divide-border divide-y text-sm">
          {published.map(({ material: m, exam }) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <a
                href={examPath(
                  { year: exam.year, grade: exam.grade as Grade, month: exam.month },
                  "english",
                )}
                className="font-semibold underline"
              >
                {examTitle({ ...exam, grade: exam.grade as Grade })}
              </a>
              <span>{kindLabel(m.kind)}</span>
              <span className="text-muted-foreground text-xs">
                {formatKst(m.publishedAt)} · {m.reviewedBy}
              </span>
              <form action={reviewStudyMaterialAction} className="ml-auto">
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="action" value="reject" />
                <SmallButton variant="danger">게시 내리기</SmallButton>
              </form>
            </li>
          ))}
          {published.length === 0 ? (
            <li className="text-muted-foreground py-1.5">아직 게시된 학습 자료가 없습니다.</li>
          ) : null}
        </ul>
      </Panel>

      {attestable.length ? (
        <Panel title={`브라우저 확인이 필요한 운영자 입력 자료 (${attestable.length})`}>
          <p className="text-muted-foreground mb-2 text-xs">
            게시는 되어 있지만 브라우저 확인 기록이 없어 단어장 · 듣기 대본 추출을 하지 않는
            자료입니다. 공식 파일을 직접 열어 맞는 시험 · 종류인지 확인한 경우에만 체크하세요. 허용
            호스트 · 자료 종류 조건은 바뀌지 않습니다.
          </p>
          <ul className="divide-border divide-y text-sm" data-testid="study-attest">
            {attestable.map(({ artifact: a, exam }) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-semibold">
                  {examTitle({ ...exam, grade: exam.grade as Grade })}
                </span>
                <span>{FILE_TYPE_LABELS[a.type]}</span>
                <a
                  href={a.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs underline"
                >
                  공식 파일 열기
                </a>
                <form
                  action={attestStudyArtifactAction}
                  className="ml-auto flex items-center gap-2"
                >
                  <input type="hidden" name="artifactId" value={a.id} />
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" name="browserChecked" required />
                    브라우저에서 확인했습니다
                  </label>
                  <SmallButton variant="primary">학습자료 처리 허용</SmallButton>
                </form>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="영어 보충 자료 현황 (최근 시험)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-xs" data-testid="english-coverage">
            <thead>
              <tr className="border-border border-b text-left">
                <th className="px-2 py-1.5">시험</th>
                <th className="px-2 py-1.5">문제</th>
                <th className="px-2 py-1.5">해설</th>
                <th className="px-2 py-1.5">음원</th>
                <th className="px-2 py-1.5">대본 PDF</th>
                <th className="px-2 py-1.5">문항 대본 (출처)</th>
                <th className="px-2 py-1.5">구간 검증</th>
                <th className="px-2 py-1.5">단어</th>
                <th className="px-2 py-1.5">학습지</th>
              </tr>
            </thead>
            <tbody>
              {recentExams.map((e) => {
                const tr = transcripts.filter((t) => t.examId === e.id);
                const tk = tracks.filter((t) => t.examId === e.id);
                const verified = tk.find((t) => t.verified)?.n ?? 0;
                const total = tk.reduce((sum, t) => sum + t.n, 0);
                return (
                  <tr key={e.id} className="border-border border-b last:border-0">
                    <td className="px-2 py-1.5 font-semibold">
                      {examTitle({ ...e, grade: e.grade as Grade })}
                    </td>
                    {(["question", "solution", "listening_audio", "listening_script"] as const).map(
                      (t) => (
                        <td key={t} className="px-2 py-1.5">
                          {has(e.id, t) ? "✓" : "—"}
                        </td>
                      ),
                    )}
                    <td className="px-2 py-1.5">
                      {tr.length ? tr.map((t) => `${t.origin} ${t.n}`).join(", ") : "—"}
                    </td>
                    <td className="px-2 py-1.5">{total ? `${verified}/${total}` : "—"}</td>
                    <td className="px-2 py-1.5">{vocab.find((v) => v.examId === e.id)?.n ?? 0}</td>
                    <td className="px-2 py-1.5">
                      <form action={regenerateStudyMaterialsAction}>
                        <input type="hidden" name="examId" value={e.id} />
                        <SmallButton>다시 만들기</SmallButton>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          문항 대본은 공식 듣기 대본 PDF 에서만 추출합니다 (운영자 입력 URL 은 서버가 요청하지
          않으므로 제외). 구간 검증이 0 이면 공개 화면은 전체 음원 재생만 제공합니다.
        </p>
      </Panel>
    </div>
  );
}
