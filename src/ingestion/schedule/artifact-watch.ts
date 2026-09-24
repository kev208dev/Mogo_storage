import { and, eq, isNotNull } from "drizzle-orm";
import type { Database } from "../../db/client";
import {
  artifactWatchStates,
  courses,
  examFiles,
  examSubjects,
  sourceArtifacts,
} from "../../db/schema";
import type { FileType, Subject } from "../../lib/constants";
import { COURSE_BASED_SUBJECTS } from "../../lib/courses";
import type { DiscoveredReleaseTime } from "../types";
import { computeReleaseWindow, type ReleaseWindowInput } from "./release-window";

/**
 * 자료 단위(시험 · 영역 · 세부과목 · 종류) release watch.
 *
 * 확인 시작 시각(artifactExpectedAt) 우선순위:
 *   1. source 가 제공한 공식 공개 시각 (예: KICE 표의 "국어 10:56")
 *   2. 일정 metadata (exam_schedules.expected_release_start)
 *   3. 기본 공개 시간대 시작 (시험일 12:00 KST)
 * 공식 시각은 시험마다 다르므로 코드에 고정하지 않는다.
 *
 * 공개 예정 2분 전부터 낮은 빈도로, 공개 예정 이후에는 source 최소 간격으로 확인한다.
 * 확보한 자료(found)는 다시 확인하지 않는다 — 영어 음원이 늦어도 이미 받은 문제지를 반복 요청하지 않는다.
 */
export const PRE_RELEASE_LEAD_MS = 2 * 60 * 1000;
/** 공개 예정 후 이 시간이 지나도 안 나온 자료는 간격을 늘린다 */
export const BACKOFF_AFTER_MS = 2 * 60 * 60 * 1000;
/** 공식 공개 시각 표를 아직 못 읽었을 때, 시험일 동안 표를 다시 읽는 간격 */
export const RELEASE_INDEX_REFRESH_SECONDS = 60 * 60;
/** 어떤 설정이든 이보다 자주 요청하지 않는다 */
export const POLL_FLOOR_SECONDS = 120;

export type WatchStatus = "waiting" | "found" | "missed";
export type ExpectedSource = "official" | "schedule" | "fallback";

export interface WatchSlot {
  subject: Subject;
  slotKey: string;
  type: FileType;
  status: WatchStatus;
  expectedAt: Date | null;
  expectedSource: ExpectedSource | string;
}

export type PollPhase =
  "complete" | "idle" | "fetch_release_times" | "pre_release" | "released" | "backoff";

export interface PollPlan {
  phase: PollPhase;
  due: boolean;
  intervalSeconds: number;
  /** 지금 확인 대상인 자료 (waiting + 확인 시작 시각이 지난 것) */
  active: WatchSlot[];
  waiting: number;
  /** 다음에 확인이 필요해지는 시각 (idle 일 때) */
  nextAt: Date | null;
}

/** 자료가 있어야 할 슬롯 (영어는 듣기 음원 포함). 세부과목 슬롯은 공식 표가 알려줄 때 추가된다 */
export function expectedSlots(subjects: Subject[]) {
  return subjects.flatMap((subject) => [
    { subject, type: "question" as const },
    { subject, type: "solution" as const },
    ...(subject === "english" ? [{ subject, type: "listening_audio" as const }] : []),
  ]);
}

/** 확인 시작 기준 시각: 공식 > 일정 > 기본값 */
export function effectiveExpectedAt(input: {
  official?: Date | null;
  schedule?: Date | null;
  fallback: Date;
}): { at: Date; source: ExpectedSource } {
  if (input.official) return { at: input.official, source: "official" };
  if (input.schedule) return { at: input.schedule, source: "schedule" };
  return { at: input.fallback, source: "fallback" };
}

/**
 * 순수 함수: 지금 source 를 확인해야 하는지.
 *  - 남은(waiting) 자료가 없으면 complete → 더 이상 요청하지 않는다
 *  - 공식 공개 시각 표가 있는데 아직 못 읽었으면 fetch_release_times (1시간 간격)
 *  - 확인 시작 2분 전 ~ 공개 예정: pre_release (최소 간격의 2배, 낮은 빈도)
 *  - 공개 예정 이후: released (source 최소 간격)
 *  - 공식 공개 시각 2시간 후에도 없으면: backoff (최소 간격의 3배)
 */
