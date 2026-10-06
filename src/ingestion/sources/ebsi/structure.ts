import type { Grade } from "../../../lib/constants";

/**
 * EBSi 기출문제 페이지 구조에 대한 가정은 모두 이 파일에만 둔다.
 * 사이트 구조가 바뀌면 이 파일과 fixture 만 고치면 된다.
 *
 * selector 는 과거 EBSi 구조를 우선 계약으로 유지한다. 현행 페이지처럼 table/div 기반으로
 * class 이름이 바뀐 경우 parser.ts 의 의미 기반 fallback(시험명·날짜·다운로드 링크)을 사용한다.
 * 서버 HTML 에 검색 조건 shell 만 있고 시험 결과가 client-side 로만 내려오는 경우에는
 * SourceStructureChangedError 로 실패해 별도 result endpoint 검증이 필요함을 명시한다.
 * live fixture/health 검증을 통과하기 전에는 source activation gate 때문에 운영 수집이 켜지지 않는다.
 */
export const EBSI_STRUCTURE = {
  listContainer: "ul.board_list",
  emptyMarker: ".no_data",
  examItem: "li.exam",
  examTitle: ".tit",
  examDate: ".date",
  examIdAttribute: "data-exam-id",
  subjectBlock: ".board_qusesion .subj",
  subjectName: ".subject",
  downloadLink: "a, button",
  /**
   * 자료 링크가 있는 페이지. "listing" = 목록 항목 안에 자료 링크가 함께 있음 (현재 합성 fixture 가정).
   * 실제 사이트가 시험별 상세 페이지를 쓰면 "detail" 로 바꾸고 ebsiArtifactPageUrl 과 상세 parser 를 실제 fixture 로 구현한다.
   */
  artifactPage: "listing",
} as const;

/** 시험 하나의 자료 페이지 URL. 현재 가정에서는 목록 페이지와 같다 */
export function ebsiArtifactPageUrl(listingUrl: string): string {
  return listingUrl;
}

/** 학년별 기출 목록 URL. 학년 코드: D100(고1) / D200(고2) / D300(고3) */
export function ebsiListingUrl(baseUrl: string, grade: Grade, year: number): string {
  const url = new URL("/ebs/xip/xipc/previousPaperList.ebs", baseUrl);
  url.searchParams.set("targetCd", `D${grade}00`);
  url.searchParams.set("year", String(year));
  return url.toString();
}
