import path from "node:path";

/** Noto Sans KR (SIL OFL 1.1) — node_modules 에서 읽어 사용한 글자만 subset embed */
export const KOREAN_FONT_RELATIVE_PATH =
  "node_modules/@expo-google-fonts/noto-sans-kr/400Regular/NotoSansKR_400Regular.ttf";

export function koreanFontPath(): string {
  return path.join(process.cwd(), KOREAN_FONT_RELATIVE_PATH);
}
