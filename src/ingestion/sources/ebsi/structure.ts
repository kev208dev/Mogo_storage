import type { Grade } from "../../../lib/constants";

/**
 * EBSi 기출문제 페이지 구조에 대한 가정은 모두 이 파일에만 둔다.
 * 사이트 구조가 바뀌면 이 파일과 fixture 만 고치면 된다.
 *
 * ⚠️ 검증 상태: 이 저장소 개발 환경에서는 ebsi.co.kr 에 접근할 수 없어 실제 HTML 을 확보하지 못했다.
 *    공개적으로 확인된 사실은 목록 URL 이 `/ebs/xip/xipc/previousPaperList.ebs?targetCd=D{학년}00`
 *    형태라는 것뿐이며, 아래 selector 는 tests/fixtures/ebsi 의 "합성(synthetic) fixture" 기준이다.
 *    운영 전 `npm run ingest:capture -- --source=ebsi --url=...` 로 실제 페이지를 저장하고
 *    이 파일과 fixture 를 실제 구조에 맞게 갱신해야 한다. 구조가 다르면 parser 는
 *    SourceStructureChangedError 로 실패한다 (조용히 빈 결과를 내지 않음).
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
