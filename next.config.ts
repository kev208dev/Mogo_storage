import type { NextConfig } from "next";

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
