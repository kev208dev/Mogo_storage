/**
 * verify-browser 결과 중 visual 판정 자료의 머리말 캡처를 한 장에 여러 개씩 모은다.
 * 각 캡처 위에 번호와 CSV 기대값(연도·학년·월·영역·세부과목·종류)을 적어 사람이 대조하기 쉽게 한다.
 * 사용: node --import tsx scripts/official-url-search/contact-sheet.mts --verify=<verify.json> --out=<폴더> [--year=2025] [--per=6]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);
const per = Number(args.per || 6);
mkdirSync(args.out!, { recursive: true });
type Rec = {
  decision: string;
  shot?: string;
  examLine?: string | null;
  row: Record<string, string>;
};
const verify = JSON.parse(readFileSync(args.verify!, "utf8")) as Record<string, Rec>;
const items = Object.entries(verify).filter(
  ([, r]) => r.decision === "visual" && r.shot && (!args.year || r.row.year === args.year),
);
const W = 1000;
const LABEL = 58;
const H = 210;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const index: Array<{ sheet: string; n: number; url: string }> = [];
for (let s = 0; s * per < items.length; s++) {
  const chunk = items.slice(s * per, s * per + per);
  const composites: OverlayOptions[] = [];
  chunk.forEach(([url, r], k) => {
    const n = s * per + k + 1;
    const x = r.row;
    const label = `#${n}  기대: ${x.year} 고${x.grade} ${x.month}월 ${x.exam_type} · ${x.subject}${x.course_code ? "/" + x.course_code : ""} · ${x.file_type} · ${url.split("/").pop()}`;
    composites.push({
      input: Buffer.from(
        `<svg width="${W}" height="${LABEL}"><rect width="100%" height="100%" fill="#ffe680"/><text x="8" y="23" font-size="18" font-family="sans-serif">${esc(label)}</text><text x="8" y="48" font-size="17" font-family="sans-serif" fill="${r.examLine ? "#135" : "#b00"}">${esc(`문서 안 시험 문구: ${r.examLine ?? "없음"}`)}</text></svg>`,
      ),
      top: k * (H + LABEL),
      left: 0,
    });
    composites.push({ input: r.shot!, top: k * (H + LABEL) + LABEL, left: 0 });
    index.push({ sheet: `sheet-${s + 1}.png`, n, url });
  });
  await sharp({
    create: { width: W, height: chunk.length * (H + LABEL), channels: 3, background: "#ffffff" },
  })
    .composite(composites)
    .png()
    .toFile(path.join(args.out!, `sheet-${s + 1}.png`));
}
writeFileSync(path.join(args.out!, "index.json"), JSON.stringify(index, null, 1));
console.log(`${items.length} visual → ${Math.ceil(items.length / per)} sheets`);
