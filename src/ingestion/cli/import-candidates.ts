/**
 * 공개 색인 결과 → 운영자 CSV 후보 (자동 게시 없음).
 *   npm run import:candidates -- --in=<found.json | 폴더> --out=<candidates.csv> [--year=2025] [--check-urls]
 *
 * 입력: [{ "url", "title", "query" }] — 검색엔진 등 공개 색인 결과의 url 을 그대로 (URL 을 만들지 않는다)
 * 출력:
 *   <out>                 import:official-urls 에 그대로 넣을 CSV (확실한 후보만)
 *   <out>.held.json       보류 목록과 사유 (CSV 에 넣지 않음)
 *   <out>.evidence.json   행별 근거 — import 후 --evidence 로 붙이면 관리자 화면에 보인다
 * --check-urls: 정책상 파일 요청이 허용된 호스트만 SafeFetcher 로 앞 1KB 를 받아 존재·형식 확인
 * DATABASE_URL 이 있으면 관리자가 승인한 매핑 규칙을 재사용한다.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createDb } from "../../db/client";
import { buildCandidates, candidatesToCsv, type FoundEntry } from "../manual-import/candidates";
import type { ReviewEvidence } from "../manual-import/evidence";
import { loadMappingRules } from "../manual-import/review";
import { checkCandidateUrl, createUrlCheckFetcher } from "../manual-import/url-check";
import { intArg, parseArgs } from "./args";

function readFound(input: string): FoundEntry[] {
  const files = statSync(input).isDirectory()
    ? readdirSync(input)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(input, f))
    : [input];
  return files.flatMap((f) => {
    const data = JSON.parse(readFileSync(f, "utf8")) as unknown;
    if (!Array.isArray(data)) throw new Error(`${f}: JSON 배열이 아닙니다`);
    return data.filter(
      (e): e is FoundEntry =>
        typeof e === "object" && e !== null && typeof (e as FoundEntry).url === "string",
    );
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.in !== "string" || typeof args.out !== "string") {
    console.error(
      "사용: npm run import:candidates -- --in=<found.json|폴더> --out=<candidates.csv>",
    );
    process.exit(2);
  }
  const found = readFound(args.in);
  const db = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL, 1) : null;
  const rules = db ? await loadMappingRules(db) : new Map();
  if (db) await db.$client.end({ timeout: 5 });
  const result = buildCandidates(found, { year: intArg(args.year), rules });

  const evidence = new Map<string, ReviewEvidence[]>(
    result.rows.map((r) => [r.official_url, r.evidence]),
  );
  let rows = result.rows;
  if (args["check-urls"]) {
    const fetcher = createUrlCheckFetcher();
    const kept = [];
    for (const r of rows) {
      const check = await checkCandidateUrl(fetcher, r.official_url);
      if (check.evidence) evidence.get(r.official_url)!.push(check.evidence);
      if (check.ok) kept.push(r);
      else
        result.held.push({
          url: r.official_url,
          reasonCode: "url_check_failed",
          reason: check.reason,
          evidence: evidence.get(r.official_url)!,
        });
    }
    rows = kept;
  }
  writeFileSync(args.out, candidatesToCsv(rows) + "\n");
  writeFileSync(`${args.out}.held.json`, JSON.stringify(result.held, null, 1));
  writeFileSync(
    `${args.out}.evidence.json`,
    JSON.stringify(
      rows.map((r) => ({ url: r.official_url, evidence: evidence.get(r.official_url) })),
      null,
      1,
    ),
  );
  const byReason = new Map<string, number>();
  for (const h of result.held) byReason.set(h.reasonCode, (byReason.get(h.reasonCode) ?? 0) + 1);
  console.log(
    `입력 ${found.length}건 → 후보 ${rows.length}행 · 보류 ${result.held.length}건 · 승인 규칙 ${rules.size}개 사용`,
  );
  for (const [k, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  보류 ${k}: ${n}`);
  console.log(
    `→ npm run import:official-urls -- --file=${args.out} --admin=<email> --evidence=${args.out}.evidence.json`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