export function planPoll(input: {
  states: WatchSlot[];
  now: Date;
  minIntervalSeconds: number;
  lastPolledAt: Date | null;
  /** 이 시험의 공식 공개 시각 표 페이지가 등록돼 있고 아직 공식 시각을 모를 때 */
  needsReleaseTimes?: boolean;
}): PollPlan {
  const { now } = input;
  const base = Math.max(input.minIntervalSeconds, POLL_FLOOR_SECONDS);
  const waiting = input.states.filter((s) => s.status === "waiting");
  const plan = (
    phase: PollPhase,
    intervalSeconds: number,
    active: WatchSlot[],
    nextAt: Date | null = null,
  ): PollPlan => ({
    phase,
    intervalSeconds,
    active,
    waiting: waiting.length,
    nextAt,
    due:
      phase !== "complete" &&
      phase !== "idle" &&
      (!input.lastPolledAt ||
        now.getTime() - input.lastPolledAt.getTime() >= intervalSeconds * 1000),
  });
  if (waiting.length === 0) return plan("complete", 0, []);

  const active = waiting.filter(
    (s) => s.expectedAt && s.expectedAt.getTime() - PRE_RELEASE_LEAD_MS <= now.getTime(),
  );
  if (active.length === 0) {
    if (input.needsReleaseTimes)
      return plan("fetch_release_times", Math.max(base, RELEASE_INDEX_REFRESH_SECONDS), []);
    const next = waiting
      .map((s) => s.expectedAt?.getTime())
      .filter((t): t is number => t !== undefined)
      .sort((a, b) => a - b)[0];
    return plan("idle", 0, [], next ? new Date(next - PRE_RELEASE_LEAD_MS) : null);
  }
  const released = active.filter((s) => s.expectedAt!.getTime() <= now.getTime());
  if (released.length === 0) return plan("pre_release", base * 2, active);
  // 공식 공개 시각이 지났는데 오래 안 나오면 간격을 늘린다 (기본 공개 시간대는 원래 넓게 잡은 값이라 제외)
  const official = released.filter((s) => s.expectedSource === "official");
  const freshest = Math.max(...official.map((s) => s.expectedAt!.getTime()));
  if (official.length === released.length && now.getTime() - freshest > BACKOFF_AFTER_MS)
    return plan("backoff", base * 3, active);
  return plan("released", base, active);
}

// ── DB ──────────────────────────────────────────────────────────────

export type WatchStateRow = typeof artifactWatchStates.$inferSelect;

export interface ScheduleForWatch extends ReleaseWindowInput {
  examId: string | null;
}

/** 일정에 대한 자료 단위 감시 상태를 만든다 (idempotent). 이미 있는 행은 건드리지 않는다 */
export async function ensureWatchStates(
  db: Pick<Database, "select" | "insert">,
  schedule: ScheduleForWatch,
): Promise<void> {
  if (!schedule.examId) return;
  const subjects = (
    await db
      .select({ subject: examSubjects.subject })
      .from(examSubjects)
      .where(eq(examSubjects.examId, schedule.examId))
  ).map((r) => r.subject);
  const window = computeReleaseWindow({ examDate: schedule.examDate });
  const expected = effectiveExpectedAt({
    schedule: schedule.expectedReleaseStart ? new Date(schedule.expectedReleaseStart) : null,
    fallback: window.start,
  });
  const slots = expectedSlots(subjects);
  if (slots.length === 0) return;
  await db
    .insert(artifactWatchStates)
    .values(
      slots.map((slot) => ({
        examId: schedule.examId!,
        subject: slot.subject,
        slotKey: "",
        type: slot.type,
        expectedAt: expected.at,
        expectedSource: expected.source,
      })),
    )
    .onConflictDoNothing();
}

export async function loadWatchStates(
  db: Pick<Database, "select">,
  examId: string,
): Promise<WatchStateRow[]> {
  return db.select().from(artifactWatchStates).where(eq(artifactWatchStates.examId, examId));
}

/**
 * source 가 알려준 공식 공개 시각 반영. 세부과목 시각(예: 사회·문화 20:15)은 세부과목 슬롯을 만든다.
 * 이미 확보한(found) 슬롯은 바꾸지 않는다.
 */
