import { SafeFetcher, type Fetcher } from "../net/fetcher";
import { userAgent } from "../sources/config";
import { featureSupport } from "../sources/policy";
import type { ReviewEvidence } from "./evidence";

/**
 * 후보 URL 존재·형식 확인 (앞 1KB 만 받는다). 정책상 파일 요청이 허용된 호스트만 요청한다.
 * SafeFetcher 가 https · 공식 allowlist · redirect 마다 재검증 · 사설 IP 차단 · robots.txt · 요청 간격을 강제한다.
 * 확인 결과는 근거로만 쓰고, 통과해도 자동 게시하지 않는다.
 */

/** 파일 요청이 허용된 source 의 호스트 (현재 EBSi 파일 서버만) */
const CHECKABLE_HOSTS: Array<{ sourceId: string; hosts: string[] }> = [
  { sourceId: "ebsi", hosts: ["wdown.ebsi.co.kr"] },
];

export function checkableHosts(): string[] {
  return CHECKABLE_HOSTS.filter(
    (c) => featureSupport(c.sourceId, "fetch_file").kind === "adapter",
  ).flatMap((c) => c.hosts);
}

/**
 * 운영자 확인 자료라도 이 호스트의 공개 파일은 내용 추출 작업에서만 SafeFetcher로 재요청할 수 있다.
 * discovery/verify 정책을 완화하는 함수가 아니다.
 */
export function isCheckableFileUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return checkableHosts().some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

export function createUrlCheckFetcher(): Fetcher {
  return new SafeFetcher({
    policy: { allowedHosts: checkableHosts() },
    timeoutMs: 20_000,
    maxConcurrent: 1,
    minGapMs: 1_500,
    maxRetries: 1,
    userAgent: userAgent(),
  });
}

export type UrlCheck =
  { ok: true; evidence: ReviewEvidence } | { ok: false; reason: string; evidence?: ReviewEvidence };

export async function checkCandidateUrl(
  fetcher: Fetcher,
  url: string,
  now = new Date(),
): Promise<UrlCheck> {
  const host = new URL(url).hostname;
  if (!checkableHosts().includes(host))
    return { ok: false, reason: `정책상 요청하지 않는 호스트 (${host}) — 브라우저로 직접 확인` };
  try {
    const res = await fetcher.fetch(url, {
      probeBytes: 1024,
      accept: "application/pdf,audio/mpeg,*/*",
    });
    const head = new TextDecoder("latin1").decode(res.bytes.subarray(0, 5));
    const isPdf = head === "%PDF-";
    const isMp3 = url.endsWith(".mp3");
    const evidence: ReviewEvidence = {
      kind: "url_check",
      status: res.status,
      contentType: res.contentType,
      pdfSignature: isPdf,
      checkedAt: now.toISOString(),
    };
    if (res.status !== 200) return { ok: false, reason: `HTTP ${res.status}`, evidence };
    if (isMp3 ? !/audio|octet-stream/.test(res.contentType) : !isPdf)
      return {
        ok: false,
        reason: `형식 불일치 (${res.contentType || "content-type 없음"})`,
        evidence,
      };
    return { ok: true, evidence };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message.slice(0, 120) : "요청 실패",
    };
  }
}
