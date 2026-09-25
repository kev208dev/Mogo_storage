/**
 * 운영자 CSV 의 공식 URL 을 실제 브라우저(Chromium)로 열어 확인한다.
 *
 * - 브라우저로 URL 을 연다 → HTTP 상태 · Content-Type 확인
 * - 같은 페이지 안에서 PDF 본문을 받아 %PDF 여부 · 페이지 수 확인
 * - 1쪽 텍스트 머리말이 CSV(학년도·시험·학년·월·영역·세부과목·문제/해설)와 모두 맞으면 text_ok
 * - 머리말이 텍스트로 없으면(그림으로 박힌 문제지 등) 브라우저 PDF 뷰어 화면의 머리말을 캡처해 사람이 본다 (visual)
 * - PDF 가 아니거나 열리지 않으면 fail
 *
 * 사용: node --import tsx scripts/official-url-search/verify-browser.mts \
 *        --csv=data/imports/official-urls.csv --out=<결과.json> --shots=<캡처 폴더> [--year=2025 --grade=3 --month=6 --limit=5]
 * 결과 파일에 이미 있는 URL 은 건너뛴다 (이어서 실행 가능). 요청 간격 2초.
 */
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { parseCsv } from "../../src/ingestion/manual-import/csv";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "1"];
  }),
);
const out = args.out!;
const shots = args.shots!;
mkdirSync(shots, { recursive: true });

const SUBJECT_KO: Record<string, string[]> = {
  korean: ["국어"],
  math: ["수학"],
  english: ["영어"],
  history: ["한국사"],
  social: ["사회탐구", "통합사회"],
  science: ["과학탐구", "통합과학"],
  vocational: ["직업탐구"],
  second_language: ["제2외국어", "한문"],
};
const COURSE_KO: Record<string, string> = {
  "life-and-ethics": "생활과윤리",
  "ethics-and-thought": "윤리와사상",
  "korean-geography": "한국지리",
  "world-geography": "세계지리",
  "east-asian-history": "동아시아사",
  "world-history": "세계사",
  economics: "경제",
  "politics-and-law": "정치와법",
  "social-culture": "사회문화",
  "physics-1": "물리학1",
  "chemistry-1": "화학1",
  "life-science-1": "생명과학1",
  "earth-science-1": "지구과학1",
  "physics-2": "물리학2",
  "chemistry-2": "화학2",
  "life-science-2": "생명과학2",
  "earth-science-2": "지구과학2",
  "agriculture-basics": "농업기초기술",
  "industry-general": "공업일반",
  "commercial-economics": "상업경제",
  "fisheries-and-shipping": "수산해운산업기초",
  "human-development": "인간발달",
  "successful-career-life": "성공적인직업생활",
  "german-1": "독일어1",
  "french-1": "프랑스어1",
  "spanish-1": "스페인어1",
  "chinese-1": "중국어1",
  "japanese-1": "일본어1",
  "russian-1": "러시아어1",
  "arabic-1": "아랍어1",
  "vietnamese-1": "베트남어1",
  "classical-chinese-1": "한문1",
  "integrated-social": "통합사회",
  "integrated-science": "통합과학",
};
const norm = (t: string) =>
  t
    .replace(/Ⅰ/g, "1")
    .replace(/Ⅱ/g, "2")
    .replace(/[\s‧・·ㆍ･․∙.,]/g, "");

