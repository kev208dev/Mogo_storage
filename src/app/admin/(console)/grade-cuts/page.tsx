import { desc, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Panel, SmallButton, formatKst } from "@/components/admin/ui";
import { getDb } from "@/db/client";
import { courses, exams, gradeCuts, gradeCutWatchStates } from "@/db/schema";
import {
  EXAM_TYPE_LABELS,
  GRADE_CUT_SOURCE_LABELS,
  GRADE_CUT_SOURCES,
  SUBJECT_LABELS,
  SUBJECTS,
} from "@/lib/constants";
import { GRADE_CUT_SOURCE_POLICIES } from "@/ingestion/grade-cuts/sources";
import { AdminNotice } from "../notice";
import { NoDatabase } from "../no-db";
import { bulkImportGradeCutsAction, deleteGradeCutAction, upsertGradeCutAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function GradeCutsPage({ searchParams }: PageProps<"/admin/grade-cuts">) {
  const notice = (await searchParams).notice;
  const db = getDb();
  if (!db) return <NoDatabase />;

  const [examRows, courseRows, rows, watchRows] = await Promise.all([
    db
      .select()
      .from(exams)
      .orderBy(desc(exams.year), desc(exams.month), desc(exams.grade))
      .limit(250),
    db
      .select()
      .from(courses)
      .where(eq(courses.active, true))
      .orderBy(courses.subject, courses.displayOrder),
    db
      .select({ cut: gradeCuts, exam: exams, course: courses })
      .from(gradeCuts)
      .innerJoin(exams, eq(exams.id, gradeCuts.examId))
      .leftJoin(courses, eq(courses.id, gradeCuts.courseId))
      .orderBy(desc(exams.year), desc(exams.month), desc(gradeCuts.updatedAt))
      .limit(500),
    db
      .select({ state: gradeCutWatchStates, exam: exams, course: courses })
      .from(gradeCutWatchStates)
      .innerJoin(exams, eq(exams.id, gradeCutWatchStates.examId))
      .leftJoin(courses, eq(courses.id, gradeCutWatchStates.courseId))
      .orderBy(desc(exams.year), desc(exams.month))
      .limit(500),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">등급컷 관리</h1>
      <AdminNotice value={notice} />
      <p className="text-muted-foreground text-sm">
        검증된 공개 출처만 자동 수집합니다. 아래 입력은 자동 수집 실패 시 수동 보정용입니다.
      </p>
      <Panel title="자동 수집 출처">
        <ul className="space-y-1 text-sm">
          {GRADE_CUT_SOURCES.map((source) => (
            <li key={source} className="flex flex-wrap gap-2">
              <span className="font-semibold">{GRADE_CUT_SOURCE_LABELS[source]}</span>
              <Badge
                variant={
                  GRADE_CUT_SOURCE_POLICIES[source].status === "automated_verified"
                    ? "default"
                    : "warning"
                }
              >
                {GRADE_CUT_SOURCE_POLICIES[source].status}
              </Badge>
              <span className="text-muted-foreground">
                {GRADE_CUT_SOURCE_POLICIES[source].note}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={`자동 감시 상태 · ${watchRows.length}개 슬롯`}>
        {watchRows.length === 0 ? (
          <p className="text-muted-foreground text-sm">아직 감시 기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th>시험/과목</th>
                  <th>상태</th>
                  <th>감시 시작</th>
                  <th>마지막 확인</th>
                  <th>공식 확정</th>
                  <th>실패</th>
                  <th>출처</th>
                  <th>마지막 오류</th>
                </tr>
              </thead>
              <tbody>
                {watchRows.map(({ state, exam, course }) => {
                  const present = rows.filter(
                    ({ cut }) =>
                      cut.examId === exam.id &&
                      cut.subject === state.subject &&
                      cut.courseId === state.courseId,
                  );
                  return (
                    <tr key={state.id} className="border-b">
                      <td>
                        {exam.year} 고{exam.grade} {exam.month}월 · {SUBJECT_LABELS[state.subject]}
                        {course ? ` · ${course.name}` : ""}
                      </td>
                      <td>
                        <Badge variant={state.status === "finalized" ? "default" : "warning"}>
                          {state.status}
                        </Badge>
                      </td>
                      <td>{state.startedAt ? formatKst(state.startedAt) : "-"}</td>
                      <td>{state.lastPolledAt ? formatKst(state.lastPolledAt) : "-"}</td>
                      <td>{state.finalizedAt ? formatKst(state.finalizedAt) : "-"}</td>
                      <td>{state.failureCount}</td>
                      <td>
                        {GRADE_CUT_SOURCES.map(
                          (source) =>
                            `${GRADE_CUT_SOURCE_LABELS[source]} ${present.some(({ cut }) => cut.source === source) ? "✓" : "–"}`,
                        ).join(" · ")}
                      </td>
                      <td className="max-w-xs break-words">{state.lastError ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <h2 className="pt-3 text-lg font-bold">수동 보정</h2>
      <Panel title="CSV 대량 입력">
        <form action={bulkImportGradeCutsAction} className="space-y-2 text-sm">
          <p className="text-muted-foreground text-xs">
            한 번에 여러 시험·과목·출처를 처리합니다. 헤더:{" "}
            <code className="break-all">
              year,grade,month,subject,course_code,source,source_url,cuts
            </code>
          </p>
          <p className="text-muted-foreground text-xs">
            cuts 예시: <code>&quot;1:88;2:80;3:72&quot;</code> · source: <code>official</code>,{" "}
            <code>ebs</code>, <code>megastudy</code>, <code>daesung</code>
          </p>
          <label className="block">
            <span className="font-semibold">CSV 파일</span>
            <input type="file" name="file" accept=".csv,text/csv" className="mt-1 block" />
          </label>
          <label className="block">
            <span className="font-semibold">또는 붙여넣기</span>
            <textarea
              name="csv"
              rows={7}
              className="border-border mt-1 block w-full rounded border p-2 font-mono text-xs"
              placeholder={
                'year,grade,month,subject,course_code,source,source_url,cuts\n2025,3,9,korean,,official,https://example.com,"1:88;2:80;3:72"'
              }
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="dryRun" value="1" /> 검사만 (DB에 저장하지 않음)
          </label>
          <SmallButton variant="primary">CSV 일괄 처리</SmallButton>
        </form>
      </Panel>

      <Panel title="등급컷 입력 · 수정">
        <form action={upsertGradeCutAction} className="grid gap-3 text-sm md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="font-semibold">시험</span>
            <select
              name="examId"
              required
              defaultValue=""
              className="border-border bg-background mt-1 block h-10 w-full rounded-md border px-2"
            >
              <option value="" disabled>
                시험 선택
              </option>
              {examRows.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.year} 고{exam.grade} {exam.month}월 · {EXAM_TYPE_LABELS[exam.examType]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="font-semibold">영역</span>
            <select
              name="subject"
              required
              defaultValue=""
              className="border-border bg-background mt-1 block h-10 w-full rounded-md border px-2"
            >
              <option value="" disabled>
                영역 선택
              </option>
              {SUBJECTS.map((subject) => (
                <option key={subject} value={subject}>
                  {SUBJECT_LABELS[subject]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="font-semibold">세부과목</span>
            <select
              name="courseId"
              defaultValue=""
              className="border-border bg-background mt-1 block h-10 w-full rounded-md border px-2"
            >
              <option value="">영역 전체 / 세부과목 없음</option>
              {SUBJECTS.map((subject) => {
                const subjectCourses = courseRows.filter((course) => course.subject === subject);
                if (subjectCourses.length === 0) return null;
                return (
                  <optgroup key={subject} label={SUBJECT_LABELS[subject]}>
                    {subjectCourses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <span className="text-muted-foreground mt-1 block text-xs">
              선택한 시험에 실제 등록된 세부과목만 저장됩니다.
            </span>
          </label>

          <label className="block">
            <span className="font-semibold">출처</span>
            <select
              name="source"
              required
              defaultValue="official"
              className="border-border bg-background mt-1 block h-10 w-full rounded-md border px-2"
            >
              {GRADE_CUT_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {GRADE_CUT_SOURCE_LABELS[source]} ·{" "}
                  {GRADE_CUT_SOURCE_POLICIES[source].isOfficial ? "공식" : "예상"}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="font-semibold">출처 URL</span>
            <input
              name="sourceUrl"
              type="url"
              inputMode="url"
              required
              placeholder="https://..."
              className="border-border bg-background mt-1 block h-10 w-full rounded-md border px-2"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="font-semibold">원점수 등급컷</span>
            <textarea
              name="cuts"
              required
              rows={7}
              placeholder={"1: 88\n2: 80\n3: 72\n4: 64"}
              className="border-border bg-background mt-1 block w-full rounded-md border p-2 font-mono text-sm"
            />
            <span className="text-muted-foreground mt-1 block text-xs">
              한 줄에 하나씩 <code>등급: 원점수</code>. 일부 등급만 입력해도 되며, 없는 등급은
              추측하지 않습니다.
            </span>
          </label>

          <div className="md:col-span-2">
            <SmallButton variant="primary">저장</SmallButton>
          </div>
        </form>
      </Panel>

      <Panel title={`등록된 등급컷 ${rows.length}건`}>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">등록된 실제 등급컷이 없습니다.</p>
        ) : (
          <ul className="divide-border divide-y text-sm">
            {rows.map(({ cut, exam, course }) => (
              <li key={cut.id} className="flex flex-wrap items-start gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold">
                      {exam.year} 고{exam.grade} {exam.month}월 · {SUBJECT_LABELS[cut.subject]}
                      {course ? ` · ${course.name}` : ""}
                    </span>
                    <Badge variant={cut.isOfficial ? "default" : "warning"}>
                      {GRADE_CUT_SOURCE_LABELS[cut.source]} · {cut.isOfficial ? "공식" : "예상"}
                    </Badge>
                  </div>
                  <p className="mt-1 tabular-nums">
                    {cut.cuts
                      .slice()
                      .sort((a, b) => a.grade - b.grade)
                      .map((entry) => `${entry.grade}등급 ${entry.rawScore}점`)
                      .join(" · ")}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {formatKst(cut.updatedAt)}
                    {cut.sourceUrl ? (
                      <>
                        {" · "}
                        <a
                          href={cut.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          출처 열기
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
                <form action={deleteGradeCutAction}>
                  <input type="hidden" name="id" value={cut.id} />
                  <SmallButton variant="danger">삭제</SmallButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
