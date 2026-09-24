import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3200);
const ADMIN_PORT = PORT + 1;
/** Flow C(관리자 + DB)는 E2E_DATABASE_URL 이 있을 때만 실행 */
const E2E_DB = process.env.E2E_DATABASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  globalSetup: "./tests/e2e/global-setup.ts",
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] }, testIgnore: /admin-.*\.spec\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /admin-.*\.spec\.ts/ },
    {
      name: "admin-db",
      testMatch: /admin-.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${ADMIN_PORT}` },
    },
  ],
  webServer: [
    {
      // `npm run build` 이후 실행 (CI에서는 build 단계가 선행된다). 샘플 데이터 모드
      command: `npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    ...(E2E_DB
      ? [
          {
            // DB + 관리자 모드 (Flow C)
            command: `npx next start -p ${ADMIN_PORT}`,
            url: `http://localhost:${ADMIN_PORT}`,
            reuseExistingServer: false,
            timeout: 120_000,
            env: {
              DATABASE_URL: E2E_DB,
              ADMIN_EMAIL_ALLOWLIST: "ops@example.com",
              ADMIN_ACCESS_TOKEN: "e2e-token-0123456789abcdefghij",
              ADMIN_SESSION_SECRET: "e2e-session-secret-0123456789abcdefghij",
            },
          },
        ]
      : []),
  ],
});
