import { describe, expect, it } from "vitest";
import { SafeFetcher } from "@/ingestion/net/fetcher";
import { validateArtifactProbe, PROBE_BYTES } from "@/ingestion/verify/artifact-validator";

const ALLOWED = ["www.ebsi.co.kr", "wdown.ebsi.co.kr"];
const pdfHead = () => {
  const bytes = new Uint8Array(PROBE_BYTES);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  return bytes;
};
const probe = (over: Partial<Parameters<typeof validateArtifactProbe>[0]> = {}) =>
  validateArtifactProbe({
    status: 200,
    contentType: "application/pdf",
    headBytes: pdfHead(),
    truncated: true,
    declaredSize: 2_500_000,
    finalUrl: "https://wdown.ebsi.co.kr/exam/q.pdf",
    allowedHosts: ALLOWED,
    expected: "pdf",
    etag: '"abc"',
    ...over,
  });

describe("metadata(probe) 검증 — 파일 전체를 받지 않음", () => {
  it("status · content-type · magic bytes · 크기(content-length) · 최종 도메인이 맞으면 통과", () => {
    const r = probe();
    expect(r).toMatchObject({ ok: true, size: 2_500_000, mimeType: "application/pdf" });
    expect(r.ok && r.fingerprint).toMatch(/^probe:[0-9a-f]{40}$/);
  });

  it("redirect 최종 목적지가 허용 도메인이 아니면 실패", () => {
    expect(probe({ finalUrl: "https://cdn.example.com/q.pdf" })).toMatchObject({
      ok: false,
      code: "UNEXPECTED_DOMAIN",
    });
  });

  it("HTML 오류 페이지 / 잘못된 magic / content-type 불일치 / 너무 큰 파일", () => {
    const html = new TextEncoder().encode("<!doctype html><html>로그인이 필요합니다</html>");
    expect(probe({ headBytes: html, truncated: false, contentType: "text/html" })).toMatchObject({
      code: "HTML_RESPONSE",
    });
    expect(
      probe({ headBytes: new Uint8Array(PROBE_BYTES).fill(0x41), contentType: "" }),
    ).toMatchObject({ code: "INVALID_MAGIC" });
    expect(probe({ contentType: "image/png" })).toMatchObject({ code: "CONTENT_TYPE_MISMATCH" });
    expect(probe({ declaredSize: 500 * 1024 * 1024 })).toMatchObject({ code: "TOO_LARGE" });
  });

  it("ETag·크기가 같으면 같은 fingerprint, 바뀌면 다른 fingerprint (내용 변경 감지)", () => {
    const a = probe();
    const b = probe();
    const c = probe({ etag: '"def"' });
    expect(a.ok && b.ok && a.fingerprint === b.fingerprint).toBe(true);
    expect(a.ok && c.ok && a.fingerprint !== c.fingerprint).toBe(true);
  });
});

describe("SafeFetcher probeBytes", () => {
  const base = {
    policy: { allowedHosts: ALLOWED },
    timeoutMs: 1000,
    maxConcurrent: 1,
    minGapMs: 0,
    maxRetries: 0,
    userAgent: "TestBot",
    respectRobots: false,
    resolveHost: async () => ["211.43.1.1"],
    sleep: async () => {},
  };

  it("앞부분만 읽고 연결을 닫는다 (큰 파일 전체를 받지 않음), redirect 경로를 기록", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024);
    chunk.set(new TextEncoder().encode("%PDF-1.5"));
    const fetchImpl = (async (url: URL) => {
      if (url.hostname === "www.ebsi.co.kr") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://wdown.ebsi.co.kr/big.pdf" },
        });
      }
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          if (pulled > 200) controller.close();
          else controller.enqueue(chunk);
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": String(200 * 65536) },
      });
    }) as unknown as typeof fetch;
    const res = await new SafeFetcher({ ...base, fetchImpl }).fetch(
      "https://www.ebsi.co.kr/down?id=1",
      { probeBytes: PROBE_BYTES, maxBytes: 60 * 1024 * 1024 },
    );
    expect(res.truncated).toBe(true);
    expect(res.bytes.byteLength).toBe(PROBE_BYTES);
    expect(res.declaredSize).toBe(200 * 65536);
    expect(res.redirects).toEqual(["https://wdown.ebsi.co.kr/big.pdf"]);
    expect(res.url).toBe("https://wdown.ebsi.co.kr/big.pdf");
    expect(pulled).toBeLessThan(5); // 200개 chunk 중 앞부분만
  });
});
