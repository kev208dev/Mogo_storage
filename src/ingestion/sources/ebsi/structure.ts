import type { Grade } from "../../../lib/constants";

/**
 * EBSi 기출문제의 2026-10 live 구조.
 *
 * 메인 페이지는 검색 조건만 렌더하고 실제 기출 목록은
 * /ebs/xip/xipc/previousPaperListAjax.ajax POST 응답으로 제공한다.
 * 다운로드 버튼의 onclick 인자에는 공개 wdown 파일 경로와 irecord 가 들어 있다.
 *
 * 실제 live page로 검증된 selector/contract만 이 파일에 둔다.
 */
export const EBSI_STRUCTURE = {
  item: ".qus_box",
  flags: ".qus_flag span",
  title: ".qus_tit",
  downloadButton: ".btn_dwonload button[onclick]",
  total: ".tot",
  pageSize: 15,
  listAjaxPath: "/ebs/xip/xipc/previousPaperListAjax.ajax",
} as const;

export const EBSI_AREA_ORDERS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;
export const EBSI_MONTHS = ["03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;

/** 학년 코드: D100 / D200 / D300 */
export function ebsiListingUrl(baseUrl: string, grade: Grade, year: number): string {
  const url = new URL("/ebs/xip/xipc/previousPaperList.ebs", baseUrl);
  url.searchParams.set("targetCd", `D${grade}00`);
  url.searchParams.set("year", String(year));
  return url.toString();
}

export function ebsiListAjaxUrl(baseUrl: string): string {
  return new URL(EBSI_STRUCTURE.listAjaxPath, baseUrl).toString();
}

export function ebsiListBody(input: {
  grade: Grade;
  year: number;
  month?: number | null;
  /** discovery 는 한 영역만 조회해 시험 identity 중복을 줄인다. */
  areaOrders?: readonly string[];
  page?: number;
}): URLSearchParams {
  const months = input.month
    ? [String(input.month).padStart(2, "0")]
    : [...EBSI_MONTHS];
  return new URLSearchParams({
    targetCd: `D${input.grade}00`,
    yearList: String(input.year),
    monthList: months.join(","),
    arOrd: (input.areaOrders ?? EBSI_AREA_ORDERS).join(","),
    subjIdList: "firstEnter",
    currentPage: String(input.page ?? 1),
    sort: "recent",
    paperId: "",
    paperNo: "",
    lvl: "",
  });
}
