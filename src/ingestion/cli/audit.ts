/**
 * backfill / 운영 데이터 audit (DB 읽기 전용, --record 일 때만 결과 저장).
 *   npm run ingest:audit                                   # 올해 기준 최근 3년, 모든 source
 *   npm run ingest:audit -- --source=ebsi --from=2025 --to=2026 [--json] [--record]
 * blocking issue 가 있으면 exit 1. --record 로 저장된 통과 기록이 canary backfill 다음 단계의 조건이다.
 */
import { recordAudit, runAudit } from "../audit";
import { intArg, parseArgs } from "./args";
import { closeDb, requireDb } from "./context";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const year = new Date().getFullYear();
  const fromYear = intArg(args.from) ?? year - 3;
  const toYear = intArg(args.to) ?? year;
  const sourceId = typeof args.source === "string" ? args.source : null;
  if (args.record && !sourceId) throw new Error("--record 에는 --source 가 필요합니다");
  const db = requireDb();
  try {
    const report = await runAudit(db, { sourceId, fromYear, toYear });
    if (args.record) await recordAudit(db, report);
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const c = report.counts;
      console.log(
        `audit ${sourceId ?? "all sources"} ${fromYear}~${toYear}: 시험 ${c.exams} · source 시험 ${c.sourceExams} · 자료 ${c.artifacts} · 과목 미확정 ${c.unresolved}`,
      );
      console.log(
        `  자료 상태: ${
          Object.entries(c.byStatus)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ") || "-"
        }`,
      );
      console.log(
        `  자료 종류: ${
          Object.entries(c.byType)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ") || "-"
        }`,
      );
      const group = (list: typeof report.blocking) => {
        const by = new Map<string, string[]>();
        for (const i of list) by.set(i.code, [...(by.get(i.code) ?? []), i.message]);
        for (const [code, msgs] of by) {
          console.log(`  - ${code} (${msgs.length})`);
          for (const m of msgs.slice(0, 10)) console.log(`      ${m}`);
          if (msgs.length > 10) console.log(`      … ${msgs.length - 10}건 더`);
        }
      };
      console.log(`BLOCKING ${report.blocking.length}`);
      group(report.blocking);
      console.log(`WARNING ${report.warnings.length}`);
      group(report.warnings);
      console.log(report.passed ? "PASS" : "FAIL");
      if (args.record) console.log("recorded (canary 다음 단계 조건으로 사용됨)");
    }
    if (!report.passed) process.exitCode = 1;
  } finally {
    await closeDb(db);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
