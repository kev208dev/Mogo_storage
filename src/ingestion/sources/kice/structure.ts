import type { BoardSourceDefinition } from "../board/adapter";

/**
 * 한국교육과정평가원(수능 사이트) 기출문제 게시판 구조 가정.
 *
 * ⚠️ 검증 상태: 개발 환경에서 suneung.re.kr 접근이 차단되어 실제 HTML 을 확보하지 못했다.
 *    selector/URL 은 tests/fixtures/kice 의 합성 fixture 기준이다.
 *    운영 전 `npm run ingest:capture -- --source=kice --url=...` 로 실제 페이지를 저장하고 `npm run ingest:fixtures:validate` 로 확인한다.
 *    평가원 자료의 저작권 안내(비영리 이용 조건 등)를 확인하기 전까지 정책은 source_redirect 로 유지한다.
 */
export const KICE_DEFINITION: BoardSourceDefinition = {
  maxPages: 20,
  listUrl(baseUrl, page) {
    const url = new URL("/boardCnts/list.do", baseUrl);
    url.searchParams.set("boardID", "1500234");
    url.searchParams.set("m", "0403");
    url.searchParams.set("s", "suneung");
    url.searchParams.set("page", String(page));
    return url.toString();
  },
  structure: {
    sourceId: "kice",
    listRow: "table.board_list tbody tr",
    rowTitleLink: "td.subject a",
    rowDate: "td.date",
    emptyMarker: ".no_data",
    idParam: "boardSeq",
    attachmentContainer: "ul.file_list",
    attachmentLink: "a",
    examTitlePattern: /(대학수학능력시험|수능|모의평가)/,
  },
};
