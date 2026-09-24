import type { BoardSourceDefinition } from "../board/adapter";

/**
 * 시·도 교육청 전국연합학력평가 자료실 구조 가정 (기본: 서울특별시교육청).
 *
 * ⚠️ 검증 상태: 실제 페이지 미확인. 합성 fixture 기준이며 기본 disabled.
 *    학력평가 자료를 어느 교육청 페이지에서 공개하는지 확인한 뒤 listUrl/selector 를 갱신한다.
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
