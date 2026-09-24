import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";

export interface VocabularyPdfEntry {
  questionNumber: number;
  word: string;
  meaning: string;
  partOfSpeech: string | null;
}

/** Noto Sans KR (SIL OFL 1.1) — node_modules 에서 읽어 사용한 글자만 subset embed */
export const KOREAN_FONT_RELATIVE_PATH =
  "node_modules/@expo-google-fonts/noto-sans-kr/400Regular/NotoSansKR_400Regular.ttf";

export function koreanFontPath(): string {
  return path.join(process.cwd(), KOREAN_FONT_RELATIVE_PATH);
}

/**
 * 지문별 단어장 PDF 생성. 이 PDF 는 "우리가 만든 자료"(artifactOrigin=generated)이며
 * 원본 시험 PDF 와 섞지 않는다.
 */
export async function generateVocabularyPdf(input: {
  title: string;
  entries: VocabularyPdfEntry[];
  sourceNote: string;
  fontBytes?: Uint8Array;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(input.fontBytes ?? (await readFile(koreanFontPath())), {
    subset: true,
  });
  doc.setTitle(input.title);
  doc.setProducer("모의고사 창고");
  doc.setCreator("모의고사 창고 단어장 생성기");

  const A4 = { w: 595.28, h: 841.89 };
  const margin = 48;
  const lineHeight = 18;
  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - margin;

  const drawText = (text: string, x: number, size: number, color = rgb(0.1, 0.1, 0.1)) =>
    page.drawText(text, { x, y, size, font, color });

  const newPage = () => {
    page = doc.addPage([A4.w, A4.h]);
    y = A4.h - margin;
  };

  drawText(input.title, margin, 16);
  y -= 22;
  drawText(input.sourceNote, margin, 8, rgb(0.35, 0.35, 0.35));
  y -= 24;

  let currentQuestion: number | null = null;
  for (const entry of input.entries) {
    if (y < margin + lineHeight * 2) newPage();
    if (entry.questionNumber !== currentQuestion) {
      currentQuestion = entry.questionNumber;
      y -= 6;
      drawText(`${entry.questionNumber}번`, margin, 11, rgb(0.11, 0.3, 0.85));
      y -= lineHeight;
    }
    drawText(entry.word, margin + 12, 10);
    const pos = entry.partOfSpeech ? `${entry.partOfSpeech} ` : "";
    drawText(`${pos}${entry.meaning}`.slice(0, 60), margin + 220, 10);
    y -= lineHeight;
  }

  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText(`${i + 1} / ${pages.length}`, {
      x: A4.w / 2 - 12,
      y: 24,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    }),
  );
  return doc.save();
}
