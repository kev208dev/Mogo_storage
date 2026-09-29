import { lookup } from "node:dns/promises";
import { RobotsDisallowedError, SourceFetchError, UrlNotAllowedError } from "../errors";
import { isPathAllowed, parseRobots, type RobotsRules } from "./robots";
import {
  assertResolvesPublic,
  assertUrlAllowed,
  type HostResolver,
  type UrlPolicyOptions,
} from "./url-policy";

export interface FetchResult {
  /** redirect 를 따라간 최종 URL */
  url: string;
  status: number;
  contentType: string;
  headers: Headers;
  bytes: Uint8Array;
  /** probeBytes 로 앞부분만 읽고 멈췄으면 true (bytes 는 파일 전체가 아니다) */
  truncated?: boolean;
  /** 서버가 알려준 전체 크기 (content-length). 모르면 null */
  declaredSize?: number | null;
  /** 거쳐 온 redirect (원래 URL 제외, 마지막이 최종 URL) */
  redirects?: string[];
}

export interface FetchOptions {
  maxBytes?: number;
  accept?: string;
  /**
   * metadata 확인용: 앞 N byte 만 읽고 연결을 닫는다 (magic bytes · content-type · 크기 확인).
   * source_redirect 자료처럼 파일 전체가 필요 없을 때 불필요한 전체 다운로드를 피한다.
   */
  probeBytes?: number;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit;
}

/** 외부 source 접근은 모두 이 인터페이스를 통한다 (테스트에서는 fixture fetcher 로 교체) */
export interface Fetcher {
  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
}

