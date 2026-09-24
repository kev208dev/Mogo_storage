import { describe, expect, it } from "vitest";
import { UrlNotAllowedError } from "@/ingestion/errors";
import { sanitizeFields } from "@/ingestion/logger";
import { isPathAllowed, parseRobots } from "@/ingestion/net/robots";
import { SafeFetcher } from "@/ingestion/net/fetcher";
import {
  assertResolvesPublic,
  assertUrlAllowed,
  isHostAllowed,
  isPrivateAddress,
} from "@/ingestion/net/url-policy";
import { sanitizeFileName, validateArtifact } from "@/ingestion/verify/artifact-validator";
import { createPlaceholderPdf } from "@/lib/storage/mock-files";

const policy = { allowedHosts: ["www.ebsi.co.kr", "wdown.ebsi.co.kr", ".suneung.re.kr"] };

describe("source URL allowlist", () => {
  it("allows listed hosts and subdomain rules", () => {
    expect(isHostAllowed("www.ebsi.co.kr", policy.allowedHosts)).toBe(true);
    expect(isHostAllowed("files.suneung.re.kr", policy.allowedHosts)).toBe(true);
    expect(isHostAllowed("suneung.re.kr", policy.allowedHosts)).toBe(true);
    expect(isHostAllowed("ebsi.co.kr.evil.com", policy.allowedHosts)).toBe(false);
    expect(isHostAllowed("evilsuneung.re.kr", policy.allowedHosts)).toBe(false);
  });

  it.each([
    ["https://evil.example.com/a.pdf", "host not in allowlist"],
    ["ftp://www.ebsi.co.kr/a.pdf", "protocol"],
    ["file:///etc/passwd", "protocol"],
    ["https://user:pw@www.ebsi.co.kr/a.pdf", "credentials in url"],
    ["http://127.0.0.1/admin", "private address"],
    ["http://169.254.169.254/latest/meta-data", "private address"],
    ["http://[::1]/", "private address"],
  ])("rejects %s", (url, reason) => {
    expect(() => assertUrlAllowed(url, policy)).toThrow(UrlNotAllowedError);
    try {
      assertUrlAllowed(url, policy);
    } catch (e) {
      expect((e as UrlNotAllowedError).details.reason).toBe(reason);
    }
  });

  it("detects private addresses", () => {
    for (const ip of [
      "10.0.0.1",
      "172.16.5.4",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::ffff:127.0.0.1",
      "fd00::1",
      "fe80::1",
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "211.43.1.1", "2001:4860::8888"])
      expect(isPrivateAddress(ip)).toBe(false);
  });

  it("blocks DNS names that resolve to internal addresses", async () => {
    const url = new URL("https://www.ebsi.co.kr/a.pdf");
    await expect(assertResolvesPublic(url, async () => ["10.1.2.3"], {})).rejects.toThrow(
      /private/,
    );
    await expect(
      assertResolvesPublic(url, async () => ["211.43.1.1"], {}),
    ).resolves.toBeUndefined();
  });
});

