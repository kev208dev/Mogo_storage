import { describe, expect, it } from "vitest";
import { sanitizeFixtureHtml, sanitizeUrlString } from "@/ingestion/fixtures/sanitize";

describe("fixture sanitizer", () => {
  it("removes session ids, csrf tokens and tracking params but keeps functional params", () => {
    expect(
      sanitizeUrlString(
        "https://www.ebsi.co.kr/ebs/list.ebs;jsessionid=ABC123?targetCd=D300&utm_source=x&gclid=1",
      ),
    ).toBe("https://www.ebsi.co.kr/ebs/list.ebs?targetCd=D300");
    expect(sanitizeUrlString("/boardCnts/view.do?boardSeq=77&PHPSESSID=zz&_csrf=t")).toBe(
      "/boardCnts/view.do?boardSeq=77",
    );
    expect(sanitizeUrlString("view.do?boardSeq=77&token=x")).toBe("view.do?boardSeq=77");
  });

  it("scrubs forms, meta tags, scripts, analytics and personalized areas", () => {
    const html = `<!doctype html><html><head>
      <meta name="csrf-token" content="SECRET-CSRF">
      <script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
      <script>var sessionId = "S-123"; var csrfToken='C-456'; function goDownLoadP(u){location.href=u}</script>
      </head><body>
      <div id="loginInfo">홍길동님 환영합니다 (hong@example.com)</div>
      <form><input type="hidden" name="_csrf" value="SECRET2"><input name="q" value="keep"></form>
      <a href="/a.pdf?utm_medium=mail&fileSeq=3" onclick="goDownLoadP('https://wdown.ebsi.co.kr/x.pdf?sid=abc&n=1')">문제</a>
      <p>문의: help@example.com</p>
      </body></html>`;
    const { html: out, report } = sanitizeFixtureHtml(html);
    for (const secret of [
      "SECRET-CSRF",
      "S-123",
      "C-456",
      "SECRET2",
      "홍길동",
      "hong@example.com",
      "help@example.com",
      "googletagmanager",
      "sid=abc",
      "utm_medium",
    ]) {
      expect(out, secret).not.toContain(secret);
    }
    expect(out).toContain('value="keep"');
    expect(out).toContain("fileSeq=3");
    expect(out).toContain("https://wdown.ebsi.co.kr/x.pdf?n=1");
    expect(out).toContain("function goDownLoadP");
    expect(report.removedScripts).toBe(1);
    expect(report.removedPersonalized).toBe(1);
  });
});