export interface SafeFetcherOptions {
  policy: UrlPolicyOptions;
  timeoutMs: number;
  maxConcurrent: number;
  /** 같은 host 로 보내는 요청 사이 최소 간격 */
  minGapMs: number;
  maxRetries: number;
  userAgent: string;
  respectRobots?: boolean;
  maxRedirects?: number;
  /** 주입 가능한 의존성 (테스트용) */
  fetchImpl?: typeof fetch;
  resolveHost?: HostResolver;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultResolver: HostResolver = async (host) =>
  (await lookup(host, { all: true })).map((r) => r.address);

/**
 * 외부 공식 사이트 전용 fetcher.
 *  - allowlist + 내부망 차단 (DNS 조회 포함), redirect 는 매 hop 마다 재검증
 *  - timeout, 응답 크기 제한, 동시 요청 수 제한, host 별 요청 간격
 *  - robots.txt 준수, 5xx/429/네트워크 오류만 재시도 (지수 backoff)
 */
export class SafeFetcher implements Fetcher {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly lastRequestAt = new Map<string, number>();
  private readonly robotsCache = new Map<string, Promise<RobotsRules | null>>();
  private readonly fetchImpl: typeof fetch;
  private readonly resolveHost: HostResolver;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: SafeFetcherOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHost = options.resolveHost ?? defaultResolver;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async fetch(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.withSlot(() => this.fetchOnce(rawUrl, options));
      } catch (error) {
        const retryable = error instanceof SourceFetchError && error.retryable;
        if (!retryable || attempt >= this.options.maxRetries) throw error;
        attempt += 1;
        await this.sleep(Math.min(30_000, 1_000 * 2 ** (attempt - 1)));
      }
    }
  }

  private async fetchOnce(rawUrl: string, options: FetchOptions): Promise<FetchResult> {
    const maxRedirects = this.options.maxRedirects ?? 5;
    let current = rawUrl;
    const redirects: string[] = [];
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const url = assertUrlAllowed(current, this.options.policy);
      await assertResolvesPublic(url, this.resolveHost, this.options.policy);
      if (this.options.respectRobots !== false) await this.assertRobotsAllowed(url);
      await this.waitForHostGap(url.host);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          redirect: "manual",
          signal: controller.signal,
          method: options.method ?? "GET",
          headers: {
            "user-agent": this.options.userAgent,
            accept: options.accept ?? "*/*",
            ...Object.fromEntries(new Headers(options.headers).entries()),
          },
          body: options.body,
        });
      } catch (error) {
        clearTimeout(timer);
        const aborted = error instanceof Error && error.name === "AbortError";
        throw new SourceFetchError(aborted ? "request timed out" : "network error", true);
      }

      if (response.status >= 300 && response.status < 400) {
        clearTimeout(timer);
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location)
          throw new SourceFetchError("redirect without location", false, response.status);
        current = new URL(location, url).toString(); // 다음 hop 에서 allowlist 재검증
        redirects.push(current);
        continue;
      }

      try {
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw new SourceFetchError(
            `HTTP ${response.status}`,
            RETRYABLE_STATUS.has(response.status),
            response.status,
          );
        }
        const declared = Number(response.headers.get("content-length") ?? "");
        const declaredSize = Number.isFinite(declared) && declared > 0 ? declared : null;
        const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        if (options.probeBytes) {
          if (declaredSize !== null && declaredSize > maxBytes) {
            await response.body?.cancel().catch(() => {});
            throw new SourceFetchError(`response too large (${declaredSize} bytes)`, false);
          }
          const { bytes, truncated } = await readHead(response, options.probeBytes);
          return {
            url: url.toString(),
            status: response.status,
            contentType: (response.headers.get("content-type") ?? "").toLowerCase(),
            headers: response.headers,
            bytes,
            truncated,
            declaredSize,
            redirects,
          };
        }
        const bytes = await readLimited(response, maxBytes);
        return {
          url: url.toString(),
          status: response.status,
          contentType: (response.headers.get("content-type") ?? "").toLowerCase(),
          headers: response.headers,
          bytes,
          truncated: false,
          declaredSize,
          redirects,
        };
      } finally {
        clearTimeout(timer);
      }
    }
    throw new UrlNotAllowedError("too many redirects", rawUrl);
  }

  private async assertRobotsAllowed(url: URL) {
    const origin = url.origin;
    if (!this.robotsCache.has(origin)) {
      this.robotsCache.set(origin, this.loadRobots(url));
    }
    const rules = await this.robotsCache.get(origin)!;
    if (rules && !isPathAllowed(rules, url.pathname + url.search)) {
      throw new RobotsDisallowedError(url.toString());
    }
  }

  private async loadRobots(url: URL): Promise<RobotsRules | null> {
    const robotsUrl = new URL("/robots.txt", url.origin);
    try {
      await this.waitForHostGap(url.host);
      const res = await this.fetchImpl(robotsUrl, {
        redirect: "manual", // robots.txt 의 redirect 는 따라가지 않는다 (SSRF 방지)
        signal: AbortSignal.timeout(this.options.timeoutMs),
        headers: { "user-agent": this.options.userAgent },
      });
      if (!res.ok) return null; // robots.txt 없음 → 제한 없음
      const text = new TextDecoder().decode(await readLimited(res, 512 * 1024));
      const rules = parseRobots(text, this.options.userAgent);
      if (rules.crawlDelaySeconds) {
        // crawl-delay 가 설정돼 있으면 host 간격을 그 이상으로
        this.hostGapOverride.set(url.host, rules.crawlDelaySeconds * 1000);
      }
      return rules;
    } catch {
      return null;
    }
  }

  private readonly hostGapOverride = new Map<string, number>();

  private async waitForHostGap(host: string) {
    const gap = Math.max(this.options.minGapMs, this.hostGapOverride.get(host) ?? 0);
    const last = this.lastRequestAt.get(host) ?? 0;
    const wait = last + gap - Date.now();
    this.lastRequestAt.set(host, Math.max(Date.now(), last + gap));
    if (wait > 0) await this.sleep(wait);
  }

  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.options.maxConcurrent) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new SourceFetchError(`response too large (${declared} bytes)`, false);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new SourceFetchError(`response exceeded ${maxBytes} bytes`, false);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** 앞 limit byte 만 읽고 나머지는 받지 않는다 */
async function readHead(
  response: Response,
  limit: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= limit) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const out = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, out.byteLength - offset);
    if (take <= 0) break;
    out.set(c.subarray(0, take), offset);
    offset += take;
  }
  return { bytes: out, truncated };
}

function htmlMetaCharset(bytes: Uint8Array): string | null {
  // HTML encoding declarations are ASCII-compatible, so the first few KB can be
  // inspected safely before the document encoding itself is known.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 8 * 1024));
  return /<meta\b[^>]*charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ?? null;
}

function decoderLabel(charset: string | null): string {
  if (charset === "euc-kr" || charset === "cp949" || charset === "ks_c_5601-1987") {
    return "euc-kr";
  }
  return charset ?? "utf-8";
}

export function decodeHtml(result: FetchResult): string {
  const headerCharset = /charset=([\w-]+)/i.exec(result.contentType)?.[1]?.toLowerCase() ?? null;
  const charset = headerCharset ?? htmlMetaCharset(result.bytes);
  try {
    return new TextDecoder(decoderLabel(charset)).decode(result.bytes);
  } catch {
    return new TextDecoder("utf-8").decode(result.bytes);
  }
}
