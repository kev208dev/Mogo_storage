/**
 * 서버 시작 시 1회 실행 (Next.js instrumentation).
 * production 에서 위험한 설정이면 요청을 받지 않고 프로세스를 종료한다 (fail closed — 컨테이너/플랫폼이 재시작·알림).
 * Node 전용 코드(process.exit)는 동적 import 한 모듈 안에만 둔다 (Edge 번들 분석 경고 방지).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" || process.env.SKIP_ENV_VALIDATION === "1") return;
  const { enforceProductionEnv } = await import("./lib/server/env");
  enforceProductionEnv();
}