export async function applyOfficialReleaseTimes(
  db: Pick<Database, "select" | "insert" | "update">,
  input: { examId: string; sourceId: string; times: DiscoveredReleaseTime[]; now: Date },
): Promise<number> {
  let applied = 0;
  for (const t of input.times) {
    if (!t.officialReleaseAt) continue;
    const at = new Date(t.officialReleaseAt);
    const course =
      t.course.status === "resolved" && COURSE_BASED_SUBJECTS.includes(t.subject)
        ? t.course.code
        : null;
    const slotKey = course ?? "";
    const types: FileType[] =
      t.subject === "english"
        ? ["question", "solution", "listening_audio"]
        : ["question", "solution"];
    let courseId: string | null = null;
    if (course) {
      const [row] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(eq(courses.code, course));
      courseId = row?.id ?? null;
      if (!courseId) continue;
    }
    for (const type of types) {
      await db
        .insert(artifactWatchStates)
        .values({
          examId: input.examId,
          subject: t.subject,
          courseId,
          slotKey,
          type,
          expectedAt: at,
          officialReleaseAt: at,
          expectedSource: "official",
          releaseSourceId: input.sourceId,
        })
        .onConflictDoNothing();
      await db
        .update(artifactWatchStates)
        .set({
          expectedAt: at,
          officialReleaseAt: at,
          expectedSource: "official",
          releaseSourceId: input.sourceId,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(artifactWatchStates.examId, input.examId),
            eq(artifactWatchStates.subject, t.subject),
            eq(artifactWatchStates.slotKey, slotKey),
            eq(artifactWatchStates.type, type),
            eq(artifactWatchStates.status, "waiting"),
          ),
        );
      applied += 1;
    }
  }
  return applied;
}

/** 확인한 슬롯에 polling 기록 */
export async function markPolled(
  db: Pick<Database, "update">,
  states: Array<Pick<WatchStateRow, "id" | "pollCount">>,
  now: Date,
) {
  for (const s of states) {
    await db
      .update(artifactWatchStates)
      .set({ lastPolledAt: now, pollCount: s.pollCount + 1, updatedAt: now })
      .where(eq(artifactWatchStates.id, s.id));
  }
}

/**
 * 공개된 자료(exam_files)가 있는 슬롯을 found 로, 감시 시간이 끝났는데 없는 슬롯은 missed 로.
 * 영역 슬롯("")은 그 영역의 어떤 세부과목 파일이든 있으면 found.
 */
export async function refreshWatchStates(
  db: Pick<Database, "select" | "update">,
  input: { examId: string; now: Date; windowEnd?: Date | null },
): Promise<{ found: number; missed: number; waiting: number; newlyMissed: WatchStateRow[] }> {
  const states = await loadWatchStates(db, input.examId);
  const files = await db
    .select({
      subject: examFiles.subject,
      type: examFiles.type,
      courseCode: courses.code,
      sourceId: sourceArtifacts.sourceId,
    })
    .from(examFiles)
    .leftJoin(courses, eq(courses.id, examFiles.courseId))
    .leftJoin(sourceArtifacts, eq(sourceArtifacts.id, examFiles.sourceArtifactId))
    .where(eq(examFiles.examId, input.examId));
  let found = 0;
  let missed = 0;
  let waiting = 0;
  const newlyMissed: WatchStateRow[] = [];
  for (const s of states) {
    if (s.status !== "waiting") {
      if (s.status === "found") found += 1;
      else missed += 1;
      continue;
    }
    const file = files.find(
      (f) =>
        f.subject === s.subject &&
        f.type === s.type &&
        (s.slotKey === "" || f.courseCode === s.slotKey),
    );
    if (file) {
      await db
        .update(artifactWatchStates)
        .set({
          status: "found",
          foundAt: input.now,
          foundSourceId: file.sourceId ?? null,
          updatedAt: input.now,
        })
        .where(eq(artifactWatchStates.id, s.id));
      found += 1;
    } else if (input.windowEnd && input.now > input.windowEnd) {
      await db
        .update(artifactWatchStates)
        .set({ status: "missed", updatedAt: input.now })
        .where(eq(artifactWatchStates.id, s.id));
      missed += 1;
      newlyMissed.push(s);
    } else {
      waiting += 1;
    }
  }
  return { found, missed, waiting, newlyMissed };
}

/** 공식 공개 시각을 하나라도 알고 있는지 */
export async function hasOfficialTimes(db: Pick<Database, "select">, examId: string) {
  const rows = await db
    .select({ id: artifactWatchStates.id })
    .from(artifactWatchStates)
    .where(
      and(eq(artifactWatchStates.examId, examId), isNotNull(artifactWatchStates.officialReleaseAt)),
    )
    .limit(1);
  return rows.length > 0;
}

export function toWatchSlots(rows: WatchStateRow[]): WatchSlot[] {
  return rows.map((r) => ({
    subject: r.subject,
    slotKey: r.slotKey,
    type: r.type,
    status: r.status as WatchStatus,
    expectedAt: r.expectedAt,
    expectedSource: r.expectedSource,
  }));
}
