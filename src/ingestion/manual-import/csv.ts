/**
 * 작은 RFC 4180 CSV parser (의존성 없음). 따옴표 필드, 따옴표 안 쉼표/줄바꿈, "" escape, CRLF, UTF-8 BOM 지원.
 * 결과는 [행][열] 문자열 배열이며 줄 번호(1부터, 헤더 포함)를 함께 돌려준다.
 */
export interface CsvRow {
  line: number;
  cells: string[];
}

export function parseCsv(text: string): CsvRow[] {
  const src = text.replace(/^﻿/, "");
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") inQuotes = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      cells.push(cell);
      if (cells.some((c) => c.trim() !== "")) rows.push({ line: rowStart, cells });
      cells = [];
      cell = "";
      line += 1;
      rowStart = line;
    } else cell += ch;
  }
  if (inQuotes) throw new Error(`CSV: ${rowStart}번째 줄의 따옴표가 닫히지 않았습니다`);
  cells.push(cell);
  if (cells.some((c) => c.trim() !== "")) rows.push({ line: rowStart, cells });
  return rows;
}
