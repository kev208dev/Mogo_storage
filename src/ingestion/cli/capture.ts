/**
 * 실제 공식 페이지(HTML 만)를 fixture 로 저장한다. 시험 PDF/음원은 받지 않는다.
 *   npm run ingest:capture -- --source=ebsi --url="https://www.ebsi.co.kr/..." --grade=3 --year=2025
 *   npm run ingest:capture -- --source=kice --url="https://www.suneung.re.kr/boardCnts/list.do?..." --kind=board-list
 *   npm run ingest:capture -- --source=kice --url="...view.do?..." --kind=board-detail --exam-title="2026학년도 9월 모의평가"
 * 옵션: --name=<파일명> --expect-empty --min-artifacts=N
 * 저장: tests/fixtures/live/<source>/<name>.html + .json(metadata: source, capturedAt, url, sha256 …)
 * 저장 전 sanitizer 로 쿠키/세션/CSRF/추적 파라미터/개인화 영역을 제거한다.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Grade } from "../../lib/constants";
import type { FixtureMeta } from "../fixtures/contract";
import { FIXTURE_DIRS, LIVE_FIXTURE_DIR, sha256 } from "../fixtures/live";
import { sanitizeFixtureHtml, sanitizeUrlString } from "../fixtures/sanitize";
import { validateFixture } from "../fixtures/contract";
import { decodeHtml } from "../net/fetcher";
import { BUILTIN_SOURCES } from "../sources/config";
import { ebsiListingUrl } from "../sources/ebsi/structure";
import { EDUCATION_OFFICE_DEFINITION } from "../sources/education-office/structure";
import { KICE_DEFINITION } from "../sources/kice/structure";
import { createFetcherFor } from "../sources/registry";
import { currentParserVersion } from "../sources/verification";
import { intArg, parseArgs } from "./args";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = BUILTIN_SOURCES.find((s) => s.id === args.source);
  if (!source) throw new Error(`--source=${BUILTIN_SOURCES.map((s) => s.id).join("|")}`);
  const sourceId = source.id as FixtureMeta["source"];
  const grade = intArg(args.grade) as Grade | undefined;
  const year = intArg(args.year);
  const kind = (
    typeof args.kind === "string" ? args.kind : source.kind === "ebsi" ? "listing" : "board-list"
  ) as FixtureMeta["kind"];
  const url =
    typeof args.url === "string"
      ? args.url
      : source.kind === "ebsi"
        ? ebsiListingUrl(source.baseUrl, grade ?? 3, year ?? new Date().getFullYear())
        : (source.kind === "kice" ? KICE_DEFINITION : EDUCATION_OFFICE_DEFINITION).listUrl(
            source.baseUrl,
            1,
          );

  // source allowlist · robots.txt · rate limit 을 지키는 같은 fetcher 사용 (다른 도메인은 거부)
  const res = await createFetcherFor(source).fetch(url, {
    accept: "text/html",
    maxBytes: 5 * 1024 * 1024,
  });
  const { html, report } = sanitizeFixtureHtml(decodeHtml(res));
  const safeUrl = sanitizeUrlString(res.url);
  const name =
    typeof args.name === "string"
      ? args.name.replace(/[^\w.-]/g, "_")
      : `${kind}-${grade ? `g${grade}-` : ""}${year ?? ""}-${new Date().toISOString().slice(0, 10)}`.replace(
          /--+/g,
          "-",
        );
  const meta: FixtureMeta = {
    source: sourceId,
    kind,
    url: safeUrl,
    capturedAt: new Date().toISOString(),
    sha256: sha256(html),
    parserVersionAtCapture: currentParserVersion(source.kind) ?? undefined,
    context: {
      ...(grade ? { grade } : {}),
      ...(year ? { year } : {}),
      ...(typeof args["exam-title"] === "string" ? { examTitle: args["exam-title"] } : {}),
    },
    expect: args["expect-empty"]
      ? { empty: true }
      : {
          minExams: 1,
          ...(intArg(args["min-artifacts"]) ? { minArtifacts: intArg(args["min-artifacts"]) } : {}),
        },
  };
  const dir = path.join(LIVE_FIXTURE_DIR, FIXTURE_DIRS[sourceId]);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.html`), html);
  await writeFile(path.join(dir, `${name}.json`), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(
    `saved ${dir}/${name}.html (sanitized: ${report.removedScripts} scripts, ${report.removedPersonalized} personalized blocks)`,
  );

  // 저장 직후 현재 parser 로 바로 확인 → 틀린 부분을 즉시 발견
  const check = validateFixture(html, meta);
  console.log(
    check.ok
      ? `✓ parser contract OK (${check.exams} exams, ${check.artifacts} artifacts)`
      : "✗ parser contract FAILED:",
  );
  for (const e of check.errors) console.log(`  - ${e}`);
  if (!check.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
