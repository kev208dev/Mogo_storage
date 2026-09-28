import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FixtureFetcher } from "../../src/ingestion/net/fixture-fetcher";
import {
  createMegaStudyAdapter,
  findMegaExamSeqInList,
  megaStudyAdapter,
  parseMegaCoreFragment,
  parseMegaInquiryFragment,
} from "../../src/ingestion/grade-cuts/adapters/megastudy";
import type { WatchExam, WatchSlot } from "../../src/ingestion/grade-cuts/core";
import type { Fetcher } from "../../src/ingestion/net/fetcher";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/grade-cuts/${name}.html`, import.meta.url), "utf8");
const g2: WatchExam = {
  id: "g2",
  year: 2025,
  grade: 2,
  month: 9,
  examDate: "2025-09-03",
  academicYear: 2027,
  examType: "school_mock",
};
const g1: WatchExam = { ...g2, id: "g1", grade: 1, year: 2026, examDate: "2026-09-02" };
const g2_2026: WatchExam = {
  ...g2,
  id: "g2-2026",
  year: 2026,
  examDate: "2026-09-02",
  academicYear: 2028,
};
const g3: WatchExam = { ...g2, id: "g3", grade: 3, year: 2026, month: 7, examDate: "2026-07-08" };
const slot = (subject: WatchSlot["subject"], courseCode: string | null = null): WatchSlot => ({
  examId: "x",
  subject,
  courseId: courseCode,
  courseCode,
  status: "watching",
  lastPolledAt: null,
});
const at = new Date("2026-09-26T00:00:00Z");

describe("MegaStudy 고1·고2 공개 원점수 표", () => {
  it("고2 국어·수학: 원점수 열만 읽는다 (표준점수·백분위 복사 금지)", () => {
    const out = parseMegaCoreFragment(
      fixture("mega-344-g2-core"),
      g2,
      [slot("korean"), slot("math"), slot("english")],
      at,
    );
    expect(out.map((c) => [c.subject, c.courseCode, c.cuts.slice(0, 3)])).toEqual([
      [
        "korean",
        null,
        [
          { grade: 1, rawScore: 86 },
          { grade: 2, rawScore: 77 },
          { grade: 3, rawScore: 68 },
        ],
      ],
      [
        "math",
        null,
        [
          { grade: 1, rawScore: 80 },
          { grade: 2, rawScore: 68 },
          { grade: 3, rawScore: 54 },
        ],
      ],
    ]);
    expect(out[0]!.cuts).toHaveLength(8);
    expect(out[0]!.sourceUrl).toMatch(/^https:\/\/m\.megastudy\.net\//);
  });

  it("고1 국어·수학도 같은 형식", () => {
    const out = parseMegaCoreFragment(fixture("mega-358-g1-core"), g1, [slot("korean")], at);
    expect(out[0]!.cuts[0]).toEqual({ grade: 1, rawScore: 87 });
  });

  it("고2 사회·과학탐구 세부과목", () => {
    const social = parseMegaInquiryFragment(
      fixture("mega-344-g2-social"),
      g2,
      [slot("social", "social-culture"), slot("social", "life-and-ethics")],
      at,
      "social",
    );
    expect(social.map((c) => c.courseCode).sort()).toEqual(["life-and-ethics", "social-culture"]);
    expect(social.find((c) => c.courseCode === "life-and-ethics")!.cuts[0]).toEqual({
      grade: 1,
      rawScore: 41,
    });
    const science = parseMegaInquiryFragment(
      fixture("mega-344-g2-science"),
      g2,
      [slot("science", "physics-1")],
      at,
      "science",
    );
    expect(science[0]!.cuts[0]).toEqual({ grade: 1, rawScore: 44 });
  });

  it("고3 국어·수학 표는 원점수 열이 없다 → adapter 가 요청하지 않고, 읽혀도 거부", () => {
    expect(megaStudyAdapter.supports!(g3, slot("korean"))).toBe(false);
    expect(megaStudyAdapter.supports!(g3, slot("math"))).toBe(false);
    expect(() =>
      parseMegaCoreFragment(fixture("mega-357-core"), g3, [slot("korean")], at),
    ).not.toThrow();
    // supports 가 false 라 요청 슬롯이 없음 → 빈 결과
    expect(parseMegaCoreFragment(fixture("mega-357-core"), g3, [slot("korean")], at)).toEqual([]);
  });

  it("고1 통합사회는 반점수(43.5) → 지원하지 않고, 읽혀도 표를 건너뛴다", () => {
    expect(megaStudyAdapter.supports!(g1, slot("social", "integrated-social"))).toBe(false);
    expect(megaStudyAdapter.supports!(g1, slot("korean"))).toBe(true);
    expect(megaStudyAdapter.supports!(g2, slot("math"))).toBe(true);
    expect(megaStudyAdapter.supports!(g2, slot("english"))).toBe(false);
    expect(megaStudyAdapter.supports!(g2, slot("math", "math-1"))).toBe(false);
  });

  it("2026년 고2는 2028 체제 통합사회·통합과학 course를 지원한다", () => {
    expect(megaStudyAdapter.supports!(g2_2026, slot("social", "integrated-social"))).toBe(true);
    expect(megaStudyAdapter.supports!(g2_2026, slot("science", "integrated-science"))).toBe(true);
  });

  it("2026년 고2 통합사회·통합과학 표를 2028 체제 course로 parse한다", () => {
    const social = parseMegaInquiryFragment(
      fixture("mega-344-g2-social")
        .replaceAll("2025.09.03", "2026.09.02")
        .replace("사회·문화", "통합사회"),
      g2_2026,
      [slot("social", "integrated-social")],
      at,
      "social",
    );
    const science = parseMegaInquiryFragment(
      fixture("mega-344-g2-science")
        .replaceAll("2025.09.03", "2026.09.02")
        .replace("물리학 I", "통합과학"),
      g2_2026,
      [slot("science", "integrated-science")],
      at,
      "science",
    );
    expect(social[0]?.courseCode).toBe("integrated-social");
    expect(science[0]?.courseCode).toBe("integrated-science");
  });

  it("시험 정체성·만점·헤더가 어긋나면 거부", () => {
    const core = fixture("mega-344-g2-core");
    expect(() => parseMegaCoreFragment(core, g1, [slot("korean")], at)).toThrow(/identity/);
    expect(() =>
      parseMegaCoreFragment(
        core.replace(/(만점<\/td>\s*<td>)100/, "$195"),
        g2,
        [slot("korean")],
        at,
      ),
    ).toThrow(/max score/);
    expect(() =>
      parseMegaCoreFragment(
        core.replace("<th>원점수</th>", "<th>표준점수</th>"),
        g2,
        [slot("korean")],
        at,
      ),
    ).toThrow(/header/);
  });

  it("고1·고2 current exam list can discover an exam before the main selector lists it", async () => {
    const examListUrl = "https://m.megastudy.net/Entinfo/total_rankCut/main_examNm_ax.asp";
    const fragmentUrl = "https://m.megastudy.net/Entinfo/total_rankCut/main_examRankCut_ax.asp";
    const fetcher = new FixtureFetcher(
      {
        [examListUrl]: "tests/fixtures/grade-cuts/mega-list-g2.html",
        [fragmentUrl]: "tests/fixtures/grade-cuts/mega-344-g2-core.html",
      },
      process.cwd(),
    );
    const adapter = createMegaStudyAdapter(fetcher);
    const rows = await adapter.collect(g2, [slot("korean")]);
    expect(rows[0]?.cuts[0]).toEqual({ grade: 1, rawScore: 86 });
    expect(fetcher.requested).toEqual([examListUrl, fragmentUrl]);
  });

  it("discovers the current 2026 high-school 2 exam before requesting its score fragment", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const list = fixture("mega-list-g2");
    const fragment = fixture("mega-344-g2-core").replaceAll("2025.09.03", "2026.09.02");
    const fetcher: Fetcher = {
      async fetch(url, options) {
        requests.push({ url, body: String(options?.body ?? "") });
        const body = url.includes("main_examNm_ax") ? list : fragment;
        return {
          url,
          status: 200,
          contentType: "text/html; charset=utf-8",
          headers: new Headers(),
          bytes: new TextEncoder().encode(body),
        };
      },
    };
    const adapter = createMegaStudyAdapter(fetcher);
    const result = await adapter.collect(g2_2026, [slot("korean"), slot("math")]);

    expect(requests[0]?.url).toContain("main_examNm_ax.asp");
    expect(requests[1]?.url).toContain("main_examRankCut_ax.asp");
    expect(requests[1]?.body).toContain("examSeq=359");
    expect(result.map((row) => row.subject).sort()).toEqual(["korean", "math"]);
  });

  it("고1·고2 시험 목록에서 같은 날짜·종류가 하나일 때만 examSeq", () => {
    const list = fixture("mega-list-g2");
    expect(findMegaExamSeqInList(list, g2)).toBe("344");
    expect(findMegaExamSeqInList(list, { ...g2, examDate: "2025-09-04" })).toBeNull();
    expect(findMegaExamSeqInList(list, { ...g2, grade: 3 })).toBeNull();
    expect(findMegaExamSeqInList(list, { ...g2, examType: "kice_mock" })).toBeNull();
  });
});
