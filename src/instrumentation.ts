/** 서버 시작 시 1회 실행 (Next.js instrumentation). production 에서 위험한 설정이면 시작하지 않는다 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" || process.env.SKIP_ENV_VALIDATION === "1") return;
  const { assertProductionEnv } = await import("./lib/server/env");
  assertProductionEnv();
}
