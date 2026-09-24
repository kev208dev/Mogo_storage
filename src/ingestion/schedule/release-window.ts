/**
 * 시험 당일 자료 공개 감시(release watch) 시간 계산. 모든 시각은 KST(+09:00) 기준으로 해석한다.
 *
 * 기본값 (일정에 expectedRelease 가 없을 때):
 *  - 시작: 시험일 12:00 KST (1교시 국어 종료 이후 문제지 공개가 시작될 수 있음)
 *  - 종료: 시험 다음 날 23:59 KST (해설·음원이 다음 날 올라오는 경우 대비)
 */
export interface ReleaseWindowInput {
  examDate: string; // YYYY-MM-DD
  expectedReleaseStart?: string | Date | null;
  expectedReleaseEnd?: string | Date | null;
}

export interface ReleaseWindow {
  start: Date;
  end: Date;
}

export const DEFAULT_RELEASE_START_KST = "12:00";
export const DEFAULT_RELEASE_END_DAYS_AFTER = 1;

export function kstDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+09:00`);
}

export function computeReleaseWindow(input: ReleaseWindowInput): ReleaseWindow {
  const start = input.expectedReleaseStart
    ? new Date(input.expectedReleaseStart)
    : kstDate(input.examDate, DEFAULT_RELEASE_START_KST);
  let end: Date;
  if (input.expectedReleaseEnd) {
    end = new Date(input.expectedReleaseEnd);
  } else {
    const d = kstDate(input.examDate, "23:59");
    end = new Date(d.getTime() + DEFAULT_RELEASE_END_DAYS_AFTER * 24 * 60 * 60 * 1000);
  }
  if (end <= start) end = new Date(start.getTime() + 6 * 60 * 60 * 1000);
  return { start, end };
}

export function isWithinWindow(window: ReleaseWindow, now: Date): boolean {
  return now >= window.start && now <= window.end;
}

/**
 * source 별 최소 요청 간격을 지키는지. release watch 중에도 source 에 과도한 요청을 보내지 않는다.
 * floorSeconds: 설정 실수로 너무 짧게 잡혀도 이보다 자주 요청하지 않는다.
 */
export function isPollDue(
  lastRunAt: Date | null,
  minIntervalSeconds: number,
  now: Date,
  floorSeconds = 120,
): boolean {
  if (!lastRunAt) return true;
  const interval = Math.max(minIntervalSeconds, floorSeconds) * 1000;
  return now.getTime() - lastRunAt.getTime() >= interval;
}

/** 평상시 정기 수집 간격 (release watch 가 아닐 때) */
export const SCHEDULED_DISCOVERY_INTERVAL_SECONDS = 6 * 60 * 60;
