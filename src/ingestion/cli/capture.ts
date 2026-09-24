/**
 * 실제 공식 페이지(HTML 만)를 fixture 로 저장한다. 시험 PDF/음원은 받지 않는다.
 *   npm run ingest:capture -- --source=ebsi --page-type=exam_list --grade=3 --year=2025
 *   npm run ingest:capture -- --source=kice --page-type=exam_list --url="https://www.suneung.re.kr/boardCnts/list.do?..."
 *   npm run ingest:capture -- --source=kice --page-type=exam_detail --url="...view.do?..." --exam-title="2026학년도 9월 모의평가"
 *   npm run ingest:capture -- --source=kice --page-type=exam_release_index --url="<공지에 있는 시험별 자료 페이지>" \
 *        --exam-title="2026학년도 대학수학능력시험" --exam-date=2025-11-13
 *   npm run ingest:capture -- --source=ebsi --page-type=listening_archive --url="..." --exam-title="..."
 * 옵션: --name=<파일명> --expect-empty --external-id=<EBSi 시험 id>
 * 저장: tests/fixtures/live/<source>/<name>.html + .json
 *   (metadata: source, pageType, url, capturedAt, sha256, parserVersion, examIdentity, expected, expectedReviewed=false)
 * expected 는 "저장 당시 parser 가 본 요약"이다. 사람이 실제 페이지와 대조한 뒤 expectedReviewed=true 로 바꿔야
 * 검증 증거가 된다 (parser 가 맞다고 추측해서 verified 처리하지 않기 위함).
 * 저장 전 sanitizer 로 쿠키/세션/CSRF/추적 파라미터/개인화 영역을 제거한다.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Grade } from "../../lib/constants";
import { canonicalizeExamTitle } from "../canonical/exam-title";
import { PAGE_TYPES, type PageType } from "../types";
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
  const legacyKind: Record<string, PageType> = {
    listing: "exam_list",
    "board-list": "exam_list",
    "board-detail": "exam_detail",
  };
  const pageTypeArg =
    typeof args["page-type"] === "string"
      ? args["page-type"]
      : typeof args.kind === "string"
        ? legacyKind[args.kind]
        : "exam_list";
  if (!(PAGE_TYPES as readonly string[]).includes(pageTypeArg ?? "")) {
    throw new Error(`--page-type=${PAGE_TYPES.join("|")}`);
  }
  const pageType = pageTypeArg as PageType;
  const examTitle = typeof args["exam-title"] === "string" ? args["exam-title"] : undefined;
  const titleExam = examTitle ? canonicalizeExamTitle(examTitle) : null;
  if (titleExam && !titleExam.ok) throw new Error(`--exam-title 인식 실패: ${titleExam.reason}`);
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
      : `${pageType}-${grade ? `g${grade}-` : ""}${year ?? ""}-${new Date().toISOString().slice(0, 10)}`.replace(
          /--+/g,
          "-",
        );
  const draft: FixtureMeta = {
    source: sourceId,
    pageType,
    url: safeUrl,
    capturedAt: new Date().toISOString(),
    sha256: sha256(html),
    parserVersion: currentParserVersion(source.kind) ?? undefined,
    examIdentity:
      titleExam?.ok && pageType !== "exam_list"
        ? {
            year: titleExam.exam.year,
            grade: titleExam.exam.grade,
            month: titleExam.exam.month,
            examType: titleExam.exam.examType,
          }
        : null,
    context: {
      ...(grade ? { grade } : {}),
      ...(year ? { year } : {}),
      ...(examTitle ? { examTitle } : {}),
      ...(typeof args["exam-date"] === "string" ? { examDate: args["exam-date"] } : {}),
      ...(typeof args["external-id"] === "string" ? { externalId: args["external-id"] } : {}),
    },
    expected: args["expect-empty"] ? { empty: true } : { minimumExamCount: 0 },
    expectedReviewed: false,
  };
  // 저장 당시 parser 가 본 요약을 expected 초안으로 기록 (사람이 확인해야 함)
  const observed = validateFixture(html, draft).summary;
  const meta: FixtureMeta = {
    ...draft,
    expected: args["expect-empty"]
      ? { empty: true }
      : {
          examCount: observed.examCount,
          containsSubjects: observed.subjects,
          containsCourses: observed.courses,
          minimumArtifactCount: observed.artifactCount,
          ...(pageType === "exam_release_index"
            ? { releaseTimeCount: observed.releaseTimeCount }
            : {}),
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
      ? `✓ parser contract OK (${check.exams} exams, ${check.artifacts} artifacts, subjects ${check.summary.subjects.join(",")})`
      : "✗ parser contract FAILED:",
  );
  for (const e of check.errors) console.log(`  - ${e}`);
  console.log(
    "→ 브라우저로 실제 페이지를 열어 expected 요약(시험 수, 영역, 자료 수)이 맞는지 확인한 뒤 expectedReviewed 를 true 로 바꾸세요.",
  );
  if (!check.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
