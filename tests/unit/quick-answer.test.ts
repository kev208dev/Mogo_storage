import { describe, expect, it } from "vitest";
import {
  answersToLine,
  applyQuickInput,
  moveCursor,
  quickBackspace,
  setAnswerAt,
  type QuickQuestion,
} from "../../src/lib/quick-answer";

const choice = (n: number): QuickQuestion => ({ questionNumber: n, choiceCount: 5 });
const five = [1, 2, 3, 4, 5].map(choice);
// 수학 형태: 1~3 선택형, 4~5 단답형
const math: QuickQuestion[] = [
  choice(1),
  choice(2),
  choice(3),
  { questionNumber: 4, choiceCount: null },
  { questionNumber: 5, choiceCount: null },
];
const start = { answers: {}, cursor: 0 };

describe("빠른 답 입력", () => {
  it("숫자열을 1번부터 차례로 매핑하고 커서가 넘어간다", () => {
    const s = applyQuickInput(start, "34244", five);
    expect(s.answers).toEqual({ 1: "3", 2: "4", 3: "2", 4: "4", 5: "4" });
    expect(s.cursor).toBe(5);
    // 끝 이후 입력은 무시
    expect(applyQuickInput(s, "1", five)).toEqual(s);
  });

  it("붙여넣기: 공백·쉼표 무시, 범위 밖 숫자 무시, 전각 숫자 허용", () => {
    const s = applyQuickInput(start, "3, 4 9 ２ 0 1", five);
    expect(s.answers).toEqual({ 1: "3", 2: "4", 3: "2", 4: "1" });
    expect(s.cursor).toBe(4);
  });

  it("'-' '.' 로 건너뛰기 (미입력으로 남김)", () => {
    const s = applyQuickInput(start, "3-2.1", five);
    expect(s.answers).toEqual({ 1: "3", 3: "2", 5: "1" });
    expect(s.cursor).toBe(5);
  });

  it("단답형은 여러 자리 → 구분자로 다음 문항, 최대 3자리", () => {
    const s = applyQuickInput(start, "123 45 1337", math);
    expect(s.answers).toEqual({ 1: "1", 2: "2", 3: "3", 4: "45", 5: "133" });
    expect(s.cursor).toBe(4);
    const done = applyQuickInput(s, ",", math);
    expect(done.cursor).toBe(5);
  });

  it("Backspace: 단답형은 한 글자, 선택형은 이전 문항 답을 지우고 이동", () => {
    let s = applyQuickInput(start, "312", five);
    s = quickBackspace(s, five);
    expect(s).toEqual({ answers: { 1: "3", 2: "1" }, cursor: 2 });
    s = quickBackspace(s, five);
    expect(s).toEqual({ answers: { 1: "3" }, cursor: 1 });
    const m = applyQuickInput(start, "11145", math);
    expect(quickBackspace(m, math).answers[4]).toBe("4");
    expect(quickBackspace(start, five)).toEqual(start);
  });

  it("방향키 이동은 범위 안에서만, 문항 버튼은 같은 값 다시 누르면 지움", () => {
    expect(moveCursor(start, -1, five).cursor).toBe(0);
    expect(moveCursor({ answers: {}, cursor: 4 }, 3, five).cursor).toBe(5);
    let s = setAnswerAt(start, 2, "4", five);
    expect(s).toEqual({ answers: { 3: "4" }, cursor: 3 });
    s = setAnswerAt(s, 2, "4", five);
    expect(s).toEqual({ answers: {}, cursor: 2 });
  });

  it("입력 요약 문자열", () => {
    expect(answersToLine({ 1: "3", 4: "45" }, math)).toBe("3··[45]·");
  });
});
