import { defineConfig } from "vitest/config";

const alias = { "server-only": new URL("./tests/unit/server-only-stub.ts", import.meta.url).pathname };

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node", alias },
      },
      {
        // integration: DATABASE_URL_TEST 가 없으면 자동으로 skip. 같은 DB 를 쓰므로 파일을 순서대로 실행한다
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          alias,
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
