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
