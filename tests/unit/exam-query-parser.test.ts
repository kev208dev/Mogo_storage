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
    expect(parse(query)).toEqual({ ok: true, year, grade, month });
  });

  it("평가원 패턴(6평/9평)은 학년이 없으면 고3으로 본다", () => {
    expect(parse("2025 9평")).toEqual({ ok: true, year: 2025, grade: 3, month: 9 });
    expect(parse("24 6평")).toEqual({ ok: true, year: 2024, grade: 3, month: 6 });
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
    expect(parse("2025학년도 고3 6월")).toEqual({ ok: true, year: 2025, grade: 3, month: 6 });
  });
});
