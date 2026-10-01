import { readFile } from "node:fs/promises";
import type { Database } from "../../db/client";
import { scheduleFileSchema, upsertSchedule, type ScheduleInput } from "./schedules";

/** source 에서 발견한 시험 일정 (공식 공지 근거 포함) */
export interface DiscoveredSchedule extends ScheduleInput {
  /** 일정의 출처 표기 (예: "EBSi 연간 시험 일정", 파일 경로) */
  sourceLabel: string;
}

/**
 * 시험 일정 source. 예) EBSi 연도별 시험 일정 페이지, 운영자가 정리한 공식 일정 JSON.
 * adapter 는 일정을 찾아 돌려주기만 하고, DB 반영 여부는 applyDiscoveredSchedules 가 결정한다.
 */
export interface ExamScheduleSource {
  readonly id: string;
  /**
   * 실제 페이지(live fixture)로 parser 가 검증·승인된 source 인지.
   * 검증 전 일정 parser 의 결과는 DB 에 자동 반영하지 않는다 (검토 대기 목록으로만 돌려준다).
   */
  readonly verified: boolean;
  discoverSchedules(year: number): Promise<DiscoveredSchedule[]>;
}

/**
 * 운영자가 공식 공지를 보고 작성한 일정 파일 (data/schedules/*.json).
 * 사람이 근거(announcementUrl)를 확인해 넣은 값이므로 verified 로 취급한다.
 */
export class JsonFileScheduleSource implements ExamScheduleSource {
  readonly id = "manual_json";
  readonly verified = true;
  constructor(private readonly file: string) {}

  async discoverSchedules(year: number): Promise<DiscoveredSchedule[]> {
    const parsed = scheduleFileSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    return parsed.schedules
      .filter((s) => s.year === year)
      .map((s) => ({ ...s, sourceLabel: this.file }));
  }
}

export interface ScheduleApplyResult {
  applied: number;
  /** 검증되지 않은 source 의 일정: DB 에 넣지 않고 관리자 검토용으로 돌려준다 */
  pendingReview: DiscoveredSchedule[];
}

/** 일정 반영. 검증되지 않은 schedule source 는 DB 를 바꾸지 않는다 (verified source gate) */
export async function applyDiscoveredSchedules(
  db: Database,
  source: ExamScheduleSource,
  schedules: DiscoveredSchedule[],
): Promise<ScheduleApplyResult> {
  if (!source.verified) return { applied: 0, pendingReview: schedules };
  let applied = 0;
  for (const s of schedules) {
    const { sourceLabel: _label, ...input } = s;
    void _label;
    await upsertSchedule(db, input, { verifiedBy: source.id });
    applied += 1;
  }
  return { applied, pendingReview: [] };
}
