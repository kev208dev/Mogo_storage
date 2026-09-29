import { describe, expect, it } from "vitest";
import { decodeHtml, type FetchResult } from "../../src/ingestion/net/fetcher";

const cp949Html = new Uint8Array([
  60, 104, 116, 109, 108, 62, 60, 104, 101, 97, 100, 62, 60, 109, 101, 116, 97, 32, 99, 104, 97,
  114, 115, 101, 116, 61, 34, 101, 117, 99, 45, 107, 114, 34, 62, 60, 116, 105, 116, 108, 101, 62,
  193, 190, 183, 206, 199, 208, 191, 248, 60, 47, 116, 105, 116, 108, 101, 62, 60, 47, 104, 101, 97,
  100, 62, 60, 98, 111, 100, 121, 62, 50, 48, 50, 54, 179, 226, 32, 176, 237, 49, 32, 57, 46, 50,
  32, 200, 174, 193, 164, 32, 181, 238, 177, 222, 196, 198, 60, 47, 98, 111, 100, 121, 62, 60, 47,
  104, 116, 109, 108, 62,
]);

function result(contentType: string, bytes = cp949Html): FetchResult {
  return {
    url: "https://www.jongro.co.kr/example",
    status: 200,
    contentType,
    headers: new Headers(),
    bytes,
  };
}

describe("decodeHtml", () => {
  it("uses an EUC-KR meta charset when the HTTP Content-Type omits charset", () => {
    const html = decodeHtml(result("text/html"));
    expect(html).toContain("종로학원");
    expect(html).toContain("2026년 고1 9.2 확정 등급컷");
  });

  it("keeps the HTTP charset authoritative when one is provided", () => {
    const bytes = new TextEncoder().encode('<meta charset="euc-kr"><title>UTF-8 정상</title>');
    expect(decodeHtml(result("text/html; charset=utf-8", bytes))).toContain("UTF-8 정상");
  });
});
