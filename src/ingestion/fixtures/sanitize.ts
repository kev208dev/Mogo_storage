import { parse, type HTMLElement } from "node-html-parser";

/**
 * 실제 공개 페이지 HTML 을 fixture 로 저장하기 전에 민감한 값을 제거한다.
 *  - 쿠키/세션 id (jsessionid, PHPSESSID, sid …), CSRF 토큰, nonce
 *  - 추적용 query parameter (utm_*, fbclid, gclid, _ga …)
 *  - 분석/광고 스크립트 (Google Analytics, GTM, 픽셀 등)
 *  - 로그인 상태에 따른 개인화 영역, 이메일 주소
 * 기능에 필요한 parameter(targetCd, boardSeq 등)와 페이지 구조는 유지한다.
 */

const SENSITIVE_PARAM =
  /^(jsessionid|phpsessid|aspsessionid\w*|sid|sessionid|session|token|access_token|auth|csrf|_csrf|csrf_token|xsrf|nonce|sig|signature|x-amz-[\w-]+)$/i;
const TRACKING_PARAM =
  /^(utm_[\w]+|fbclid|gclid|dclid|msclkid|_ga|_gl|mc_[\w]+|igshid|yclid|napm|n_media|n_query)$/i;
const SENSITIVE_NAME = /(csrf|xsrf|token|session|nonce|captcha|authenticity)/i;
const ANALYTICS =
  /(google-analytics|googletagmanager|gtag\(|\bga\(|fbq\(|facebook\.net|doubleclick|wcs_do|wcs\.naver|kakao_pixel|hotjar|clarity\.ms|beusable|acecounter)/i;
const PERSONALIZED =
  /(login_?info|user_?info|my_?info|member_?info|mypage|logged_?in|welcome_?user)/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function sanitizeUrlString(value: string, base = "https://example.invalid/"): string {
  // ;jsessionid=... 처럼 path 에 붙는 세션
  let out = value.replace(/;(jsessionid|phpsessid|sid)=[^?#'"\s]*/gi, "");
  if (!/[?&]/.test(out)) return out;
  try {
    const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(out);
    const url = new URL(out, base);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_PARAM.test(key) || TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    const rebuilt = url.toString();
    out = isAbsolute ? rebuilt : rebuilt.replace(new URL(base).origin, "");
    if (!isAbsolute && !value.startsWith("/")) out = out.replace(/^\//, "");
  } catch {
    /* 해석할 수 없는 값은 그대로 */
  }
  return out;
}

function sanitizeScriptText(text: string): string {
  return text
    .replace(
      /((?:csrf|xsrf|token|session|nonce|sessionid|jsessionid)[\w]*\s*[:=]\s*)(['"])[^'"]*\2/gi,
      "$1$2[redacted]$2",
    )
    .replace(EMAIL, "[redacted-email]");
}

function sanitizeAttributes(el: HTMLElement) {
  for (const [name, value] of Object.entries(el.attributes)) {
    const lower = name.toLowerCase();
    if (["href", "src", "action", "data-href", "data-url", "data-src"].includes(lower)) {
      el.setAttribute(name, sanitizeUrlString(value));
    } else if (lower.startsWith("on")) {
      // onclick="goDownLoad('https://...?...')" 안의 URL 도 정리
      el.setAttribute(
        name,
        sanitizeScriptText(
          value.replace(
            /(['"])(https?:\/\/[^'"]+|\/[^'"]*\?[^'"]*)\1/g,
            (_m, q: string, url: string) => `${q}${sanitizeUrlString(url)}${q}`,
          ),
        ),
      );
    } else if (lower === "value" && SENSITIVE_NAME.test(el.getAttribute("name") ?? "")) {
      el.setAttribute(name, "[redacted]");
    } else if (lower === "content" && SENSITIVE_NAME.test(el.getAttribute("name") ?? "")) {
      el.setAttribute(name, "[redacted]");
    }
  }
}

export interface SanitizeReport {
  removedScripts: number;
  removedPersonalized: number;
}

export function sanitizeFixtureHtml(html: string): { html: string; report: SanitizeReport } {
  const root = parse(html, {
    comment: true,
    blockTextElements: { script: true, style: true, noscript: true },
  });
  const report: SanitizeReport = { removedScripts: 0, removedPersonalized: 0 };

  for (const script of root.querySelectorAll("script")) {
    const src = script.getAttribute("src") ?? "";
    if (ANALYTICS.test(src) || ANALYTICS.test(script.textContent)) {
      script.remove();
      report.removedScripts += 1;
      continue;
    }
    if (script.textContent) script.set_content(sanitizeScriptText(script.textContent));
  }
  for (const noscript of root.querySelectorAll("noscript")) {
    if (ANALYTICS.test(noscript.innerHTML)) noscript.remove();
  }
  for (const el of root.querySelectorAll("*")) {
    const idClass = `${el.getAttribute("id") ?? ""} ${el.getAttribute("class") ?? ""}`;
    if (PERSONALIZED.test(idClass)) {
      el.set_content("<!-- personalized content removed -->");
      report.removedPersonalized += 1;
      continue;
    }
    sanitizeAttributes(el);
  }
  const out = root.toString().replace(EMAIL, "[redacted-email]");
  return { html: out, report };
}
