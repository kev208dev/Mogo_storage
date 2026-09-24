import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    alias: { "server-only": new URL("./tests/unit/server-only-stub.ts", import.meta.url).pathname },
  },
});
