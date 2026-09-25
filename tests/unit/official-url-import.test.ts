import { describe, expect, it } from "vitest";
import { parseCsv } from "@/ingestion/manual-import/csv";
import { importRowSchema } from "@/ingestion/manual-import/schema";

const row = (over: Record<string, string> = {}) => ({
  year: "2025",
  grade: "3",
  month: "9",
  exam_type: "kice_mock",
  exam_date: "2025-09-03",
  organizer: "한국교육과정평가원",
  subject: "social",
  course_code: "social-culture",
  file_type: "question",
  official_url: "https://www.suneung.re.kr/__test__/q.pdf",
  original_file_name: "사회문화_문제.pdf",
  source_label: "사회탐구 사회·문화 문제",
  ...over,
});

describe("CSV parser", () => {
  it('따옴표 안 쉼표·줄바꿈, "" escape, CRLF, BOM, 빈 줄', () => {
    const rows = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,"multi\nline",z\n');
    expect(rows).toEqual([
      { line: 1, cells: ["a", "b", "c"] },
      { line: 2, cells: ["1", "x, y", 'say "hi"'] },
      { line: 4, cells: ["2", "multi\nline", "z"] },
    ]);
  });
  it("닫히지 않은 따옴표는 오류", () => {
    expect(() => parseCsv('a,b\n1,"open\n')).toThrow(/따옴표/);
  });
});

describe("CSV 행 검증 (서버는 URL 에 요청하지 않고 형식·공식 도메인만 본다)", () => {
  it("정상 행", () => {
    const r = importRowSchema.safeParse(row());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ grade: 3, month: 9, subject: "social" });
  });
  it("subject 는 enum 과 URL segment 모두 허용 (second-language / second_language)", () => {
    for (const subject of ["second-language", "second_language"]) {
      const r = importRowSchema.safeParse(
        row({
          subject,
          course_code: "japanese-1",
          exam_type: "school_mock",
          month: "7",
          exam_date: "",
        }),
      );
      expect(r.success && r.data.subject).toBe("second_language");
    }
  });
  const errorsOf = (over: Record<string, string>) => {
    const r = importRowSchema.safeParse(row(over));
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };
  it.each([
    [{ official_url: "http://www.suneung.re.kr/q.pdf" }, /https/],
    [{ official_url: "https://blog.example.com/q.pdf" }, /공식 기관 도메인/],
    [{ official_url: "https://drive.google.com/file/d/x" }, /공식 기관 도메인/],
    [{ official_url: "https://evil-ebsi.co.kr.attacker.io/q.pdf" }, /공식 기관 도메인/],
    [{ official_url: "https://user:pw@www.ebsi.co.kr/q.pdf" }, /계정 정보/],
    [{ official_url: "https://wdown.ebsi.co.kr/all.zip" }, /압축/],
    [{ official_url: "not a url" }, /절대 URL/],
    [{ course_code: "physics-1" }, /social 영역이 아닙니다/],
    [{ course_code: "nope" }, /카탈로그에 없는/],
    [{ exam_type: "csat" }, /csat/],
    [{ month: "7" }, /kice_mock/],
    [{ exam_date: "2024-09-03" }, /연도/],
    [{ file_type: "vocabulary_pdf" }, /file_type/],
    [{ file_type: "listening_audio" }, /english/],
    [{ subject: "art" }, /알 수 없는 영역/],
    [{ source_label: "" }, /source_label/],
    [{ grade: "4" }, /grade/],
  ])("거부: %o", (over, message) => {
    expect(errorsOf(over as Record<string, string>).join(" | ")).toMatch(message);
  });
  it("교육청 공식 도메인 허용", () => {
    expect(
      errorsOf({
        exam_type: "school_mock",
        month: "7",
        exam_date: "",
        official_url: "https://www.goe.go.kr/__test__/q.pdf",
      }),
    ).toEqual([]);
  });
});
