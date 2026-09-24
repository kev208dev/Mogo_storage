/**
 * mock storage용 placeholder 파일 생성기.
 * 실제 저작권 자료 대신 "샘플 파일" 임을 알리는 작은 PDF와 무음 WAV를 만든다.
 */

export function createPlaceholderPdf(lines: string[]): Uint8Array<ArrayBuffer> {
  const escape = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
  const text = lines
    .map(
      (line, i) => `BT /F1 ${i === 0 ? 20 : 12} Tf 60 ${760 - i * 28} Td (${escape(line)}) Tj ET`,
    )
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/** 8kHz / 8bit / mono 무음 WAV */
export function createSilentWav(seconds: number): Uint8Array<ArrayBuffer> {
  const sampleRate = 8000;
  const dataSize = Math.max(1, Math.round(sampleRate * seconds));
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  write(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).fill(128); // 8bit PCM 무음 = 128
  return new Uint8Array(buffer);
}
