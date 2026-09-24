import { describe, expect, it } from "vitest";
import { parseExamQuery } from "@/lib/exam-query-parser";

const NOW = new Date("2026-09-24T00:00:00Z");
const parse = (q: string) => parseExamQuery(q, NOW);

describe("parseExamQuery", () => {
  it.each([
    ["2025 고2 9월", 2025, 2, 9],
    ["2025년 고2 9월 모의고사", 2025, 2, 9],
    ["25 고2 9모", 2025, 2, 9],
    ["24년 고3 6모", 2024, 3, 6],
    ["2023 고1 3월", 2023, 1, 3],
    ["고3 2025 9월", 2025, 3, 9],
    ["2학년 2024 11월", 2024, 2, 11],
    ["2025 고 2 09월", 2025, 2, 9],
    ["2025-high2-09", 2025, 2, 9],
    ["2025 고2 9", 2025, 2, 9],
    ["2024 고3 10월 학력평가 시험지", 2024, 3, 10],
    ["２０２５ 고２ ９월", 2025, 2, 9],
  ])("%s → %i 고%i %i월", (query, year, grade, month) => {
    expect(parse(query)).toEqual({
      ok: true,
      year,
      grade,
      month,
      subject: null,
      courseCode: null,
    });
  });

  it("평가원 패턴(6평/9평)은 학년이 없으면 고3으로 본다", () => {
    const none = { subject: null, courseCode: null };
    expect(parse("2025 9평")).toEqual({ ok: true, year: 2025, grade: 3, month: 9, ...none });
    expect(parse("24 6평")).toEqual({ ok: true, year: 2024, grade: 3, month: 6, ...none });
  });

  it("부족한 항목을 missing 으로 알려준다", () => {
    const result = parse("고2 9월");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(["year"]);
      expect(result.partial).toEqual({ year: null, grade: 2, month: 9 });
    }
  });

  it("해석할 수 없는 입력", () => {
    const result = parse("모의고사");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["year", "grade", "month"]);
  });

  it("범위 밖 년도는 무시한다", () => {
    const result = parse("1999 고2 9월");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.partial.year).toBeNull();
  });

  it("학년도 표기의 숫자를 학년으로 오인하지 않는다", () => {
    expect(parse("2025학년도 고3 6월")).toEqual({
      ok: true,
      year: 2025,
      grade: 3,
      month: 6,
      subject: null,
      courseCode: null,
    });
  });

  it.each([
    ["2025 고3 9평 사회문화", "social", "social-culture"],
    ["2025 고3 9월 생활과 윤리", "social", "life-and-ethics"],
    ["25 고2 9모 영어", "english", null],
    ["2025 고3 7월 일본어Ⅰ", "second_language", "japanese-1"],
    ["2025 고2 9월", null, null],
    // 모호한 표기는 세부과목으로 보내지 않는다
    ["2025 고3 9월 윤리", null, null],
  ])("과목/세부과목 인식: %s", (q, subject, course) => {
    const r = parseExamQuery(q, NOW);
    expect(r.ok).toBe(true);
    expect(r.subject).toBe(subject);
    expect(r.courseCode).toBe(course);
  });

  it("요구된 대표 입력", () => {
    for (const [q, y, g, m] of [
      ["25 고2 9모", 2025, 2, 9],
      ["2025 고2 9월", 2025, 2, 9],
      ["2025년 고2 9월 모의고사", 2025, 2, 9],
      ["26 고1 3모", 2026, 1, 3],
    ] as const)
      expect(parseExamQuery(q, NOW)).toMatchObject({ ok: true, year: y, grade: g, month: m });
    // 년도 없는 평가원 표기: 학년·월만 → 검색 페이지가 가장 최근 시험으로 보낸다
    expect(parseExamQuery("고3 6평", NOW)).toMatchObject({
      ok: false,
      partial: { year: null, grade: 3, month: 6 },
    });
    expect(parseExamQuery("고3 9평", NOW)).toMatchObject({ partial: { grade: 3, month: 9 } });
  });
});
