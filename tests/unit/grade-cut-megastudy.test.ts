import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { findMegaExamSeq, megaStudyAdapter, parseMegaSocialFragment } from "../../src/ingestion/grade-cuts/adapters/megastudy";
import { runGradeCutWatch, type WatchExam, type WatchSlot, type WatchStore } from "../../src/ingestion/grade-cuts/core";

const july: WatchExam = { id: "july", year: 2026, grade: 3, month: 7, examDate: "2026-07-08", academicYear: 2027, examType: "school_mock" };
const june: WatchExam = { ...july, id: "june", month: 6, examDate: "2026-06-04", examType: "kice_mock" };
const social: WatchSlot = { examId: "july", subject: "social", courseId: "course", courseCode: "social-culture", status: "watching", lastPolledAt: null };
const fixture = (seq: number) => readFileSync(new URL(`../fixtures/grade-cuts/mega-${seq}-social.html`, import.meta.url), "utf8");
const parseFixture = (seq: number, exam: WatchExam) => parseMegaSocialFragment(fixture(seq), exam, [social], new Date("2026-09-26T00:00:00Z"));

describe("MegaStudy public relative raw-score table", () => {
  it("maps two real exams and their social course without copying standard scores", () => {
    expect(parseFixture(357, july)[0]).toMatchObject({ subject: "social", courseCode: "social-culture", cuts: [{ grade: 1, rawScore: 45 }, { grade: 2, rawScore: 42 }, { grade: 3, rawScore: 37 }] });
    expect(parseFixture(356, june)[0]).toMatchObject({ courseCode: "social-culture", cuts: [{ grade: 1, rawScore: 48 }, { grade: 2, rawScore: 45 }, { grade: 3, rawScore: 39 }] });
    expect(() => parseFixture(357, june)).toThrow(/identity/);
  });
  it("rejects malformed rows, the wrong column, and unmatched courses", () => {
    const input = fixture(357);
    expect(() => parseMegaSocialFragment(input.replace("원점수", "표준점수"), july, [social], new Date())).toThrow(/header/);
    expect(() => parseMegaSocialFragment(input.replace("1등급", "X등급"), july, [social], new Date())).toThrow(/row/);
    expect(() => parseMegaSocialFragment(input.replace("사회문화", "알수없는과목"), july, [social], new Date())).not.toThrow();
    expect(parseMegaSocialFragment(input.replace("사회문화", "알수없는과목"), july, [social], new Date())).toEqual([]);
    expect(parseMegaSocialFragment(input, july, [{ ...social, courseCode: "life-and-ethics" }], new Date())).toEqual([]);
  });
  it("matches only a unique actual public selector and its exact exam identity", () => {
    const page = `<ul id="examGrdArea"><li class="on">고3</li></ul><ul id="examNmArea"><li onclick="fncSelExamSeq(357,'1',0);">2026.07.08 학력평가</li><li onclick="fncSelExamSeq(356,'1',1);">2026.06.04 모의평가</li></ul>`;
    expect(findMegaExamSeq(page, july)).toBe("357");
    expect(findMegaExamSeq(page, june)).toBe("356");
    expect(findMegaExamSeq(page, { ...july, examDate: "2026-07-09" })).toBeNull();
    expect(findMegaExamSeq(page, { ...july, grade: 2 })).toBeNull();
    expect(findMegaExamSeq(page.replace("357", "not-an-id"), july)).toBeNull();
  });
  it("never requests absolute, unsupported, or finalized slots; still polls another due slot", async () => {
    const active = { ...social };
    const finalized = { ...social, courseCode: "life-and-ethics", status: "finalized" as const };
    const absolute = { ...social, subject: "english" as const, courseCode: null };
    const collect = vi.fn(async (_exam: WatchExam, _slots: readonly WatchSlot[]) => []);
    const store: WatchStore = { dueExams: async () => [july], slots: async () => [active, finalized, absolute], save: vi.fn(async () => false), markPolled: vi.fn(async () => {}), fail: vi.fn(async () => {}) };
    await runGradeCutWatch(store, [{ ...megaStudyAdapter, collect }], new Date("2026-07-08T09:00:00Z"));
    expect(collect).toHaveBeenCalledOnce();
    expect(collect.mock.calls[0]?.[1]).toEqual([active]);
    expect(store.markPolled).toHaveBeenCalledOnce();
    expect(store.markPolled).toHaveBeenCalledWith(active, expect.any(Date));
  });
});