describe("SafeFetcher redirects", () => {
  const base = {
    policy,
    timeoutMs: 1000,
    maxConcurrent: 1,
    minGapMs: 0,
    maxRetries: 0,
    userAgent: "TestBot",
    respectRobots: false,
    resolveHost: async () => ["211.43.1.1"],
    sleep: async () => {},
  };

  it("re-validates the domain after a redirect (malicious redirect)", async () => {
    const fetchImpl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/secret" },
      })) as unknown as typeof fetch;
    const fetcher = new SafeFetcher({ ...base, fetchImpl });
    await expect(fetcher.fetch("https://www.ebsi.co.kr/a.pdf")).rejects.toThrow(UrlNotAllowedError);
  });

  it("follows allowed redirects", async () => {
    let calls = 0;
    const fetchImpl = (async (url: URL) => {
      calls += 1;
      if (url.hostname === "www.ebsi.co.kr") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://wdown.ebsi.co.kr/f.pdf" },
        });
      }
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    }) as unknown as typeof fetch;
    const res = await new SafeFetcher({ ...base, fetchImpl }).fetch("https://www.ebsi.co.kr/a.pdf");
    expect(res.url).toBe("https://wdown.ebsi.co.kr/f.pdf");
    expect(calls).toBe(2);
  });

  it("rejects oversized responses", async () => {
    const fetchImpl = (async () =>
      new Response("x".repeat(100), {
        status: 200,
        headers: { "content-length": "100" },
      })) as unknown as typeof fetch;
    await expect(
      new SafeFetcher({ ...base, fetchImpl }).fetch("https://www.ebsi.co.kr/a.pdf", {
        maxBytes: 10,
      }),
    ).rejects.toThrow(/too large/);
  });

  it("retries 503 then succeeds, but never retries 404", async () => {
    let n = 0;
    const flaky = (async () => {
      n += 1;
      return n === 1 ? new Response("", { status: 503 }) : new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      new SafeFetcher({ ...base, maxRetries: 2, fetchImpl: flaky }).fetch(
        "https://www.ebsi.co.kr/x",
      ),
    ).resolves.toMatchObject({ status: 200 });
    let m = 0;
    const missing = (async () => {
      m += 1;
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    await expect(
      new SafeFetcher({ ...base, maxRetries: 3, fetchImpl: missing }).fetch(
        "https://www.ebsi.co.kr/x",
      ),
    ).rejects.toThrow(/404/);
    expect(m).toBe(1);
  });

  it("honours robots.txt", async () => {
    const fetchImpl = (async (url: URL) =>
      url.pathname === "/robots.txt"
        ? new Response("User-agent: *\nDisallow: /private/\n", { status: 200 })
        : new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const fetcher = new SafeFetcher({ ...base, respectRobots: true, fetchImpl });
    await expect(fetcher.fetch("https://www.ebsi.co.kr/private/a.pdf")).rejects.toThrow(/robots/);
    await expect(fetcher.fetch("https://www.ebsi.co.kr/public/a.pdf")).resolves.toMatchObject({
      status: 200,
    });
  });
});

describe("robots.txt parser", () => {
  it("longest match wins, allow on tie", () => {
    const rules = parseRobots(
      "User-agent: *\nDisallow: /ebs/\nAllow: /ebs/xip/\n",
      "MogoStorageBot/1.0",
    );
    expect(isPathAllowed(rules, "/ebs/xip/xipc/list.ebs")).toBe(true);
    expect(isPathAllowed(rules, "/ebs/other")).toBe(false);
    expect(isPathAllowed(rules, "/")).toBe(true);
  });
});

describe("artifact validation", () => {
  const pdf = createPlaceholderPdf(["x".repeat(40), "y".repeat(40)]);
  const bigPdf = new Uint8Array(4096);
  bigPdf.set(pdf);

  it("accepts a PDF and returns SHA-256", () => {
    const r = validateArtifact({
      status: 200,
      contentType: "application/pdf",
      bytes: bigPdf,
      expected: "pdf",
    });
    expect(r.ok && r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    [
      "zero-byte",
      { status: 200, contentType: "application/pdf", bytes: new Uint8Array() },
      "EMPTY_FILE",
    ],
    [
      "html error page",
      {
        status: 200,
        contentType: "application/pdf",
        bytes: new TextEncoder().encode(
          "<!DOCTYPE html><html><body>로그인이 필요합니다</body></html>".padEnd(2000),
        ),
      },
      "HTML_RESPONSE",
    ],
    [
      "text/html content-type",
      { status: 200, contentType: "text/html; charset=utf-8", bytes: bigPdf },
      "HTML_RESPONSE",
    ],
    [
      "wrong magic",
      { status: 200, contentType: "application/pdf", bytes: new Uint8Array(4096).fill(65) },
      "INVALID_MAGIC",
    ],
    ["bad status", { status: 500, contentType: "application/pdf", bytes: bigPdf }, "HTTP_STATUS"],
    [
      "invalid mime",
      { status: 200, contentType: "image/png", bytes: bigPdf },
      "CONTENT_TYPE_MISMATCH",
    ],
    [
      "tiny file",
      { status: 200, contentType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4") },
      "TOO_SMALL",
    ],
  ])("rejects %s", (_name, input, code) => {
    const r = validateArtifact({ ...input, expected: "pdf" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it("accepts ID3 mp3 and rejects PDF as audio", () => {
    const mp3 = new Uint8Array(8192);
    mp3.set([0x49, 0x44, 0x33]);
    expect(
      validateArtifact({ status: 200, contentType: "audio/mpeg", bytes: mp3, expected: "audio" })
        .ok,
    ).toBe(true);
    expect(
      validateArtifact({ status: 200, contentType: "audio/mpeg", bytes: bigPdf, expected: "audio" })
        .ok,
    ).toBe(false);
  });

  it("sanitizes untrusted file names (path traversal)", () => {
    expect(sanitizeFileName("../../etc/passwd", "f.pdf")).toBe("passwd");
    expect(sanitizeFileName("..\\..\\win.ini", "f.pdf")).toBe("win.ini");
    expect(sanitizeFileName("\u0000", "fallback.pdf")).toBe("fallback.pdf");
    expect(sanitizeFileName("국어<script>.pdf", "f.pdf")).toBe("국어script.pdf");
  });
});

describe("log redaction", () => {
  it("drops query strings and sensitive keys", () => {
    expect(
      sanitizeFields({
        url: "https://x.r2.cloudflarestorage.com/a.pdf?X-Amz-Signature=abc",
        secret: "s",
        cronSecret: "c",
        storageKey: "exams/a.pdf",
      }),
    ).toEqual({
      url: "https://x.r2.cloudflarestorage.com/a.pdf?[redacted]",
      secret: "[redacted]",
      cronSecret: "[redacted]",
      storageKey: "exams/a.pdf",
    });
  });
});
