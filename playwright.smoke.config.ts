import { defineConfig, devices } from "@playwright/test";

/**
 * Production smoke test (읽기 전용). 배포된 사이트를 대상으로 실행한다.
 *   SMOKE_BASE_URL=https://mogo-storage.vercel.app npm run test:smoke:prod
 * 서버를 띄우지 않고, 데이터를 쓰거나 바꾸는 요청을 보내지 않는다.
 */
const BASE = process.env.SMOKE_BASE_URL;
if (!BASE) throw new Error("SMOKE_BASE_URL 이 필요합니다 (예: https://mogo-storage.vercel.app)");

export default defineConfig({
  testDir: "./tests/smoke",
  fullyParallel: false,
  workers: 2,
  // 네트워크 일시 오류 1회만 재시도 (검증 조건은 완화하지 않는다)
  retries: 1,
  timeout: 60_000,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE,
    extraHTTPHeaders: { "user-agent": "mogo-storage-smoke/1.0 (+read-only)" },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  projects: [{ name: "smoke", use: { ...devices["Desktop Chrome"] } }],
});
