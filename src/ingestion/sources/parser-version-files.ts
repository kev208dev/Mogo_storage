/**
 * source 별 parser 버전에 영향을 주는 파일 목록 (프로젝트 루트 기준).
 * 이 파일들의 내용이 바뀌면 parser-versions.json 의 hash 가 달라지고,
 * 단위 테스트가 버전을 올리라고 실패한다 → 올린 버전은 live 재검증이 필요하다.
 */
const SHARED = [
  "src/ingestion/sources/html.ts",
  "src/ingestion/canonical/classify.ts",
  "src/ingestion/canonical/course.ts",
  "src/ingestion/canonical/subject.ts",
  "src/ingestion/canonical/artifact-type.ts",
  "src/ingestion/canonical/exam-title.ts",
  "src/lib/courses.ts",
];

export const PARSER_VERSION_FILES: Record<string, string[]> = {
  ebsi: [
    "src/ingestion/sources/ebsi/structure.ts",
    "src/ingestion/sources/ebsi/parser.ts",
    ...SHARED,
  ],
  kice: [
    "src/ingestion/sources/kice/structure.ts",
    "src/ingestion/sources/board/parser.ts",
    ...SHARED,
  ],
  education_office: [
    "src/ingestion/sources/education-office/structure.ts",
    "src/ingestion/sources/board/parser.ts",
    ...SHARED,
  ],
};
