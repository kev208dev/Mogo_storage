import { describe, expect, it } from "vitest";
import { sampleDataset } from "@/lib/data/sample-data";
import { buildQuiz, isQuizAnswerCorrect } from "@/lib/vocabulary-quiz";

function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const items = sampleDataset.vocabulary;

describe("buildQuiz", () => {
  it("limits question count and builds 4 unique choices", () => {
    const quiz = buildQuiz(items, { direction: "en-ko", format: "choice", count: 10 }, seeded(1));
    expect(quiz).toHaveLength(10);
    for (const q of quiz) {
      expect(q.choices).toHaveLength(4);
      expect(new Set(q.choices).size).toBe(4);
      expect(q.choices).toContain(q.answer);
    }
  });

  it("all = every word", () => {
    const quiz = buildQuiz(
      items,
      { direction: "ko-en", format: "written", count: "all" },
      seeded(2),
    );
    expect(quiz).toHaveLength(items.length);
    expect(quiz[0]!.choices).toBeNull();
  });
});

describe("isQuizAnswerCorrect", () => {
  const item = items.find((v) => v.word === "recognize")!;
  it("accepts one of comma separated meanings", () => {
    const [q] = buildQuiz([item], { direction: "en-ko", format: "written", count: 1 });
    expect(isQuizAnswerCorrect(q!, "알아보다")).toBe(true);
    expect(isQuizAnswerCorrect(q!, "인식하다")).toBe(true);
    expect(isQuizAnswerCorrect(q!, "먹다")).toBe(false);
  });
  it("english answers ignore case", () => {
    const [q] = buildQuiz([item], { direction: "ko-en", format: "written", count: 1 });
    expect(isQuizAnswerCorrect(q!, " Recognize ")).toBe(true);
  });
});
