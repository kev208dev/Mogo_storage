import { parse, type HTMLElement } from "node-html-parser";

export type { HTMLElement };

export function parseHtml(html: string): HTMLElement {
  return parse(html, { comment: false, blockTextElements: { script: true, style: true } });
}

export function text(el: HTMLElement | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** onclick="fn('url', ...)" 또는 href 에서 첫 번째 URL 인자를 꺼낸다 */
export function extractLinkTarget(el: HTMLElement): string | null {
  const href = el.getAttribute("href");
  if (href && !href.startsWith("javascript:") && href !== "#") return href.trim();
  const source = `${el.getAttribute("onclick") ?? ""} ${href ?? ""}`;
  const match = /\(\s*['"]([^'"]+)['"]/.exec(source);
  return match ? match[1]!.trim() : null;
}

export function absoluteUrl(target: string, base: string): string | null {
  try {
    return new URL(target, base).toString();
  } catch {
    return null;
  }
}

/**
 * <table> → 2차원 격자 (rowspan/colspan 을 펼친다). 같은 셀이 여러 칸에 들어갈 수 있다.
 * selector 대신 표의 머리글 텍스트로 열 역할을 찾는 parser(KICE 시험별 자료 표 등)에서 쓴다.
 */
export function tableGrid(table: HTMLElement): HTMLElement[][] {
  const grid: HTMLElement[][] = [];
  const rows = table.querySelectorAll("tr");
  rows.forEach((tr, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const cell of tr.childNodes.filter(
      (n): n is HTMLElement =>
        (n as HTMLElement).tagName === "TD" || (n as HTMLElement).tagName === "TH",
    )) {
      while (grid[r]![c]) c += 1;
      const rowspan = Math.max(1, Math.min(50, Number(cell.getAttribute("rowspan") ?? 1) || 1));
      const colspan = Math.max(1, Math.min(50, Number(cell.getAttribute("colspan") ?? 1) || 1));
      for (let dr = 0; dr < rowspan; dr += 1) {
        grid[r + dr] ??= [];
        for (let dc = 0; dc < colspan; dc += 1) grid[r + dr]![c + dc] = cell;
      }
      c += colspan;
    }
  });
  return grid.filter((row) => row.length > 0);
}

/** 비교용 표기 정규화: NFKC, 공백 제거 */
export function compact(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "");
}
