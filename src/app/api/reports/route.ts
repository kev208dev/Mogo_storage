import { NextResponse } from "next/server";
import { getRepository } from "@/lib/data";
import { reportInputSchema } from "@/lib/report-schema";
import { getClientIp, hashIp } from "@/lib/server/client-ip";
import { RateLimiter } from "@/lib/server/rate-limit";

const MAX_BODY_BYTES = 8 * 1024;
const RATE_MAX = Number(process.env.REPORT_RATE_LIMIT_MAX ?? 5);
const RATE_WINDOW_MS = Number(process.env.REPORT_RATE_LIMIT_WINDOW_MS ?? 10 * 60 * 1000);

const limiter = new RateLimiter(RATE_MAX, RATE_WINDOW_MS);

function error(status: number, message: string) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/**
 * 오류 신고 접수 (로그인 불필요)
 * abuse 방지: body 크기 제한, same-origin 검사, honeypot, IP 해시 기반 rate limit(메모리 + DB)
 */
export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return error(415, "잘못된 요청 형식입니다.");
  }
  if (!isSameOrigin(request)) return error(403, "허용되지 않은 요청입니다.");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return error(413, "요청이 너무 큽니다.");

  let json: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return error(413, "요청이 너무 큽니다.");
    json = JSON.parse(text);
  } catch {
    return error(400, "잘못된 요청입니다.");
  }

  const parsed = reportInputSchema.safeParse(json);
  if (!parsed.success) {
    // Zod 내부 구조를 그대로 노출하지 않고, 사용자용 메시지와 문제 필드명만 돌려준다.
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".")).filter(Boolean))];
    return NextResponse.json(
      { error: validationMessage(fields), fields },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const input = parsed.data;

  try {
    return await saveReport(request, input);
  } catch (err) {
    console.error("[reports] failed", err);
    return error(500, "일시적인 오류로 신고를 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

async function saveReport(request: Request, input: ReturnType<typeof reportInputSchema.parse>) {
  // honeypot 이 채워져 있으면 봇: 성공처럼 응답하고 저장하지 않는다.
  if (input.website) return NextResponse.json({ ok: true }, { status: 201 });

  const ipHash = hashIp(getClientIp(request.headers));
  if (!limiter.take(ipHash)) {
    return error(429, "신고가 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  }

  const repo = getRepository();
  const since = new Date(Date.now() - RATE_WINDOW_MS);
  if ((await repo.countRecentReports(ipHash, since)) >= RATE_MAX) {
    return error(429, "신고가 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  }

  const exam = await repo.getExamById(input.examId);
  if (!exam) return error(404, "시험을 찾을 수 없습니다.");
  if (input.fileId) {
    const file = await repo.getFile(input.fileId);
    if (!file || file.examId !== exam.id) return error(404, "자료를 찾을 수 없습니다.");
  }

  const report = await repo.createReport({
    examId: exam.id,
    fileId: input.fileId ?? null,
    subject: input.subject ?? null,
    category: input.category,
    message: input.message,
    ipHash,
  });
  return NextResponse.json({ ok: true, id: report.id }, { status: 201 });
}

function validationMessage(fields: string[]) {
  if (fields.includes("category")) return "신고 유형을 선택해 주세요.";
  if (fields.includes("message")) return "설명은 1000자 이하로 입력해 주세요.";
  return "입력값을 확인해 주세요.";
}

/** 브라우저가 보낸 Origin 이 있으면 같은 호스트인지 확인한다. (CSRF/외부 사이트 대량 신고 방지) */
function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}
