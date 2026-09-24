import { isIP } from "node:net";
import { UrlNotAllowedError } from "../errors";

export interface UrlPolicyOptions {
  allowedHosts: string[];
  /** 테스트용 로컬 mock 서버 허용. 운영에서는 절대 켜지 않는다. */
  allowPrivateNetwork?: boolean;
  allowHttp?: boolean;
}

/** host 가 allowlist 에 있는지. ".example.com" 은 하위 도메인 허용 */
export function isHostAllowed(host: string, allowedHosts: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((rule) => {
    const r = rule.toLowerCase();
    return r.startsWith(".") ? h.endsWith(r) || h === r.slice(1) : h === r;
  });
}

/** RFC1918, loopback, link-local, CGNAT, multicast, IPv6 ULA 등 내부 주소 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(ip) === 6) {
    if (ip === "::" || ip === "::1") return true;
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // ULA
    if (/^fe[89ab]/.test(ip)) return true; // link-local
    if (ip.startsWith("ff")) return true; // multicast
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return false;
  }
  return false;
}

/** 요청 전 URL 검증: 프로토콜, 자격증명 포함 여부, host allowlist, IP literal */
export function assertUrlAllowed(raw: string, options: UrlPolicyOptions): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlNotAllowedError("invalid url", raw);
  }
  const allowHttp = options.allowHttp ?? true;
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new UrlNotAllowedError("protocol", raw);
  }
  if (url.username || url.password) throw new UrlNotAllowedError("credentials in url", raw);
  const host = url.hostname;
  if (
    isIP(host.replace(/^\[|\]$/g, "")) &&
    isPrivateAddress(host) &&
    !options.allowPrivateNetwork
  ) {
    throw new UrlNotAllowedError("private address", raw);
  }
  if (!isHostAllowed(host, options.allowedHosts)) {
    throw new UrlNotAllowedError("host not in allowlist", raw);
  }
  return url;
}

export type HostResolver = (host: string) => Promise<string[]>;

/** DNS 조회 결과가 내부망이면 차단 (DNS 로 우회하는 SSRF 방지) */
export async function assertResolvesPublic(
  url: URL,
  resolve: HostResolver,
  options: Pick<UrlPolicyOptions, "allowPrivateNetwork">,
): Promise<void> {
  if (options.allowPrivateNetwork) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (addresses.length === 0) throw new UrlNotAllowedError("dns returned no address", url.href);
  if (addresses.some(isPrivateAddress)) {
    throw new UrlNotAllowedError("resolves to private address", url.href);
  }
}