type Row = Record<string, string>;
const csv = parseCsv(readFileSync(args.csv!, "utf8"));
const header = csv[0]!.cells;
let rows: Row[] = csv
  .slice(1)
  .map(({ cells }) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
if (args.year) rows = rows.filter((r) => r.year === args.year);
if (args.grade) rows = rows.filter((r) => r.grade === args.grade);
if (args.month) rows = rows.filter((r) => r.month === args.month);
if (args.limit) rows = rows.slice(0, Number(args.limit));

const results: Record<string, unknown> = existsSync(out)
  ? JSON.parse(readFileSync(out, "utf8"))
  : {};

function checkHeader(r: Row, h: string) {
  const y = Number(r.year);
  const m = Number(r.month);
  const yearTok = String(r.exam_type === "school_mock" ? y : y + 1);
  // 추출 텍스트 순서가 섞이는 경우("학년도대학수학능력시험월모의평가20266")도 인정
  const monthOk =
    h.includes(`${m}월`) ||
    (h.includes("월") &&
      (new RegExp(`(?<!\\d)${m}(?!\\d)`).test(h) || h.includes(`${yearTok}${m}`)));
  const c: Record<string, boolean> = {
    year: h.includes(yearTok) && h.includes("학년도"),
    exam:
      r.exam_type === "csat"
        ? h.includes("대학수학능력시험") && !h.includes("모의평가")
        : r.exam_type === "kice_mock"
          ? h.includes("모의평가") && monthOk
          : h.includes("학력평가") && monthOk && h.includes(`고${r.grade}`),
    // "수학" 은 "대학수학능력시험" 안에도 있으므로 시험명을 빼고 찾는다
    subject: (SUBJECT_KO[r.subject!] ?? []).some((s) =>
      h
        .replaceAll("대학수학능력", "")
        .replaceAll("외국어", s === "국어" ? "" : "외국어")
        .includes(s),
    ),
    course:
      !r.course_code ||
      (r.course_code === "economics" ? h.replaceAll("상업경제", "") : h).includes(
        COURSE_KO[r.course_code]!,
      ),
    type:
      r.file_type === "solution"
        ? /정답(및|과)해설/.test(h)
        : r.file_type === "listening_script"
          ? h.includes("듣기대본")
          : h.includes("문제지") && !h.includes("해설"),
  };
  // 같은 영역의 다른 세부과목 이름이 머리말에 있으면 텍스트만으로 확정하지 않는다
  const otherCourse = Object.entries(COURSE_KO).find(
    ([code, name]) =>
      code !== r.course_code &&
      name.length > 2 &&
      h.includes(name) &&
      !h.includes(COURSE_KO[r.course_code!] ?? "\0"),
  );
  return { checks: c, otherCourse: r.course_code ? (otherCourse?.[0] ?? null) : null };
}

/** 문서 전체에서 이 시험을 가리키는 정확한 문구 (공백 제거 후). 예: 2025학년도3월고1전국연합학력평가 */
function examLine(r: Row, all: string): string | null {
  const y = Number(r.year);
  const m = Number(r.month);
  const pats =
    r.exam_type === "school_mock"
      ? [`${y}학년도${m}월고${r.grade}전국연합학력평가`]
      : r.exam_type === "kice_mock"
        ? [
            `${y + 1}학년도대학수학능력시험${m}월모의평가`,
            `${y + 1}학년도${m}월모의평가`,
            `${y + 1}학년도${m}월대학수학능력모의평가`,
          ]
        : [`${y + 1}학년도대학수학능력시험`];
  for (const p of pats) {
    const at = all.indexOf(p);
    if (at < 0) continue;
    // 수능 문구 뒤에 곧바로 "N월모의평가" 가 붙으면 수능이 아니다
    if (r.exam_type === "csat" && /^\d{1,2}월모의평가/.test(all.slice(at + p.length))) continue;
    return p;
  }
  return null;
}

const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  proxy: process.env.https_proxy ? { server: process.env.https_proxy } : undefined,
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
let i = 0;
for (const r of rows) {
  const url = r.official_url!;
  i += 1;
  if (results[url]) continue;
  const rec: Record<string, unknown> = { row: r, checkedAt: new Date().toISOString() };
  try {
    const resp = await page.goto(url, { timeout: 45000 });
    rec.status = resp?.status();
    rec.contentType = resp?.headers()["content-type"];
    rec.finalUrl = page.url();
    const b64 = await page.evaluate(async (u) => {
      const res = await fetch(u);
      const a = new Uint8Array(await res.arrayBuffer());
      let s = "";
      for (let k = 0; k < a.length; k += 0x8000)
        s += String.fromCharCode(...a.subarray(k, k + 0x8000));
      return btoa(s);
    }, url);
    const buf = Buffer.from(b64, "base64");
    rec.bytes = buf.length;
    rec.magic = buf.subarray(0, 5).toString("latin1");
    if (rec.status !== 200 || rec.magic !== "%PDF-" || !String(rec.contentType).includes("pdf")) {
      rec.decision = "fail";
      rec.reason = "PDF 가 아님 또는 HTTP 오류";
    } else {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { totalPages, text } = await extractText(pdf, { mergePages: false });
      rec.pages = totalPages;
      const p1 = norm((text as string[])[0] ?? "");
      const cut = p1.search(/01\.|\[1[~～]|(?<![0-9Ⅰ-Ⅱ가-힣])1\.[가-힣]/);
      const h = p1.slice(0, Math.min(cut > 20 ? cut : 300, 300));
      rec.headerText = h;
      rec.page1Text = p1.slice(0, 1500);
      const { checks, otherCourse } = checkHeader(r, h);
      rec.checks = checks;
      rec.otherCourse = otherCourse;
      const all = norm((text as string[]).join(""));
      rec.examLine = examLine(r, all);
      const contentChecks = { subject: checks.subject, course: checks.course, type: checks.type };
      if (Object.values(checks).every(Boolean) && !otherCourse) {
        rec.decision = "text_ok";
      } else if (rec.examLine && Object.values(contentChecks).every(Boolean) && !otherCourse) {
        // 1쪽 머리말에 연도·월이 없어도 문서 안에 이 시험의 정확한 문구가 있고 영역·과목·종류가 맞으면 인정
        rec.decision = "text_ok";
        rec.via = "examLine";
      } else {
        rec.decision = "visual";
        await page.waitForTimeout(3500); // 뷰어가 1쪽을 그릴 시간
        const shot = path.join(
          shots,
          `${createHash("sha1").update(url).digest("hex").slice(0, 12)}.png`,
        );
        await page.screenshot({ path: shot, clip: { x: 0, y: 40, width: 1000, height: 210 } });
        rec.shot = shot;
      }
    }
  } catch (e) {
    rec.decision = "fail";
    rec.reason = String(e).split("\n")[0];
  }
  results[url] = rec;
  writeFileSync(out, JSON.stringify(results, null, 1));
  console.log(
    i,
    rec.decision,
    r.year,
    `고${r.grade}`,
    `${r.month}월`,
    r.subject,
    r.course_code,
    r.file_type,
    rec.decision === "visual" ? rec.shot : "",
  );
  await page.waitForTimeout(2000);
}
await browser.close();
