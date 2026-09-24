import { canonicalizeExamTitle } from "../canonical/exam-title";
import type { CanonicalExam, DiscoveredArtifact } from "../types";
import { absoluteUrl, compact, extractLinkTarget, parseHtml, text } from "./html";

/**
 * 영어 듣기 자료 페이지(pageType: listening_archive) parser.
 * EBSi 등에서 영어 듣기 자료는 일반 기출 목록과 별개 페이지로 MP3 · 문제 PDF · 정답 PDF · 대본 PDF · ZIP 을 줄 수 있다.
 *
 * ⚠️ 검증 상태: 실제 페이지를 확보하지 못해 사이트 고유 selector 를 쓰지 않는다. 링크 텍스트/파일 확장자로만 분류한다.
 *  - MP3 → english / listening_audio
 *  - 대본 PDF → english / listening_script
 *  - ZIP → archive (자동 압축 해제하지 않음 → manual_review)
 *  - 듣기 문제·정답 PDF → 본 시험 영어 문제지/해설 슬롯을 덮어쓰지 않도록 수집하지 않고 경고로 남긴다
 */
export interface ParsedListeningArchive {
  title: string | null;
  exam: CanonicalExam | null;
  artifacts: DiscoveredArtifact[];
  warnings: Array<{ code: string; message: string }>;
}

function extensionOf(url: string): string {
  try {
    return (new URL(url).pathname.split(".").pop() ?? "").toLowerCase();
  } catch {
    return "";
  }
}

export function parseListeningArchive(
  html: string,
  context: { pageUrl: string; examTitle?: string | null },
): ParsedListeningArchive {
  const root = parseHtml(html);
  const warnings: ParsedListeningArchive["warnings"] = [];
  const title =
    context.examTitle ??
    root
      .querySelectorAll("h1, h2, h3, caption, title")
      .map((el) => text(el))
      .find((t) => /(학년도|학력평가|모의평가|수학능력시험|듣기)/.test(t)) ??
    null;
  const canonical = title ? canonicalizeExamTitle(title) : null;
  if (!title || !canonical?.ok) {
    warnings.push({ code: "UNRECOGNIZED_TITLE", message: title ?? "no title" });
  }

  const artifacts: DiscoveredArtifact[] = [];
  const seen = new Set<string>();
  for (const link of root.querySelectorAll("a, button")) {
    const target = extractLinkTarget(link);
    const url = target ? absoluteUrl(target, context.pageUrl) : null;
    if (!url || seen.has(url)) continue;
    const label = text(link) || link.getAttribute("title") || "";
    const c = compact(label).toLowerCase();
    const ext = extensionOf(url);
    const isArchive = ext === "zip" || /zip|압축|전체받기/.test(c);
    const isAudio = ext === "mp3" || /mp3|음원|듣기파일/.test(c);
    const isScript = /대본|스크립트|script/.test(c);
    const isPdfDoc = ext === "pdf" || /문제|정답|해설/.test(c);
    if (!isArchive && !isAudio && !isScript && !isPdfDoc) continue;
    seen.add(url);
    const base = {
      subject: "english" as const,
      url,
      label,
      fileNameHint: decodeURIComponent(url.split("/").pop() ?? "") || label || null,
      publishedAt: null,
      course: { status: "none" as const },
      courseLabel: null,
      containsMultipleCourses: false,
      sourceSubjectLabel: "영어 듣기",
      sourceLabel: `영어 듣기 ${label}`.trim(),
    };
    if (isArchive) {
      artifacts.push({ ...base, type: "listening_audio", containerType: "archive" });
    } else if (isScript) {
      artifacts.push({ ...base, type: "listening_script", containerType: "file" });
    } else if (isAudio) {
      artifacts.push({ ...base, type: "listening_audio", containerType: "file" });
    } else {
      warnings.push({
        code: "LISTENING_PDF_SKIPPED",
        message: `${label || url}: 듣기 문제/정답 PDF 는 본 시험 영어 슬롯을 덮어쓰지 않도록 수집하지 않음`,
      });
    }
  }
  return {
    title,
    exam: canonical?.ok ? canonical.exam : null,
    artifacts,
    warnings,
  };
}
