import { getDb } from "@/db/client";
import { FILE_TYPE_LABELS, SUBJECT_LABELS } from "@/lib/constants";
import { dashboardData } from "@/lib/server/admin-queries";
import { formatKst, HealthBadge, Mark, Panel, SmallButton } from "@/components/admin/ui";
import {
  resolveErrorsAction,
  retryAllFailedAction,
  retryArtifactAction,
  retryJobAction,
  revokeVerificationAction,
  approveVerificationAction,
  dismissJobAction,
  runHealthCheckAction,
  runSourceNowAction,
  toggleCapabilityAction,
  toggleSourceAction,
} from "../actions";
import {
  activationBlockers,
  currentParserVersion,
  isLiveVerified,
} from "@/ingestion/sources/verification";
import { AdminNotice } from "./notice";
import { NoDatabase } from "./no-db";

export const dynamic = "force-dynamic";

export default async function AdminDashboard({ searchParams }: PageProps<"/admin">) {
  const notice = (await searchParams).notice;
  const db = getDb();
  if (!db) return <NoDatabase />;
  const data = await dashboardData(db);
  const failures = data.failedJobs.length + data.failedArtifacts.length;
  const ingestionOn = process.env.INGESTION_ENABLED === "true";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">오늘의 수집 상태</h1>
      <AdminNotice value={notice} />
      {!ingestionOn ? (
        <p className="bg-warning-soft text-warning-strong rounded-md px-3 py-2 text-sm font-semibold">
          INGESTION_ENABLED=false — 자동 수집(cron)이 꺼져 있습니다.
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {[
          ["실패", failures],
          ["24시간 오류", data.counts.errors24h],
          ["검토 대기", data.counts.manualReview + data.counts.vocabularyReview],
          ["미처리 신고", data.counts.pendingReports],
        ].map(([label, value]) => (
          <div key={label} className="border-border rounded-md border px-3 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-extrabold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <Panel title="출처 (source)">
        <ul className="divide-border divide-y">
          {data.sources.length === 0 ? (
            <li className="text-muted-foreground py-2 text-sm">
              등록된 source 가 없습니다. npm run ingest:sources 로 동기화하세요.
            </li>
          ) : null}
          {data.sources.map((s) => {
            const current = currentParserVersion(s.kind);
            const verified = isLiveVerified(s.kind, s);
            const evidenceCurrent =
              Boolean(s.liveFixtureValidatedAt) && s.liveFixtureParserVersion === current;
            const blockers = activationBlockers(s);
            const capabilities = [
              ["discovery", "시험 목록", s.discoveryEnabled],
              ["artifacts", "자료 수집", s.artifactEnabled],
              ["release_watch", "시험일 감시", s.releaseWatchEnabled],
            ] as const;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                <span className="w-40 font-bold">{s.name}</span>
                {verified ? (
                  <HealthBadge status={s.enabled ? s.healthStatus : "disabled"} />
                ) : (
                  <span className="bg-warning-soft text-warning-strong rounded px-1.5 py-0.5 text-xs font-bold">
                    실제 구조 미검증
                  </span>
                )}
                {!verified &&
                ["structure_changed", "network_error", "broken", "degraded"].includes(
                  s.healthStatus,
                ) ? (
                  <HealthBadge status={s.healthStatus} />
                ) : null}
                {s.healthStatus === "structure_changed" || s.healthStatus === "broken" ? (
                  <span className="text-danger-strong text-xs font-bold">
                    자동 게시 중단 — 페이지 구조를 확인하세요
                  </span>
                ) : null}
                {s.lastHealthCheckAt ? (
                  <span className="text-muted-foreground text-xs">
                    health check <HealthBadge status={s.healthStatus} />{" "}
                    {formatKst(s.lastHealthCheckAt)}
                  </span>
                ) : null}
                <span className="text-muted-foreground">
                  자동 수집: <strong>{verified && s.enabled ? "활성" : "비활성"}</strong> · parser{" "}
                  {current} · 정책 {s.deliveryPolicy}
                </span>
                {verified ? (
                  <span className="text-muted-foreground w-full text-xs">
                    검증 승인 {formatKst(s.verifiedAt)} · {s.verifiedBy} · fixture{" "}
                    {s.verifiedFixtureHash?.slice(0, 12)} · 마지막 확인{" "}
                    {formatKst(s.lastSuccessfulFetchAt)} · 최근 실패 {formatKst(s.lastFailureAt)}{" "}
                    (연속 {s.failureCount}회)
                  </span>
                ) : evidenceCurrent ? (
                  <span className="w-full text-xs">
                    실제 fixture 검증 통과 {formatKst(s.liveFixtureValidatedAt)} (fixture{" "}
                    {s.liveFixtureHash?.slice(0, 12)}) — 관리자 승인 대기
                  </span>
                ) : (
                  <span className="text-muted-foreground w-full text-xs">
                    {s.liveFixtureValidatedAt
                      ? `fixture 검증이 이전 parser(${s.liveFixtureParserVersion}) 기준입니다. 다시 검증해야 합니다.`
                      : "실제 페이지 fixture 가 없습니다."}{" "}
                    npm run ingest:capture → npm run ingest:fixtures:validate -- --record
                  </span>
                )}
                {s.healthMessage ? (
                  <span className="text-danger-strong w-full text-xs">{s.healthMessage}</span>
                ) : null}
                {verified && !s.enabled && blockers.length ? (
                  <span className="text-muted-foreground w-full text-xs">
                    켜기 전 조건: {blockers.join(" · ")}
                  </span>
                ) : null}
                {verified && s.enabled ? (
                  <span className="flex w-full flex-wrap gap-1 text-xs">
                    {capabilities.map(([key, name, on]) => (
                      <form key={key} action={toggleCapabilityAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="capability" value={key} />
                        <input type="hidden" name="on" value={on ? "false" : "true"} />
                        <SmallButton variant={on ? "primary" : undefined}>
                          {name}: {on ? "켜짐 ✓" : "꺼짐"}
                        </SmallButton>
                      </form>
                    ))}
                  </span>
                ) : null}
                <span className="ml-auto flex gap-1">
                  <form action={runHealthCheckAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <SmallButton>health check</SmallButton>
                  </form>
                  {verified ? (
                    <>
                      <form action={runSourceNowAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <SmallButton>지금 수집</SmallButton>
                      </form>
                      <form action={toggleSourceAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="enabled" value={s.enabled ? "false" : "true"} />
                        <SmallButton variant={s.enabled ? "danger" : "primary"}>
                          {s.enabled ? "끄기" : "켜기"}
                        </SmallButton>
                      </form>
                      <form action={revokeVerificationAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <SmallButton variant="danger">검증 취소</SmallButton>
                      </form>
                    </>
                  ) : evidenceCurrent ? (
                    <form action={approveVerificationAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <SmallButton variant="primary">검증 승인</SmallButton>
                    </form>
                  ) : (
                    <span className="border-border text-muted-foreground inline-flex min-h-9 items-center rounded-md border border-dashed px-2.5 text-xs font-semibold">
                      fixture 검증 필요
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="시험별 자료 (예정·최근 활동)">
        {data.matrices.length === 0 ? (
          <p className="text-muted-foreground text-sm">표시할 시험이 없습니다.</p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {data.matrices.map((m) => (
            <div key={m.examId} className="border-border rounded-md border p-2.5 text-sm">
              <p className="font-bold">
                {m.label}
                {m.schedule ? (
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    {m.schedule.examDate} · {m.schedule.status}
                  </span>
                ) : null}
              </p>
              {m.subjects.length === 0 ? (
                <p className="text-muted-foreground text-xs">아직 발견된 자료 없음</p>
              ) : null}
              <ul className="mt-1 space-y-0.5">
                {m.subjects.map((subj) => (
                  <li key={subj.subject}>
                    {subj.areaLabel ? <p className="mt-1 font-semibold">{subj.areaLabel}</p> : null}
                    <ul className={subj.areaLabel ? "pl-3" : undefined}>
                      {subj.rows.map((r) => (
                        <li key={r.label} className="flex flex-wrap gap-x-3">
                          <span className="w-24">{r.label}</span>
                          <Mark value={r.question} name="문제" />
                          <Mark value={r.solution} name="해설" />
                          {r.listening ? <Mark value={r.listening} name="듣기" /> : null}
                        </li>
                      ))}
                      {subj.unresolved ? (
                        <li className="text-warning-strong text-xs">
                          과목 미확정 자료 {subj.unresolved}건 → 검토 대기에서 과목 지정
                        </li>
                      ) : null}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title={`실패 ${failures}건`}
        action={
          <div className="flex gap-1">
            <form action={retryAllFailedAction}>
              <SmallButton variant="primary">실패 job 전체 다시 시도</SmallButton>
            </form>
            <form action={resolveErrorsAction}>
              <SmallButton>오류 확인 처리</SmallButton>
            </form>
          </div>
        }
      >
        <ul className="divide-border divide-y text-sm">
          {data.failedArtifacts.map(({ artifact, exam }) => (
            <li key={artifact.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="font-semibold">
                {exam.year} 고{exam.grade} {exam.month}월 {SUBJECT_LABELS[artifact.subject]}{" "}
                {FILE_TYPE_LABELS[artifact.type]}
              </span>
              <span className="text-muted-foreground text-xs">
                {artifact.sourceId} · {artifact.status} · {artifact.statusReason}
              </span>
              <form action={retryArtifactAction} className="ml-auto">
                <input type="hidden" name="id" value={artifact.id} />
                <SmallButton>다시 시도</SmallButton>
              </form>
            </li>
          ))}
          {data.failedJobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="font-semibold">job {job.type}</span>
              <span className="text-muted-foreground text-xs">
                시도 {job.attempts}/{job.maxAttempts} · {job.lastError}
              </span>
              <span className="ml-auto flex gap-1">
                <form action={retryJobAction}>
                  <input type="hidden" name="id" value={job.id} />
                  <SmallButton>다시 시도</SmallButton>
                </form>
                <form action={dismissJobAction}>
                  <input type="hidden" name="id" value={job.id} />
                  <SmallButton variant="danger">무시</SmallButton>
                </form>
              </span>
            </li>
          ))}
          {failures === 0 ? (
            <li className="text-muted-foreground py-1.5">실패한 작업이 없습니다.</li>
          ) : null}
        </ul>
      </Panel>
    </div>
  );
}
