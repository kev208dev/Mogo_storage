import type { BoardSourceDefinition } from "../board/adapter";

/**
 * 시·도 교육청 전국연합학력평가 자료실 구조 가정 (기본: 서울특별시교육청).
 *
 * ⚠️ 검증 상태: 실제 자료실이 아닌 합성 fixture 기준 가정이며 기본 disabled.
 *    2026-09-25 robots 조사(docs/SOURCE_SURVEY.md)에서 robots 가 허용하는 교육청 학력평가
 *    자료실을 찾지 못했다. 허용된 공식 자료실이 확인되기 전까지 활성화하지 않는다.
 *    그 전까지 교육청 자료는 운영자 CSV 입력(docs/OFFICIAL_URL_IMPORT.md)으로만 받는다.
 */
export const EDUCATION_OFFICE_DEFINITION: BoardSourceDefinition = {
  maxPages: 20,
  listUrl(baseUrl, page) {
    const url = new URL("/web/services/bbs/bbsList.action", baseUrl);
    url.searchParams.set("bbsBean.bbsCd", "EXAM");
    url.searchParams.set("page", String(page));
    return url.toString();
  },
  structure: {
    sourceId: "education_office",
    listRow: "table.bbs_list tbody tr",
    rowTitleLink: "td.title a",
    rowDate: "td.date",
    emptyMarker: ".no_data",
    idParam: "bbsSn",
    attachmentContainer: "div.file_area",
    attachmentLink: "a",
    examTitlePattern: /(학력평가|학평)/,
  },
};
