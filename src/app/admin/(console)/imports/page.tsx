import { getDb } from "@/db/client";
import { FILE_TYPE_LABELS, SUBJECT_LABELS } from "@/lib/constants";
import { importsData } from "@/lib/server/admin-queries";
import { examPath } from "@/lib/exam-path";
import { formatKst, Panel, SmallButton } from "@/components/admin/ui";
import { approveImportsAction, importOfficialUrlsAction, rejectImportsAction } from "../../actions";
import { AdminNotice } from "../notice";
import { NoDatabase } from "../no-db";

export const dynamic = "force-dynamic";

const TEMPLATE_HEADER =
  "year,grade,month,exam_type,exam_date,organizer,subject,course_code,file_type,official_url,original_file_name,source_label";

/**
 * 공식 파일 URL 입력 · 검토.
 * robots.txt 가 자동 수집을 막는 공식 사이트 자료를 운영자가 브라우저에서 확인한 URL 로 등록한다.
 * 서버는 입력된 URL 에 요청하지 않는다. 승인하면 redirect 로 게시된다.
 */
export default async function ImportsPage({ searchParams }: PageProps<"/admin/imports">) {
  const notice = (await searchParams).notice;
  const db = getDb();
  if (!db) return <NoDatabase />;
  const { pending, byStatus, recent } = await importsData(db);
  const statusCount = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">공식 URL 입력</h1>
      <AdminNotice value={notice} />
      <p className="text-muted-foreground text-sm">
        EBSi·KICE·교육청은 robots.txt 로 자동 수집을 막고 있습니다. 브라우저에서 공식 사이트를 직접
        열어 확인한 파일 URL 만 입력하세요. 서버는 이 URL 에 요청하지 않으며, 승인 전에는 공개되지
        않습니다. 비공식 미러·블로그· 클라우드 공유 링크는 공식 도메인 검사에서 거부됩니다.
      </p>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        {[
          ["검토 대기", statusCount.manual_review ?? 0],
          ["게시됨", statusCount.ready ?? 0],
          ["거절", statusCount.failed ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="border-border rounded-md border px-3 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-extrabold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <Panel title="CSV 입력">
        <form action={importOfficialUrlsAction} className="space-y-2 text-sm">
          <p className="text-muted-foreground text-xs">
            헤더(첫 줄): <code className="break-all">{TEMPLATE_HEADER}</code> · 템플릿:{" "}
            <code>data/imports/official-urls.template.csv</code> · 설명:{" "}
            <code>docs/OFFICIAL_URL_IMPORT.md</code>
          </p>
          <label className="block">
            <span className="font-semibold">CSV 파일</span>
            <input type="file" name="file" accept=".csv,text/csv" className="mt-1 block" />
          </label>
          <label className="block">
            <span className="font-semibold">또는 붙여넣기</span>
            <textarea
              name="csv"
              rows={6}
              className="border-border mt-1 block w-full rounded border p-2 font-mono text-xs"
              placeholder={TEMPLATE_HEADER}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="dryRun" value="1" /> 검사만 (DB 에 저장하지 않음)
          </label>
          <SmallButton variant="primary">입력</SmallButton>
        </form>
      </Panel>

      <Panel title={`검토 대기 ${pending.length}건`}>
        {pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">검토할 입력 자료가 없습니다.</p>
        ) : (
          <form className="space-y-2 text-sm">
            <p className="text-muted-foreground text-xs">
              각 [공식 URL 열기]로 파일을 직접 열어 시험·과목·자료 종류가 맞는지 확인한 뒤
              선택하세요.
            </p>
            <ul className="divide-border divide-y">
              {pending.map(({ artifact, exam, course }) => (
                <li
                  key={artifact.id}
                  className="flex flex-wrap items-center gap-2 py-2"
                  data-testid="import-row"
                >
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      name="ids"
                      value={artifact.id}
                      aria-label={`${artifact.sourceLabel} 선택`}
                    />
                    <span className="font-semibold">
                      {exam.year} 고{exam.grade} {exam.month}월 {SUBJECT_LABELS[artifact.subject]}
                      {course ? ` · ${course.name}` : ""} · {FILE_TYPE_LABELS[artifact.type]}
                    </span>
                  </label>
                  {exam.isSample ? (
                    <span className="bg-warning-soft text-warning-strong rounded px-1.5 text-xs font-bold">
                      승인 시 샘플 교체
                    </span>
                  ) : null}
                  <span className="text-muted-foreground w-full text-xs">
                    출처 표기 &quot;{artifact.sourceLabel}&quot; · 파일명{" "}
                    {artifact.originalFileName} · {formatKst(artifact.firstDiscoveredAt)} ·{" "}
                    <a
                      href={artifact.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      공식 URL 열기
                    </a>{" "}
                    ·{" "}
                    <a
                      href={examPath({
                        year: exam.year,
                        grade: exam.grade as 1 | 2 | 3,
                        month: exam.month,
                      })}
                      className="underline"
                    >
                      시험 페이지
                    </a>
                    <span className="block break-all">{artifact.sourceUrl}</span>
                  </span>
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-1.5 font-semibold">
              <input type="checkbox" name="browserChecked" value="1" required />
              선택한 URL 을 브라우저에서 직접 열어 올바른 공식 PDF/MP3 인지 확인했습니다
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                formAction={approveImportsAction}
                className="bg-primary text-primary-foreground min-h-11 rounded-md px-3 text-sm font-semibold"
              >
                선택 승인 · 게시
              </button>
              <input
                name="reason"
                placeholder="거절 사유 (선택)"
                aria-label="거절 사유"
                className="border-border h-11 rounded border px-2 text-sm"
              />
              <button
                type="submit"
                formAction={rejectImportsAction}
                formNoValidate
                className="border-border min-h-11 rounded-md border px-3 text-sm font-semibold"
              >
                선택 거절
              </button>
            </div>
          </form>
        )}
      </Panel>

      <Panel title="최근 입력 기록">
        <ul className="divide-border divide-y text-sm">
          {recent.length === 0 ? <li className="text-muted-foreground">기록이 없습니다.</li> : null}
          {recent.map((r) => (
            <li key={r.id} className="py-2">
              <span className="font-semibold">{formatKst(r.createdAt)}</span> · {r.createdBy} ·{" "}
              {r.fileName ?? "붙여넣기"} · 신규 {r.createdCount} · 변경 {r.updatedCount} · 동일{" "}
              {r.unchangedCount} · 오류 {r.invalidCount}
              {r.results
                .filter((x) => x.status === "invalid")
                .slice(0, 10)
                .map((x) => (
                  <span key={x.line} className="text-danger-strong block text-xs">
                    {x.line}행: {x.errors?.join("; ")}
                  </span>
                ))}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
