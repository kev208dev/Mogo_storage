import type { FileType, GradeCutSource } from "./constants";
import type { Course } from "./data/types";

/** 세부과목 카드의 등급컷 출처 요약 (값은 세부과목 페이지에서만 보여준다) */
export interface CourseGradeCutSummary {
  source: GradeCutSource;
  providerStatus: string;
  isOfficial: boolean;
}

/**
 * 영역 페이지(/math, /social …)에서 세부과목별로 무엇이 실제로 있는지 보여주기 위한 요약.
 * 모든 값은 DB(또는 샘플 저장소)에 실제로 있는 행에서만 계산한다.
 */
export interface CourseSummary {
  code: string;
  name: string;
  /** 게시된 파일 수 */
  fileCount: number;
  /** 게시된 파일 종류 */
  fileTypes: FileType[];
  /** 공식 자료가 발견되어 검증 중인 종류 (아직 게시 전, 이미 게시된 종류는 제외) */
  processingTypes: FileType[];
  /** 등급컷이 있는 출처 */
  gradeCuts: CourseGradeCutSummary[];
  /** 웹 정답이 등록된 선택과목 문항 수 */
  questionCount: number;
}

export type CourseAvailability = "available" | "processing" | "empty";

/** 카드 상태: 하나라도 공개된 것이 있으면 available, 검증 중만 있으면 processing, 아무것도 없으면 empty */
export function courseAvailability(summary: CourseSummary): CourseAvailability {
  if (summary.fileCount > 0 || summary.gradeCuts.length > 0 || summary.questionCount > 0)
    return "available";
  if (summary.processingTypes.length > 0) return "processing";
  return "empty";
}

export interface CourseSummaryRows {
  files: Array<{ courseId: string | null; type: FileType; n: number }>;
  processing: Array<{ courseId: string | null; type: FileType }>;
  gradeCuts: Array<{
    courseId: string | null;
    source: GradeCutSource;
    providerStatus: string;
    isOfficial: boolean;
  }>;
  questions: Array<{ courseId: string | null; n: number }>;
}

export function buildCourseSummaries(courses: Course[], rows: CourseSummaryRows): CourseSummary[] {
  return courses.map((course) => {
    const files = rows.files.filter((r) => r.courseId === course.id && r.n > 0);
    const fileTypes = [...new Set(files.map((r) => r.type))];
    const processingTypes = [
      ...new Set(rows.processing.filter((r) => r.courseId === course.id).map((r) => r.type)),
    ].filter((type) => !fileTypes.includes(type));
    const seen = new Set<GradeCutSource>();
    const gradeCuts: CourseGradeCutSummary[] = [];
    for (const r of rows.gradeCuts) {
      if (r.courseId !== course.id || seen.has(r.source)) continue;
      seen.add(r.source);
      gradeCuts.push({
        source: r.source,
        providerStatus: r.providerStatus,
        isOfficial: r.isOfficial,
      });
    }
    gradeCuts.sort((a, b) => Number(b.isOfficial) - Number(a.isOfficial));
    return {
      code: course.code,
      name: course.name,
      fileCount: files.reduce((sum, r) => sum + r.n, 0),
      fileTypes,
      processingTypes,
      gradeCuts,
      questionCount: rows.questions
        .filter((r) => r.courseId === course.id)
        .reduce((sum, r) => sum + r.n, 0),
    };
  });
}
