import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import { koreanFontPath } from "../vocabulary/pdf-generator";
import type { WorksheetSpec } from "./worksheet-spec";

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 48;
const SIZE = 10;
const LINE = 15;

/** 폭에 맞춰 줄바꿈 (공백 기준, 긴 단어는 글자 단위) */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  if (!text) return [""];
  const lines: string[] = [];
  let current = "";
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = "";
    let rest = word;
    while (rest && !fits(rest)) {
      let n = rest.length - 1;
      while (n > 1 && !fits(rest.slice(0, n))) n -= 1;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    current = rest;
  }
  if (current) lines.push(current);
  return lines;
}

/** 학습지 PDF (generated). 기존 단어장 PDF 와 같은 글꼴(Noto Sans KR, subset embed)을 쓴다 */
export async function renderWorksheetPdf(
  spec: WorksheetSpec,
  fontBytes?: Uint8Array,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes ?? (await readFile(koreanFontPath())), {
    subset: true,
  });
  doc.setTitle(spec.title);
  doc.setProducer("모의고사 창고");
  doc.setCreator("모의고사 창고 학습지 생성기");

  const usable = A4.w - MARGIN * 2;
  const xs: number[] = [];
  let acc = MARGIN;
  for (const c of spec.columns) {
    xs.push(acc);
    acc += c.width * usable;
  }
  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;
  const text = (t: string, x: number, size: number, color = rgb(0.1, 0.1, 0.1)) =>
    page.drawText(t, { x, y, size, font, color });
  const header = () => {
    spec.columns.forEach((c, i) => text(c.label, xs[i]!, 9, rgb(0.35, 0.35, 0.35)));
    y -= LINE;
  };
  const ensure = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([A4.w, A4.h]);
      y = A4.h - MARGIN;
      header();
    }
  };

  text(spec.title, MARGIN, 16);
  y -= 22;
  for (const l of wrapText(spec.sourceNote, font, 8, usable)) {
    text(l, MARGIN, 8, rgb(0.35, 0.35, 0.35));
    y -= 11;
  }
  y -= 10;
  header();

  for (const group of spec.groups) {
    if (group.heading) {
      ensure(LINE * 2);
      y -= 4;
      text(group.heading, MARGIN, 11, rgb(0.11, 0.3, 0.85));
      y -= LINE;
    }
    for (const row of group.rows) {
      const wrapped = row.cells.map((cell, i) =>
        wrapText(cell, font, SIZE, spec.columns[i]!.width * usable - 6),
      );
      const height = Math.max(...wrapped.map((w) => w.length)) * LINE;
      ensure(height);
      wrapped.forEach((cellLines, i) =>
        cellLines.forEach((l, j) =>
          page.drawText(l, { x: xs[i]!, y: y - j * LINE, size: SIZE, font }),
        ),
      );
      y -= height;
      page.drawLine({
        start: { x: MARGIN, y: y + LINE - 11 },
        end: { x: A4.w - MARGIN, y: y + LINE - 11 },
        thickness: 0.3,
        color: rgb(0.85, 0.85, 0.85),
      });
    }
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
