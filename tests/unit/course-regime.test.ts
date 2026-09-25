import { describe, expect, it } from "vitest";
import { applyRegime, resolveCourse, type CourseAlias } from "@/ingestion/canonical/course";
import { classifyArtifact } from "@/ingestion/canonical/classify";
import { finalCourseResolution } from "@/ingestion/pipeline/artifacts";
import { courseExpectation, coursesForExam, coursesForSubject } from "@/lib/courses";
import { cohortYear, regimeFor } from "@/lib/regimes";

const exam = (year: number, grade: 1 | 2 | 3) => ({ year, grade });

describe("시험 체제 (regime)", () => {
  it("cohort = 시행연도 + (4 - 학년): 같은 해 고1과 고3은 다른 체제일 수 있다", () => {
    expect(cohortYear(exam(2025, 3))).toBe(2026);
    expect(cohortYear(exam(2025, 1))).toBe(2028);
    expect(regimeFor(exam(2025, 3)).code).toBe("csat_2022");
    expect(regimeFor(exam(2025, 1)).code).toBe("csat_2028");
  });

  it("경계: 2027학년도 수능 대상까지 csat_2022, 2028학년도부터 csat_2028", () => {
    expect(regimeFor(exam(2026, 3)).code).toBe("csat_2022"); // cohort 2027
    expect(regimeFor(exam(2026, 2)).code).toBe("csat_2028"); // cohort 2028
    expect(regimeFor(exam(2027, 3)).code).toBe("csat_2028");
    expect(regimeFor(exam(2020, 3)).code).toBe("legacy"); // cohort 2021
    expect(regimeFor(exam(2021, 3)).code).toBe("csat_2022"); // cohort 2022
    expect(regimeFor(exam(2006, 3)).code).toBe("legacy");
  });

  it("2028 체제 시험에는 선택과목(물리학 I 등)이 없다 → 추정하지 않음", () => {
    expect(courseExpectation("physics-1", exam(2027, 3))).toBe("unexpected");
    expect(courseExpectation("integrated-science", exam(2027, 3))).toBe("expected");
    expect(courseExpectation("physics-1", exam(2025, 3))).toBe("expected");
    // 고1 시험 (2015 교육과정): 통합사회는 있고 사회·문화는 없다
    expect(courseExpectation("integrated-social", exam(2023, 1))).toBe("expected");
    expect(courseExpectation("social-culture", exam(2023, 1))).toBe("unexpected");
    // 과거 체제는 구성 미확인
    expect(courseExpectation("physics-1", exam(2012, 3))).toBe("unknown");
  });

  it("applyRegime: 체제에 없는 카탈로그 판정은 ambiguous(manual_review), 이유를 남긴다", () => {
    const physics = resolveCourse("물리학Ⅰ", { subject: "science" });
    expect(physics.status).toBe("resolved");
    const future = applyRegime(physics, exam(2027, 3));
    expect(future).toMatchObject({ status: "ambiguous", candidates: ["physics-1"] });
    expect(future.status === "ambiguous" && future.reason).toMatch(/2028/);
    expect(applyRegime(physics, exam(2025, 3))).toEqual(physics);
  });

  it("과거 시험: 정확한 과목명만 인정, 약칭은 검토", () => {
    const exact = resolveCourse("생활과 윤리", { subject: "social" });
    const abbr = resolveCourse("생윤", { subject: "social" });
    expect(applyRegime(exact, exam(2012, 3)).status).toBe("resolved");
    expect(applyRegime(abbr, exam(2012, 3)).status).toBe("ambiguous");
  });

  it("체제별 가능한 세부과목 목록", () => {
    expect(coursesForExam("science", exam(2025, 3)).map((c) => c.code)).not.toContain(
      "integrated-science",
    );
    expect(coursesForExam("science", exam(2027, 3)).map((c) => c.code)).toEqual([
      "integrated-science",
    ]);
    expect(coursesForExam("second_language", exam(2025, 2))).toHaveLength(9);
    expect(coursesForExam("second_language", exam(2025, 3))).toHaveLength(9);
    expect(coursesForExam("vocational", exam(2025, 2))).toHaveLength(6);
  });
});

