import type { NextConfig } from "next";
import { checkProductionEnv } from "./src/lib/server/env";

// Vercel Production build 에서 위험한 env 면 배포를 실패시킨다 (기존 배포가 계속 서비스됨).
// runtime(instrumentation)에서도 같은 검증을 한다. 값 자체는 출력하지 않는다.
if (process.env.VERCEL_ENV === "production" && process.env.SKIP_ENV_VALIDATION !== "1") {
  const { errors, warnings } = checkProductionEnv(process.env);
  for (const w of warnings) console.warn(`[env] ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`[env] ${e}`);
    throw new Error(`invalid production environment: ${errors.length} error(s)`);
  }
}

const nextConfig: NextConfig = {
  // 수집 worker 가 쓰는 PDF 라이브러리는 번들하지 않고 Node 에서 그대로 로드
  serverExternalPackages: ["unpdf", "pdf-lib", "@pdf-lib/fontkit"],
  // 단어장 PDF 생성용 한글 폰트(OFL)를 서버 함수 배포물에 포함
  outputFileTracingIncludes: {
    "/api/cron/[task]": ["./node_modules/@expo-google-fonts/noto-sans-kr/400Regular/*.ttf"],
    "/admin/**": ["./node_modules/@expo-google-fonts/noto-sans-kr/400Regular/*.ttf"],
  },
};

export default nextConfig;
