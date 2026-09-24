"use client";

import { useEffect } from "react";

/**
 * 루트 layout 자체에서 오류가 난 경우의 최후 방어선.
 * 오류 메시지/stack 은 화면에 표시하지 않고, 지원용 digest 만 보여준다.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          maxWidth: "32rem",
          margin: "3rem auto",
          padding: "0 1rem",
          lineHeight: 1.6,
        }}
      >
        <h1 style={{ fontSize: "1.25rem" }}>일시적인 오류가 발생했습니다</h1>
        <p>잠시 후 다시 시도해 주세요.</p>
        {error.digest ? (
          <p style={{ color: "#52525b", fontSize: "0.875rem" }}>오류 코드: {error.digest}</p>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 라우터가 깨졌을 수 있으므로 전체 새로고침 */}
        <a href="/">홈으로</a>
      </body>
    </html>
  );
}
