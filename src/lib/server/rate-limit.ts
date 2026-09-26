/**
 * 단순 in-memory 고정 윈도우 rate limiter.
 * 단일 인스턴스 기준이며, 다중 인스턴스 배포 시에는 DB(countRecentReports) 기반 제한이 함께 동작한다.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** 허용되면 true 를 돌려주고 기록한다. */
  take(key: string, now = Date.now()): boolean {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(since);
    return true;
  }

  /** 기록하지 않고 한도 초과인지만 본다 (실패만 세는 로그인 제한 등) */
  isBlocked(key: string, now = Date.now()): boolean {
    const since = now - this.windowMs;
    return (this.hits.get(key) ?? []).filter((t) => t > since).length >= this.max;
  }

  /** 시도 1회 기록 */
  record(key: string, now = Date.now()): void {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(since);
  }

  private prune(since: number) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= since)) this.hits.delete(key);
    }
  }
}
