import { SafeFetcher, type Fetcher } from "../net/fetcher";
import type { ExamSourceAdapter, SourceConfig } from "../types";
import { EbsiExamSource } from "./ebsi/adapter";
import { EducationOfficeExamSource } from "./education-office/adapter";
import { KiceExamSource } from "./kice/adapter";
import { BUILTIN_SOURCES, userAgent } from "./config";

export interface AdapterFactoryOptions {
  /** 기본은 SafeFetcher. 테스트/드라이런은 FixtureFetcher 등으로 교체 */
  fetcher?: Fetcher;
  now?: () => Date;
  /** 테스트용 로컬 mock 서버 허용 (운영 금지) */
  allowPrivateNetwork?: boolean;
}

export function createFetcherFor(
  source: SourceConfig,
  options: AdapterFactoryOptions = {},
): Fetcher {
  return (
    options.fetcher ??
    new SafeFetcher({
      policy: {
        allowedHosts: source.allowedHosts.length
          ? source.allowedHosts
          : [new URL(source.baseUrl).hostname],
        allowPrivateNetwork: options.allowPrivateNetwork,
      },
      timeoutMs: source.requestTimeoutMs,
      maxConcurrent: source.maxConcurrentRequests,
      minGapMs: source.minRequestGapMs,
      maxRetries: source.maxRetries,
      userAgent: userAgent(),
    })
  );
}

/** source 설정 → adapter. kind 별로 구현을 고른다 */
export function createAdapter(
  source: SourceConfig,
  options: AdapterFactoryOptions = {},
): ExamSourceAdapter {
  const fetcher = createFetcherFor(source, options);
  switch (source.kind) {
    case "ebsi":
      return new EbsiExamSource(source, fetcher, options.now);
    case "kice":
      return new KiceExamSource(source, fetcher, options.now);
    case "education_office":
      return new EducationOfficeExamSource(source, fetcher, options.now);
    default:
      throw new Error(`No adapter implemented for source kind "${source.kind}"`);
  }
}

export function builtinSource(id: string): SourceConfig | undefined {
  return BUILTIN_SOURCES.find((s) => s.id === id);
}

/** 환경변수 SOURCE_<ID>_ENABLED 로 코드 기본값을 덮어쓴다 (DB 값이 최종) */
export function envEnabled(sourceId: string, env: NodeJS.ProcessEnv = process.env): boolean | null {
  const value = env[`SOURCE_${sourceId.toUpperCase()}_ENABLED`];
  if (value === undefined || value === "") return null;
  return value === "true" || value === "1";
}
