/**
 * 실제 source 진단 (read-only). DB 를 읽거나 쓰지 않는다.
 *   npm run ingest:inspect -- --source=ebsi --year=2026 --grade=3 --month=9
 *   npm run ingest:inspect -- --source=kice --year=2025 --grade=3 --month=11 --exam-type=csat \
 *        --url="<공지의 시험별 자료 페이지>" --page-type=exam_release_index --exam-date=2025-11-13
 *   --fixtures: 네트워크 대신 저장소의 합성 fixture 사용 (구조 확인용, 실제 검증 아님)
 * source allowlist · robots.txt · 요청 간격을 지키는 같은 fetcher 를 쓴다. 파일(PDF/MP3)은 받지 않는다.
 */
import { EXAM_TYPES, type ExamType, type Grade } from "../../lib/constants";
import { toIngestionError } from "../errors";
import { BUILTIN_SOURCES } from "../sources/config";
import { createAdapter } from "../sources/registry";
import { PAGE_TYPES, type ExamLocator, type PageType } from "../types";
import { intArg, parseArgs } from "./args";
import { fixtureFetcherFor } from "./dry-run";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = BUILTIN_SOURCES.find((s) => s.id === args.source);
  if (!source) throw new Error(`--source=${BUILTIN_SOURCES.map((s) => s.id).join("|")}`);
  const year = intArg(args.year);
  const grade = intArg(args.grade) as Grade | undefined;
  const month = intArg(args.month);
  if (!year || !grade || !month) throw new Error("--year --grade --month 가 필요합니다");
  const pageType = typeof args["page-type"] === "string" ? args["page-type"] : undefined;
  if (pageType && !(PAGE_TYPES as readonly string[]).includes(pageType))
    throw new Error(`--page-type=${PAGE_TYPES.join("|")}`);
  const examTypeArg = typeof args["exam-type"] === "string" ? args["exam-type"] : undefined;
  if (examTypeArg && !(EXAM_TYPES as readonly string[]).includes(examTypeArg))
    throw new Error(`--exam-type=${EXAM_TYPES.join("|")}`);

  const adapter = createAdapter(
    { ...source, enabled: true },
    args.fixtures ? { fetcher: fixtureFetcherFor(source, [year]) } : {},
  );
  console.log(`Exam\n  ${year} / high${grade} / ${String(month).padStart(2, "0")}`);
  console.log(`Source\n  ${source.name} (${args.fixtures ? "synthetic fixtures" : "live"})`);
  try {
    let locators: ExamLocator[];
    if (typeof args.url === "string") {
      const examType: ExamType =
        (examTypeArg as ExamType) ?? (month === 11 ? "csat" : "school_mock");
      locators = [
        {
          year,
          grade,
          month,
          examType,
          academicYear: examType === "school_mock" ? null : year + 1,
          sourceUrl: args.url,
          pageType: pageType as PageType | undefined,
          examDate: typeof args["exam-date"] === "string" ? args["exam-date"] : null,
        },
      ];
    } else {
      const exams = await adapter.discoverExams({ fromYear: year, toYear: year, grade, month });
      if (exams.length === 0) console.log("\n시험을 찾지 못했습니다.");
      locators = exams.map((e) => {
        console.log(
          `\nExternal ID\n  ${e.externalId}\nTitle\n  ${e.title}\nPage\n  ${e.sourceUrl}`,
        );
        return { ...e.canonical, externalId: e.externalId, sourceUrl: e.sourceUrl };
      });
    }
    for (const locator of locators) {
      const artifacts = await adapter.discoverArtifacts(locator);
      console.log(`\nDetected artifacts (${artifacts.length})`);
      for (const a of artifacts) {
        const course =
          a.course.status === "resolved"
            ? ` / ${a.course.code}`
            : a.course.status === "ambiguous"
              ? ` / ⚠ 과목 미확정(${a.course.candidates.join("|")})`
              : "";
        console.log(
          `\n${a.subject}${course} / ${a.type}${a.containerType === "archive" ? " (archive)" : ""}`,
        );
        console.log(`  원문 "${a.sourceLabel}"`);
        console.log(`  URL ${a.url}`);
        if (a.officialReleaseAt) console.log(`  공개 ${a.officialReleaseAt}`);
      }
      if (adapter.discoverReleaseTimes && locator.pageType === "exam_release_index") {
        const times = await adapter.discoverReleaseTimes(locator);
        console.log(`\nOfficial release times (${times.length})`);
        for (const t of times)
          console.log(
            `  ${t.sourceLabel}: ${t.rawTime} → ${t.officialReleaseAt ?? "(날짜 미확인)"}`,
          );
      }
    }
  } catch (error) {
    const e = toIngestionError(error);
    console.error(`\n✗ ${e.code}: ${e.message}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
