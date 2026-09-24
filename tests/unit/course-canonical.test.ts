import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { courseSlotKey, normalizeCourseLabel, resolveCourse } from "@/ingestion/canonical/course";
import { COURSE_CATALOG, courseByCode, courseSeoName, isCourseCode } from "@/lib/courses";

const code = (label: string, subject?: "social" | "science" | "math" | "korean") => {
  const r = resolveCourse(label, { subject });
  return r.status === "resolved" ? r.code : r.status;
};

describe("course catalog", () => {
  it("codes are URL-safe, unique and seeded by the migration", () => {
    const codes = COURSE_CATALOG.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(isCourseCode(c)).toBe(true);
    const sql = readFileSync("drizzle/0002_course_aware.sql", "utf8");
    const regimes = readFileSync("drizzle/0003_exam_regimes_and_subjects.sql", "utf8");
    for (const c of COURSE_CATALOG) {
      // 직업탐구·제2외국어 course 는 새 enum 값을 쓰므로 migration 이 아니라 syncCourseCatalog 가 넣는다
      if (c.subject === "vocational" || c.subject === "second_language") continue;
      expect(sql).toContain(`('${c.code}', '${c.code}', '${c.name}', '${c.subject}'`);
      expect(regimes).toContain(
        `UPDATE "courses" SET "regimes" = '${JSON.stringify(c.regimes)}'::jsonb WHERE "id" = '${c.code}';`,
      );
    }
  });
  it("seo name drops the middle dot", () => {
    expect(courseSeoName(courseByCode("social-culture")!.name)).toBe("사회문화");
  });
});

describe("normalizeCourseLabel", () => {
  it.each([
    ["사회·문화", "사회문화"],
    ["생활과 윤리", "생활과윤리"],
    ["물리학 Ⅰ", "물리학1"],
    ["물리학Ⅱ", "물리학2"],
    ["물리학 I", "물리학1"],
    ["화학 II", "화학2"],
    ["지구과학Ⅰ", "지구과학1"],
  ])("%s → %s", (raw, out) => expect(normalizeCourseLabel(raw)).toBe(out));
});

describe("resolveCourse — canonical names, spacing, roman numerals, abbreviations", () => {
  it.each([
    ["사회문화", "social-culture"],
    ["사회·문화", "social-culture"],
    ["사문", "social-culture"],
    ["사회·문화 문제지", "social-culture"],
    ["사회문화영역_문제.pdf", "social-culture"],
    ["생활과윤리", "life-and-ethics"],
    ["생활과 윤리 정답", "life-and-ethics"],
    ["생윤", "life-and-ethics"],
    ["윤리와 사상", "ethics-and-thought"],
    ["정치와 법", "politics-and-law"],
    ["한국지리 문제", "korean-geography"],
    ["세계지리", "world-geography"],
    ["동아시아사", "east-asian-history"],
    ["세계사", "world-history"],
    ["경제", "economics"],
    ["물리학1", "physics-1"],
    ["물리Ⅰ", "physics-1"],
    ["물리학 I", "physics-1"],
    ["물리I", "physics-1"],
    ["물1", "physics-1"],
    ["화학Ⅱ 해설", "chemistry-2"],
    ["생명과학 I", "life-science-1"],
    ["지구과학Ⅱ", "earth-science-2"],
    ["확률과 통계", "probability-and-statistics"],
    ["미적분", "calculus"],
    ["언어와 매체", "language-and-media"],
    ["통합사회", "integrated-social"],
  ])("%s → %s", (label, expected) => expect(code(label)).toBe(expected));

  it("does not guess ambiguous labels", () => {
    for (const label of [
      "윤리",
      "윤리 문제",
      "지리",
      "물리",
      "화학 문제지",
      "생명과학",
      "지구과학",
    ]) {
      const r = resolveCourse(label);
      expect(r.status, label).toBe("ambiguous");
    }
    const r = resolveCourse("윤리");
    expect(r.status === "ambiguous" && r.candidates).toEqual([
      "life-and-ethics",
      "ethics-and-thought",
    ]);
  });

  it("the longest name wins over an ambiguous substring", () => {
    expect(code("생활과윤리문제")).toBe("life-and-ethics");
    expect(code("물리학Ⅱ")).toBe("physics-2");
  });

  it("abbreviations only count as a standalone token", () => {
    expect(code("사문")).toBe("social-culture");
    expect(resolveCourse("사문학개론").status).not.toBe("resolved");
  });

  it("a label naming several courses is ambiguous (e.g. bundled papers)", () => {
    expect(resolveCourse("사회문화 경제 문제").status).toBe("ambiguous");
  });

  it("subject scope filters candidates", () => {
    expect(code("경제", "science")).toBe("none");
    expect(code("사회탐구", "social")).toBe("none"); // 영역 이름은 course 가 아님
  });

  it("admin aliases are reused, source-specific first", () => {
    const aliases = [
      { alias: "윤리", code: "life-and-ethics", sourceId: "ebsi" },
      { alias: "윤리", code: "ethics-and-thought", sourceId: null },
    ];
    expect(resolveCourse("윤리", { sourceId: "ebsi", aliases })).toMatchObject({
      status: "resolved",
      code: "life-and-ethics",
      via: "alias",
    });
    expect(resolveCourse("윤리", { sourceId: "kice", aliases })).toMatchObject({
      status: "resolved",
      code: "ethics-and-thought",
    });
  });

  it("slot keys never use file names", () => {
    expect(courseSlotKey(resolveCourse("사회문화 문제"))).toBe("social-culture");
    expect(courseSlotKey(resolveCourse("사회·문화 문제지"))).toBe("social-culture");
    expect(courseSlotKey(resolveCourse("사회문화영역"))).toBe("social-culture");
    expect(courseSlotKey(resolveCourse("윤리"))).toBe("unresolved:윤리");
    expect(courseSlotKey(resolveCourse("국어"))).toBe("");
  });
});
