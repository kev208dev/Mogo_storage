import { describe, expect, it } from "vitest";
import type { WorkerResult } from "@/ingestion/jobs/worker";
import {
  evaluateSchedulerHealth,
  HUNG_AFTER_MINUTES,
  type HeartbeatRow,
} from "@/ingestion/ops/scheduler";
import {
  jobsHeartbeat,
  releaseWatchHeartbeat,
  scheduledHeartbeat,
} from "@/ingestion/ops/task-outcome";
import type { DiscoveryResult } from "@/ingestion/pipeline/discovery";
import type { ScheduledResult } from "@/ingestion/watch";
import { checkProductionEnv } from "@/lib/server/env";

const NOW = new Date("2026-10-21T00:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const row = (task: string, patch: Partial<HeartbeatRow> = {}): HeartbeatRow => ({
  task,
  lastStartedAt: minutesAgo(3),
  lastFinishedAt: minutesAgo(2),
  lastSuccessAt: minutesAgo(2),
  lastStatus: "ok",
  lastDetail: null,
  lastDurationMs: 1200,
  consecutiveFailures: 0,
  runCount: 10,
  ...patch,
});
const ENV = {
  GRADE_CUT_INGESTION_ENABLED: "true",
  INGESTION_ENABLED: "true",
  CRON_SECRET: "x".repeat(32),
};
const byTask = (rows: HeartbeatRow[], env: Record<string, string> = ENV) =>
  Object.fromEntries(evaluateSchedulerHealth(rows, NOW, env).map((t) => [t.task, t]));

const worker = (patch: Partial<WorkerResult> = {}): WorkerResult => ({
  processed: 0,
  completed: 0,
  retrying: 0,
  failed: 0,
  released: 0,
  recovered: 0,
  lost: 0,
  ...patch,
});
const discovery = (status: DiscoveryResult["status"]): DiscoveryResult =>
  ({ runId: null, status, counts: {}, errors: [], releaseTimes: [] }) as unknown as DiscoveryResult;
const scheduled = (patch: Partial<ScheduledResult> = {}): ScheduledResult => ({
  discovery: [],
  releaseWatch: { schedules: [], jobs: null },
  rechecksQueued: 0,
  jobs: worker(),
  ...patch,
});

describe("승인 job worker(jobs) 감시", () => {
  it("cron endpoint 가 켜진 환경에서만 감시하고, 기록이 없으면 never_run 으로 드러난다", () => {
    expect(byTask([])["jobs"]!.state).toBe("never_run");
    expect(byTask([], { ...ENV, CRON_SECRET: "" })["jobs"]!.state).toBe("disabled");
    expect(byTask([], { ...ENV, CRON_SECRET: "short" })["jobs"]!.state).toBe("disabled");
  });

  it("GitHub schedule 지연(2~5시간)은 정상, 8시간 넘게 기록이 없으면 stale", () => {
    const at = (m: number) =>
      byTask([row("jobs", { lastStartedAt: minutesAgo(m), lastFinishedAt: minutesAgo(m) })])[
        "jobs"
      ]!.state;
    expect(at(5 * 60)).toBe("ok");
    expect(at(8 * 60 + 1)).toBe("stale");
  });
});

describe("끝나지 않은 실행(running)은 최근 실행으로 치지 않는다", () => {
  it(`${HUNG_AFTER_MINUTES}분 넘게 running 이면 마지막 종료 시각으로 판정한다`, () => {
    // 등급컷: 30분 전에 시작한 실행이 끝나지 않았고 마지막 종료는 40분 전 → stale (20분 기준)
    const hung = byTask([
      row("grade-cuts", {
        lastStatus: "running",
        lastStartedAt: minutesAgo(30),
        lastFinishedAt: minutesAgo(40),
      }),
    ])["grade-cuts"]!;
    expect(hung.state).toBe("stale");
    expect(hung.minutesSinceSeen).toBe(40);

    // 방금 시작한 실행은 그대로 실행으로 본다
    const running = byTask([
      row("grade-cuts", {
        lastStatus: "running",
        lastStartedAt: minutesAgo(1),
        lastFinishedAt: minutesAgo(40),
      }),
    ])["grade-cuts"]!;
    expect(running.state).toBe("ok");
  });

  it("한 번도 끝난 적 없이 멈춘 task 는 기록 없음이 아니라 stale", () => {
    const t = byTask([
      row("grade-cuts", {
        lastStatus: "running",
        lastStartedAt: minutesAgo(60),
        lastFinishedAt: null,
      }),
    ])["grade-cuts"]!;
    expect(t.state).toBe("stale");
  });
});

