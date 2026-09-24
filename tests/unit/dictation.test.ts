import { describe, expect, it } from "vitest";
import { createDictationTokens, isDictationMatch } from "@/lib/dictation";

const sentence = "I was wondering whether you could help me.";

describe("createDictationTokens", () => {
  it("easy: blanks one key word", () => {
    const blanks = createDictationTokens(sentence, "easy").filter((t) => t.answer);
    expect(blanks.map((b) => b.answer)).toEqual(["wondering"]);
  });

  it("medium: blanks several words and keeps punctuation", () => {
    const tokens = createDictationTokens(sentence, "medium");
    const blanks = tokens.filter((t) => t.answer);
    expect(blanks.length).toBeGreaterThan(1);
    const help = tokens.find((t) => t.answer === "help" || t.text === "help");
    expect(help).toBeDefined();
    expect(tokens.map((t) => t.text + t.trailing).join(" ")).toBe(sentence);
  });

  it("hard: every word is blank", () => {
    const tokens = createDictationTokens(sentence, "hard");
    expect(tokens.every((t) => t.answer)).toBe(true);
  });

  it("is deterministic", () => {
    expect(createDictationTokens(sentence, "medium")).toEqual(
      createDictationTokens(sentence, "medium"),
    );
  });
});

describe("isDictationMatch", () => {
  it("ignores case and punctuation", () => {
    expect(isDictationMatch("Whether", "whether")).toBe(true);
    expect(isDictationMatch("I was wondering.", "i was wondering")).toBe(true);
    expect(isDictationMatch("I'm", "I’m")).toBe(true);
    expect(isDictationMatch("help", "held")).toBe(false);
  });
});