describe("직업탐구 / 제2외국어·한문", () => {
  it("카탈로그: 직업탐구 6과목, 제2외국어/한문 9과목", () => {
    expect(coursesForSubject("vocational")).toHaveLength(6);
    expect(coursesForSubject("second_language")).toHaveLength(9);
  });

  it.each([
    ["농업 기초 기술", "agriculture-basics"],
    ["공업 일반", "industry-general"],
    ["상업 경제", "commercial-economics"],
    ["수산·해운 산업 기초", "fisheries-and-shipping"],
    ["인간 발달", "human-development"],
    ["성공적인 직업 생활", "successful-career-life"],
  ])("직업탐구 %s → %s", (label, code) => {
    const r = classifyArtifact({
      subjectLabel: "직업탐구",
      linkLabel: `${label} 문제`,
      url: "https://wdown.ebsi.co.kr/x.pdf",
    });
    expect(r.ok && r.artifact.subject).toBe("vocational");
    expect(r.ok && r.artifact.course).toMatchObject({ status: "resolved", code });
  });

  it("상업 경제 는 사회탐구 경제로 오인하지 않는다", () => {
    expect(resolveCourse("상업경제", { subject: "vocational" })).toMatchObject({
      code: "commercial-economics",
    });
  });

  it.each([
    ["독일어Ⅰ", "german-1"],
    ["프랑스어Ⅰ", "french-1"],
    ["스페인어Ⅰ", "spanish-1"],
    ["중국어Ⅰ", "chinese-1"],
    ["일본어Ⅰ", "japanese-1"],
    ["러시아어Ⅰ", "russian-1"],
    ["아랍어Ⅰ", "arabic-1"],
    ["베트남어Ⅰ", "vietnamese-1"],
    ["한문Ⅰ", "classical-chinese-1"],
  ])("제2외국어 %s → %s (원문 표기 보존)", (label, code) => {
    const r = classifyArtifact({
      subjectLabel: "제2외국어/한문",
      linkLabel: `${label} 문제`,
      url: "https://wdown.ebsi.co.kr/x.pdf",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.artifact.subject).toBe("second_language");
    expect(r.artifact.course).toMatchObject({ status: "resolved", code });
    expect(r.artifact.sourceSubjectLabel).toBe("제2외국어/한문");
    expect(r.artifact.sourceLabel).toBe(`제2외국어/한문 ${label} 문제`);
  });

  it('로마 숫자 없는 언어명("일본어")은 체제마다 다를 수 있어 확정하지 않는다', () => {
    expect(resolveCourse("일본어", { subject: "second_language" })).toMatchObject({
      status: "ambiguous",
      candidates: ["japanese-1"],
    });
  });

  it("공식 기출에서 확인된 고2·고3 제2외국어 세부과목을 확정한다", () => {
    const r = classifyArtifact({
      subjectLabel: "제2외국어",
      linkLabel: "일본어Ⅰ 문제",
      url: "https://wdown.ebsi.co.kr/x.pdf",
    });
    if (!r.ok) throw new Error("classify failed");
    expect(finalCourseResolution(r.artifact, "ebsi", [], exam(2025, 2)).status).toBe("resolved");
    expect(finalCourseResolution(r.artifact, "ebsi", [], exam(2025, 3)).status).toBe("resolved");
  });
});

describe("과거 표기 alias (체제 한정)", () => {
  const artifact = () => {
    const r = classifyArtifact({
      subjectLabel: "과학탐구",
      linkLabel: "물리Ⅰ 문제",
      url: "https://wdown.ebsi.co.kr/x.pdf",
    });
    if (!r.ok) throw new Error("classify failed");
    return r.artifact;
  };
  const legacyAlias: CourseAlias = {
    alias: "물리1",
    code: "physics-1",
    sourceId: "ebsi",
    regime: "legacy",
  };

  it("legacy 체제 한정 alias 는 과거 시험에만 적용되고, 2028 체제에는 퍼지지 않는다", () => {
    expect(finalCourseResolution(artifact(), "ebsi", [legacyAlias], exam(2012, 3))).toMatchObject({
      status: "resolved",
      via: "alias",
    });
    // 2028 체제: alias 미적용 → 카탈로그 판정(물리1)은 체제 검증에서 보류
    expect(finalCourseResolution(artifact(), "ebsi", [legacyAlias], exam(2027, 3)).status).toBe(
      "ambiguous",
    );
  });

  it("관리자 alias 가 카탈로그 판정보다 우선한다", () => {
    const override: CourseAlias = { alias: "물리1", code: "physics-2", sourceId: "ebsi" };
    expect(finalCourseResolution(artifact(), "ebsi", [override], exam(2025, 3))).toMatchObject({
      status: "resolved",
      code: "physics-2",
    });
  });
});