describe("cron 결과 → heartbeat: 200 응답과 실제로 한 일을 구분", () => {
  it("advisory lock 경합은 ok 가 아니라 skipped:locked", () => {
    expect(
      scheduledHeartbeat(scheduled({ skipped: "another scheduled run is in progress" })),
    ).toEqual({ status: "skipped", detail: "locked" });
  });

  it("정책상 실행 가능한 source 가 없으면 ok 이지만 no_runnable_sources 로 남긴다", () => {
    expect(scheduledHeartbeat(scheduled())).toEqual({
      status: "ok",
      detail: "no_runnable_sources",
    });
  });

  it("실행한 discovery 가 모두 실패하면 failed (연속 실패 알림 대상)", () => {
    expect(
      scheduledHeartbeat(
        scheduled({
          discovery: [
            { source: "a", result: discovery("failed") },
            { source: "b", result: "not_due" },
          ],
        }),
      ),
    ).toEqual({ status: "failed", detail: "discovery_failed" });
  });

  it("일부 실패 · 영구 실패 job · 소유권을 잃은 job 은 상태 코드로 남긴다", () => {
    expect(
      scheduledHeartbeat(
        scheduled({
          discovery: [
            { source: "a", result: discovery("failed") },
            { source: "b", result: discovery("completed") },
          ],
          jobs: worker({ failed: 1, lost: 1 }),
        }),
      ),
    ).toEqual({ status: "ok", detail: "discovery_partial.jobs_dead.jobs_lost" });
    expect(
      scheduledHeartbeat(scheduled({ discovery: [{ source: "b", result: "not_due" }] })),
    ).toEqual({ status: "ok", detail: undefined });
  });

  it("jobs · release-watch heartbeat", () => {
    expect(jobsHeartbeat(worker())).toEqual({ status: "ok", detail: "queue_worker" });
    expect(jobsHeartbeat(worker({ failed: 2 }))).toEqual({
      status: "ok",
      detail: "queue_worker.jobs_dead",
    });
    expect(releaseWatchHeartbeat({ schedules: [], jobs: null })).toEqual({
      status: "ok",
      detail: "idle",
    });
    expect(
      releaseWatchHeartbeat({
        schedules: [
          { scheduleId: "s", exam: "2026 고3 10월", state: "watching", polled: ["ebsi"] },
        ],
        jobs: worker(),
      }),
    ).toEqual({ status: "ok", detail: "polled" });
  });
});

describe("수집 스위치 값 검증", () => {
  const base = { NEXT_PUBLIC_SITE_URL: "https://mogo.example.com", DATABASE_URL: "postgres://x" };
  const warnings = (value: string | undefined) =>
    checkProductionEnv({ ...base, INGESTION_ENABLED: value }).warnings.join("\n");

  it('"true"/"false"/미설정이 아니면 꺼진 것으로 처리된다고 경고한다 (값은 출력하지 않음)', () => {
    for (const v of ["True", "1", "yes", "TRUE"]) {
      expect(warnings(v)).toMatch(/INGESTION_ENABLED 값이 "true"\/"false" 가 아니라/);
      expect(warnings(v)).not.toContain(`=${v}`);
    }
    for (const v of ["true", "false", undefined, ""])
      expect(warnings(v)).not.toMatch(/INGESTION_ENABLED 값이/);
  });
});
