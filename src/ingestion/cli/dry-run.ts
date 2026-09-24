import path from "node:path";
import { GRADES, SUBJECT_LABELS, FILE_TYPE_LABELS, type Grade } from "../../lib/constants";
import { courseByCode } from "../../lib/courses";
import { examPath } from "../../lib/exam-path";
import { dedupeArtifacts } from "../canonical/artifact-type";
import { canonicalKey } from "../canonical/exam-title";
import { FixtureFetcher } from "../net/fixture-fetcher";
import type { Fetcher } from "../net/fetcher";
import { BUILTIN_SOURCES } from "../sources/config";
import { ebsiListingUrl } from "../sources/ebsi/structure";
import { EDUCATION_OFFICE_DEFINITION } from "../sources/education-office/structure";
import { KICE_DEFINITION } from "../sources/kice/structure";
import { createAdapter } from "../sources/registry";
import type { SourceConfig } from "../types";

const FIXTURE_DIR = path.resolve("tests/fixtures");

/** 로컬 합성 fixture 로 응답하는 fetcher 구성 (네트워크 없음) */
export function fixtureFetcherFor(source: SourceConfig, years: number[]): Fetcher {
  const routes: Record<string, string> = {};
  if (source.kind === "ebsi") {
    for (const year of years) {
      for (const grade of GRADES) {
        const file =
          year === 2025 && grade === 2
            ? "ebsi/listing-high2-2025.html"
            : year === 2025 && grade === 3
              ? "ebsi/listing-high3-2025.html"
              : "ebsi/listing-empty.html";
        routes[ebsiListingUrl(source.baseUrl, grade as Grade, year)] = file;
      }
    }
  } else if (source.kind === "kice") {
    routes[KICE_DEFINITION.listUrl(source.baseUrl, 1)] = "kice/list-page1.html";
    routes[KICE_DEFINITION.listUrl(source.baseUrl, 2)] = "kice/list-page2.html";
    for (const seq of ["5102", "5101", "5001", "4902"]) {
      routes[`${source.baseUrl}/boardCnts/view.do?boardID=1500234&boardSeq=${seq}&m=0403`] =
        seq === "5102" ? "kice/view-5102.html" : "kice/view-empty.html";
    }
  } else if (source.kind === "education_office") {
    routes[EDUCATION_OFFICE_DEFINITION.listUrl(source.baseUrl, 1)] =
      "education-office/list-page1.html";
    routes[EDUCATION_OFFICE_DEFINITION.listUrl(source.baseUrl, 2)] =
      "education-office/list-empty.html";
    routes[`${source.baseUrl}/web/services/bbs/bbsView.action?bbsBean.bbsCd=EXAM&bbsSn=7002`] =
      "education-office/view-7002.html";
    routes[`${source.baseUrl}/web/services/bbs/bbsView.action?bbsBean.bbsCd=EXAM&bbsSn=7003`] =
      "education-office/view-empty.html";
  }
  return new FixtureFetcher(routes, FIXTURE_DIR);
}

/**
 * DB 쓰기 없이 수집 흐름을 보여준다.
 * source → 시험 발견 → canonical identity → 자료 발견/중복 제거 → 제공 정책 → 사이트 URL
 */
export async function dryRunBackfill(options: {
  sourceIds?: string[];
  fromYear: number;
  toYear: number;
  grade?: Grade;
  live: boolean;
}) {
  const sources = BUILTIN_SOURCES.filter((s) =>
    options.sourceIds?.length ? options.sourceIds.includes(s.id) : true,
  );
  const years = Array.from(
    { length: options.toYear - options.fromYear + 1 },
    (_, i) => options.fromYear + i,
  );
  console.log(
    options.live
      ? "▶ DRY RUN (live): 실제 공식 사이트에 요청합니다. DB 에는 쓰지 않습니다."
      : "▶ DRY RUN (fixture): 네트워크 없이 tests/fixtures 의 합성 HTML 로 실행합니다. DB 에는 쓰지 않습니다.\n  (실제 사이트로 확인하려면 INGESTION_ENABLED=true 와 --live 를 함께 지정)",
  );
  for (const base of sources) {
    const source = { ...base, enabled: true };
    const adapter = createAdapter(
      source,
      options.live ? {} : { fetcher: fixtureFetcherFor(source, years) },
    );
    console.log(`\n━━ source: ${source.name} (${source.id}) · 정책 ${source.deliveryPolicy}`);
    try {
      const exams = await adapter.discoverExams({
        fromYear: options.fromYear,
        toYear: options.toYear,
        grade: options.grade,
      });
      if (exams.length === 0) console.log("  발견된 시험 없음");
      for (const exam of exams) {
        const c = exam.canonical;
        console.log(
          `\n  ● "${exam.title}"\n    → identity ${canonicalKey(c)} (${c.examType}${c.academicYear ? `, ${c.academicYear}학년도` : ""}) · 페이지 ${examPath(c)}`,
        );
        try {
          const raw = await adapter.discoverArtifacts({
            ...c,
            externalId: exam.externalId,
            sourceUrl: exam.sourceUrl,
          });
          const { artifacts, conflicts } = dedupeArtifacts(raw);
          for (const a of artifacts) {
            const action =
              source.deliveryPolicy === "mirror_allowed"
                ? "검증 → R2 저장 → 우리 CDN 제공"
                : source.deliveryPolicy === "manual_review"
                  ? "검증 → 관리자 검토 대기"
                  : "검증 → 공식 URL 등록 (다운로드 시 redirect)";
            const area =
              a.course.status === "resolved"
                ? `${SUBJECT_LABELS[a.subject]} > ${courseByCode(a.course.code)?.name}`
                : SUBJECT_LABELS[a.subject];
            if (a.containerType === "archive") {
              console.log(
                `    ${area} ${FILE_TYPE_LABELS[a.type]}: 압축 파일 → 관리자 검토 (압축 해제 미구현)`,
              );
            } else if (a.course.status === "ambiguous") {
              console.log(
                `    ${area} ${FILE_TYPE_LABELS[a.type]}: 과목 표기 "${a.courseLabel}" 이 모호함 (${a.course.candidates.join(" / ")}) → 검증 후 관리자 과목 지정 대기`,
              );
            } else {
              console.log(`    ${area} ${FILE_TYPE_LABELS[a.type]}: ${action}`);
            }
          }
          for (const group of conflicts) {
            console.log(
              `    ⚠ ${SUBJECT_LABELS[group[0]!.subject]} ${FILE_TYPE_LABELS[group[0]!.type]}: 후보 ${group.length}개 (선택과목 등) → 자동 선택하지 않음`,
            );
          }
          if (artifacts.length === 0 && conflicts.length === 0) console.log("    (자료 아직 없음)");
        } catch (error) {
          console.log(`    ✗ 자료 조회 실패: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      console.log(`  ✗ ${(error as Error).message}`);
    }
  }
  console.log(
    "\n실제 실행 시: 시험·mapping·자료는 idempotent 하게 기록되고, 자료마다 VERIFY → (MIRROR|REGISTER_URL) → PUBLISH job 이 생성됩니다.",
  );
}
