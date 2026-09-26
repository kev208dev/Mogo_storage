import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { megaStudyAdapter, parseMegaInquiryFragment } from "../../src/ingestion/grade-cuts/adapters/megastudy";
import type { WatchExam, WatchSlot } from "../../src/ingestion/grade-cuts/core";

const july: WatchExam = { id: "july", year: 2026, grade: 3, month: 7, examDate: "2026-07-08", academicYear: 2027, examType: "school_mock" };
const june: WatchExam = { ...july, id: "june", month: 6, examDate: "2026-06-04", examType: "kice_mock" };
const physics: WatchSlot = { examId: "july", subject: "science", courseId: "p", courseCode: "physics-1", status: "watching", lastPolledAt: null };
const earth: WatchSlot = { ...physics, courseId: "e", courseCode: "earth-science-2" };
const actual = (seq: number) => readFileSync(new URL(`../fixtures/grade-cuts/megastudy/mega-${seq}-science.html`, import.meta.url), "utf8");
const parse = (seq: number, exam: WatchExam, slots: WatchSlot[] = [physics, earth]) =>
  parseMegaInquiryFragment(actual(seq), exam, slots, new Date("2026-09-26T00:00:00Z"), "science");

describe("MegaStudy science raw-score response", () => {
  it("maps two distinct public exam identities and I/II courses to raw scores", () => {
    expect(parse(357, july)).toMatchObject([
      { subject: "science", courseCode: "physics-1", cuts: [{ grade: 1, rawScore: 46 }, { grade: 2, rawScore: 44 }, { grade: 3, rawScore: 38 }] },
      { subject: "science", courseCode: "earth-science-2", cuts: [{ grade: 1, rawScore: 34 }, { grade: 2, rawScore: 20 }, { grade: 3, rawScore: 16 }] },
    ]);
    expect(parse(356, june)).toMatchObject([
      { courseCode: "physics-1", cuts: [{ grade: 1, rawScore: 46 }, { grade: 2, rawScore: 41 }, { grade: 3, rawScore: 35 }] },
      { courseCode: "earth-science-2", cuts: [{ grade: 1, rawScore: 50 }, { grade: 2, rawScore: 43 }, { grade: 3, rawScore: 27 }] },
    ]);
  });
  it("rejects wrong exam/date/type and never returns an unrequested course", () => {
    expect(() => parse(357, june)).toThrow(/identity/);
    expect(() => parse(357, { ...july, grade: 2 })).toThrow(/identity/);
    expect(() => parse(357, { ...july, examDate: "2026-07-09" })).toThrow(/identity/);
    expect(parse(357, july, [physics]).map((row) => row.courseCode)).toEqual(["physics-1"]);
    expect(megaStudyAdapter.supports?.(july, { ...physics, subject: "english" })).toBe(false);
    expect(megaStudyAdapter.supports?.(july, { ...physics, subject: "history" })).toBe(false);
    expect(megaStudyAdapter.supports?.(july, { ...physics, subject: "second_language" })).toBe(false);
  });
  it("rejects malformed, duplicate, inverted, non-raw columns; skips unknown names", () => {
    const source = actual(357);
    const observe = (html: string) => parseMegaInquiryFragment(html, july, [physics], new Date(), "science");
    expect(() => observe(source.replace("원점수", "표준점수"))).toThrow(/header/);
    expect(() => observe(source.replace("1등급", "X등급"))).toThrow(/row/);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(observe(source.replace("물리학 I", "물리학 III"))).toEqual([]);
    warn.mockRestore();
    expect(() => observe(source.replace("2등급", "1등급"))).toThrow(/invalid/);
    expect(() => observe(source.replace(/44/, "99"))).toThrow();
  });
});
