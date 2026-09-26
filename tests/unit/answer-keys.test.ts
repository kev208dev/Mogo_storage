import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assembleAnswerKeys,
  ebsiPairConflict,
  slotStatus,
} from "../../src/ingestion/answer-keys/assemble";
import { headerConflicts } from "../../src/ingestion/answer-keys/identity";
import { parseAnswerKeyText, parsePointsText } from "../../src/ingestion/answer-keys/parse";
import { checkAnswerKey, checkPoints } from "../../src/ingestion/answer-keys/validate";

const fx = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/answer-keys/${name}.json`, import.meta.url), "utf8"),
  ) as { source: string; pages: string[] };
const june = { year: 2025, month: 6, examType: "kice_mock" as const };
const doc = (name: string, courseCode: string | null) => {
  const f = fx(name);
  return { fileId: name, courseCode, url: f.source, sha256: null, pages: f.pages };
};

describe("공식 정답표 파서 (실제 EBSi 2025-06 고3 텍스트)", () => {
  it("화학Ⅰ: 20문항 · 본문 정답 표기와 전부 일치 · 해설 쪽 연결", () => {
    const parsed = parseAnswerKeyText(fx("2025-06-g3-chemistry1-solution").pages);
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections).toHaveLength(1);
    const e = parsed.sections[0]!.entries;
    expect(e.map((x) => x.answer).join("")).toBe("14524315434212235312");
    expect(e.every((x) => x.choice && x.marker === x.answer && x.page !== null)).toBe(true);
    expect(e.at(-1)!.page).toBe(8);
    const check = checkAnswerKey(parsed, "science");
    expect(check).toMatchObject({ ok: true, crossChecked: 20 });
  });

  it("국어: 공통 1~34 + 선택 두 과목 35~45 를 과목 code 로 확정", () => {
    const check = checkAnswerKey(
      parseAnswerKeyText(fx("2025-06-g3-korean-solution").pages),
      "korean",
    );
    expect(check.ok).toBe(true);
    expect(check.sections.map((s) => [s.courseCode, s.entries.length])).toEqual([
      [null, 34],
      ["speech-and-writing", 11],
      ["language-and-media", 11],
    ]);
    expect(check.sections[1]!.entries[0]).toMatchObject({ number: 35, answer: "4", page: 21 });
  });

  it("수학: 단답형은 숫자로, 선택형과 구분한다", () => {
    const check = checkAnswerKey(parseAnswerKeyText(fx("2025-06-g3-math-solution").pages), "math");
    expect(check.ok).toBe(true);
    const common = check.sections[0]!.entries;
    expect(common.find((x) => x.number === 18)).toMatchObject({ answer: "133", choice: false });
    expect(common.find((x) => x.number === 15)).toMatchObject({ answer: "1", choice: true });
    expect(check.sections.map((s) => s.courseCode)).toEqual([
      null,
      "probability-and-statistics",
      "calculus",
      "geometry",
    ]);
  });

  it("영어: 본문 정답 표기가 없어도 45문항 연속·범위 검증으로 통과", () => {
    const check = checkAnswerKey(
      parseAnswerKeyText(fx("2025-06-g3-english-solution").pages),
      "english",
    );
    expect(check).toMatchObject({ ok: true, crossChecked: 0 });
    expect(check.sections[0]!.entries.every((x) => x.page !== null)).toBe(true);
  });

  it("검증 실패: 누락 · 범위 밖 · 본문 표기 불일치 · 중복 모순", () => {
    const base = fx("2025-06-g3-chemistry1-solution").pages;
    const drop = base.map((p) => p.replace("20. ②", ""));
    expect(checkAnswerKey(parseAnswerKeyText(drop), "science").reasons.map((r) => r.code)).toEqual([
      "count_mismatch",
    ]);
    const gap = base.map((p) => p.replace("07. ①", ""));
    expect(checkAnswerKey(parseAnswerKeyText(gap), "science").reasons.map((r) => r.code)).toEqual([
      "count_mismatch",
      "not_continuous",
    ]);
    const numeric = base.map((p) => p.replace("03. ⑤", "03. 7"));
    expect(
      checkAnswerKey(parseAnswerKeyText(numeric), "science").reasons.map((r) => r.code),
    ).toContain("bad_domain");
    const wrongMarker = base.map((p) => p.replace("01. ①", "01. ②"));
    expect(
      checkAnswerKey(parseAnswerKeyText(wrongMarker), "science").reasons.map((r) => r.code),
    ).toEqual(["marker_mismatch"]);
    const dup = base.map((p) => p.replace("11. ④", "10. ④"));
    const parsed = parseAnswerKeyText(dup);
    expect(parsed.problems.join()).toMatch(/두 번 다르게/);
    expect(parseAnswerKeyText(["표 없음"]).problems).toEqual(["빠른 정답표를 찾지 못함"]);
  });
});

describe("문제지 배점", () => {
  it.each([
    ["2025-06-g3-chemistry1-question", "science", 20, 50],
    ["2025-06-g3-history-question", "history", 20, 50],
    ["2025-06-g3-english-question", "english", 45, 100],
    ["2025-06-g3-korean-speech-question", "korean", 45, 100],
    ["2025-06-g3-math-calculus-question", "math", 30, 100],
  ] as const)("$0: 문항 수·합계", (name, subject, count, sum) => {
    const { points, found } = parsePointsText(fx(name).pages);
    expect(found).toBe(count);
    expect([...points.values()].reduce((a, b) => a + b, 0)).toBe(sum);
    expect(checkPoints(points, found, subject).ok).toBe(true);
  });

  it("합계나 문항 수가 맞지 않으면 배점을 쓰지 않는다", () => {
    const pages = fx("2025-06-g3-chemistry1-question").pages.map((p) => p.replace("[3점]", ""));
    const { points, found } = parsePointsText(pages);
    expect(checkPoints(points, found, "science").reasons.map((r) => r.code)).toEqual([
      "sum_mismatch",
    ]);
    const short = parsePointsText(fx("2025-06-g3-chemistry1-question").pages.slice(0, 1));
    expect(checkPoints(short.points, short.found, "science").ok).toBe(false);
  });
});

describe("슬롯 조립", () => {
  it("화학Ⅰ: 정답 + 배점 → verified", () => {
    const [slot] = assembleAnswerKeys(
      june,
      "science",
      [doc("2025-06-g3-chemistry1-solution", "chemistry-1")],
      [doc("2025-06-g3-chemistry1-question", "chemistry-1")],
    );
    expect(slotStatus(slot!)).toBe("verified");
    expect(slot!.points!.get(4)).toBe(3);
  });

  it("국어: 공통 배점은 선택 문제지에서, 문제지가 없는 선택 과목은 manual_review", () => {
    const slots = assembleAnswerKeys(
      june,
      "korean",
      [doc("2025-06-g3-korean-solution", null)],
      [doc("2025-06-g3-korean-speech-question", "speech-and-writing")],
    );
    expect(slots.map((s) => [s.courseCode, slotStatus(s), s.reasons.map((r) => r.code)])).toEqual([
      [null, "verified", []],
      ["speech-and-writing", "verified", []],
      ["language-and-media", "manual_review", ["points_missing"]],
    ]);
    const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    expect(sum(slots[0]!.points!) + sum(slots[1]!.points!)).toBe(100);
  });

  it("다른 과목 문제지(파일 코드 불일치)는 배점에 쓰지 않는다", () => {
    const [slot] = assembleAnswerKeys(
      june,
      "science",
      [doc("2025-06-g3-chemistry1-solution", "chemistry-1")],
      [doc("2025-06-g3-history-question", "chemistry-1")],
    );
    expect(slotStatus(slot!)).toBe("manual_review");
    expect(slot!.reasons[0]).toMatchObject({ code: "points_identity" });
    expect(
      ebsiPairConflict(
        "https://wdown.ebsi.co.kr/W61001/01exam/20250604/go3/kor_main_hsj_A.pdf",
        "https://wdown.ebsi.co.kr/W61001/01exam/20250604/go3/korA_1_mun_B.pdf",
      ),
    ).toBeNull();
  });

  it("머리말의 학년도·월·과목이 기대와 다르면 거부 (언급 없음은 허용)", () => {
    const pages = fx("2025-06-g3-chemistry1-solution").pages;
    expect(
      headerConflicts(pages, { exam: june, subject: "science", courseCode: "chemistry-1" }),
    ).toEqual([]);
    expect(
      headerConflicts(pages, {
        exam: { ...june, month: 9 },
        subject: "science",
        courseCode: "chemistry-1",
      }),
    ).toEqual(["머리말 6월 ≠ 기대 9월"]);
    expect(
      headerConflicts(pages, { exam: june, subject: "science", courseCode: "physics-1" })[0],
    ).toMatch(/chemistry-1/);
    expect(headerConflicts(pages, { exam: june, subject: "social", courseCode: null })[0]).toMatch(
      /영역/,
    );
    expect(
      headerConflicts(["저작권 문구만"], { exam: june, subject: "history", courseCode: null }),
    ).toEqual([]);
  });

  it("같은 슬롯이 두 해설 파일에서 다르면 검증 실패", () => {
    const a = doc("2025-06-g3-chemistry1-solution", "chemistry-1");
    const b = { ...a, fileId: "b", pages: a.pages.map((p) => p.replace("05. ④", "05. ③")) };
    const [slot] = assembleAnswerKeys(june, "science", [a, b], []);
    expect(slot!.answersVerified).toBe(false);
    expect(slot!.reasons.map((r) => r.code)).toContain("marker_mismatch");
  });
});

describe("세부과목 페이지 문항 = 과목 문항 + 겹치지 않는 공통 문항", () => {
  const q = (n: number, courseId: string | null) => ({ questionNumber: n, courseId });
  it("국어 화법과 작문: 공통 1~34 + 선택 35~45", async () => {
    const { questionsForSlot } = await import("../../src/lib/data/question-slot");
    const rows = [
      ...Array.from({ length: 34 }, (_, i) => q(i + 1, null)),
      ...Array.from({ length: 11 }, (_, i) => q(35 + i, "speech-and-writing")),
      ...Array.from({ length: 11 }, (_, i) => q(35 + i, "language-and-media")),
    ];
    const slot = questionsForSlot(rows, "speech-and-writing");
    expect(slot.map((r) => r.questionNumber)).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
    expect(slot.every((r) => r.courseId !== "language-and-media")).toBe(true);
    expect(questionsForSlot(rows, null)).toHaveLength(34);
    // 선택 과목 정답이 아직 없으면 공통만 보여주지 않는다 (만점이 달라짐)
    expect(
      questionsForSlot(
        rows.filter((r) => r.courseId !== "calculus"),
        "calculus",
      ),
    ).toEqual([]);
    // 번호가 겹치면 과목 문항만
    const inquiry = [q(1, null), q(2, null), q(1, "social-culture"), q(2, "social-culture")];
    expect(questionsForSlot(inquiry, "social-culture").map((r) => r.courseId)).toEqual([
      "social-culture",
      "social-culture",
    ]);
  });
});

describe("텍스트 층 변형", () => {
  it("교육청 학력평가: '정답' 다음의 점 없는 표 (수학 단답형 포함)", () => {
    const check = checkAnswerKey(parseAnswerKeyText(fx("2025-09-g2-math-solution").pages), "math");
    expect(check.ok).toBe(true);
    const e = check.sections[0]!.entries;
    expect(e).toHaveLength(30);
    expect(e.find((x) => x.number === 26)).toMatchObject({ answer: "432", choice: false });
    expect(e.find((x) => x.number === 21)).toMatchObject({ answer: "1", choice: true });
    // "정답" 줄이 없으면 쪽 머리 숫자("5 27")를 표로 읽지 않는다
    const unanchored = fx("2025-09-g2-math-solution").pages.map((p) => p.replace("\n정답\n", "\n"));
    expect(parseAnswerKeyText(unanchored).sections).toEqual([]);
  });

  it("번호와 답이 흩어진 줄은 순서대로 짝짓고, 본문 정답 표기로 모두 확인될 때만 통과", () => {
    const pages = fx("2025-06-g3-economics-solution").pages;
    const parsed = parseAnswerKeyText(pages);
    const e = parsed.sections[0]!.entries;
    expect(e.every((x) => x.reordered)).toBe(true);
    expect(e.slice(0, 3).map((x) => x.answer)).toEqual(["5", "2", "3"]);
    const check = checkAnswerKey(parsed, "social");
    expect(check).toMatchObject({ ok: true, crossChecked: 20 });
    // 본문 표기 하나가 없으면 그 문항은 확인되지 않은 것 → manual_review
    const noMarker = pages.map((p) => p.replace("원천이 된다, . 정답 ⑤", "원천이 된다, ."));
    expect(
      checkAnswerKey(parseAnswerKeyText(noMarker), "social").reasons.map((r) => r.code),
    ).toEqual(["reordered_unverified"]);
  });

  it("제2외국어는 표기 없는 문항이 1점", () => {
    const pages = ["1. 가\n2. 나 [2점]\n3. 다"];
    expect([...parsePointsText(pages, 1).points]).toEqual([
      [1, 1],
      [2, 2],
      [3, 1],
    ]);
  });

  it("통합 문제지(여러 선택 과목 슬롯이 같은 파일)는 공통 배점에만 쓴다", () => {
    const q = doc("2025-06-g3-korean-speech-question", "speech-and-writing");
    const slots = assembleAnswerKeys(
      june,
      "korean",
      [doc("2025-06-g3-korean-solution", null)],
      [q, { ...q, fileId: "q2", courseCode: "language-and-media" }],
    );
    expect(slots.map((s) => [s.courseCode, slotStatus(s)])).toEqual([
      [null, "verified"],
      ["speech-and-writing", "manual_review"],
      ["language-and-media", "manual_review"],
    ]);
  });
});
