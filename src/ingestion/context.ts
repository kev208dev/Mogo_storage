import type { Database } from "../db/client";
import type { StorageProvider } from "../lib/storage/types";
import type { IngestionLogger } from "./logger";
import type { OpsNotifier } from "./notifier";
import type { AdapterFactoryOptions } from "./sources/registry";

/** 공개 페이지 캐시 무효화 (Next 런타임: revalidatePath / CLI: HTTP 호출 / 테스트: 기록만) */
export interface Revalidator {
  revalidatePaths(paths: string[]): Promise<void>;
}

export const noopRevalidator: Revalidator = { async revalidatePaths() {} };

/** 모든 수집 로직이 받는 의존성 묶음. scheduler(cron, CLI, 테스트)와 무관하다. */
export interface IngestionContext {
  db: Database;
  logger: IngestionLogger;
  notifier: OpsNotifier;
  storage: StorageProvider;
  revalidator: Revalidator;
  now: () => Date;
  /** adapter/fetcher 생성 옵션 (테스트에서 mock fetcher, 로컬 mock 서버 허용 등) */
  adapterOptions?: AdapterFactoryOptions;
  /** 작업자 식별자 (job lock 기록용) */
  workerId: string;
  /**
   * 테스트 전용: 실제 fixture 검증 전의 source 로도 수집을 허용한다.
   * 코드에서만 설정할 수 있고 환경변수·CLI 로는 켤 수 없다 (운영 우회 방지).
   */
  allowUnverifiedSources?: boolean;
}

/** HTTP 로 Next 앱의 revalidate endpoint 를 호출 (CLI/외부 scheduler 에서 실행할 때) */
export function httpRevalidator(
  siteUrl: string | undefined,
  secret: string | undefined,
): Revalidator {
  if (!siteUrl || !secret) return noopRevalidator;
  return {
    async revalidatePaths(paths) {
      if (paths.length === 0) return;
      await fetch(new URL("/api/internal/revalidate", siteUrl), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({ paths }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {});
    },
  };
}
