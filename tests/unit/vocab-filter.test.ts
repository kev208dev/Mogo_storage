import { describe, expect, it } from "vitest";
import type { VocabularyItem } from "@/lib/data/types";
import { dedupeVocabulary, filterVocabulary } from "@/lib/vocab-filter";

const item = (id: string, n: number, word: string, meaning: string, pos: string | null = null) =>
  ({
    id,
    examId: "e",
    questionId: null,
    questionNumber: n,
    word,
    meaning,
    partOfSpeech: pos,
    difficulty: 1,
    createdAt: "",
  }) satisfies VocabularyItem;

const items = [
  item("a", 18, "Resilient", "회복력 있는", "adj."),
  item("b", 18, "resilient", "회복력 있는"),
  item("c", 20, "allocate", "할당하다", "v."),
];

describe("vocab filter", () => {
  it("같은 문항의 같은 단어는 한 번만", () => {
    expect(dedupeVocabulary(items).map((v) => v.id)).toEqual(["a", "c"]);
  });

  it("단어·뜻 검색 (대소문자·전각 무시)", () => {
    const base = { questionNumber: "all" as const, unknownOnly: false };
    expect(filterVocabulary(items, { ...base, query: "ＲＥＳＩ" }, new Set()).length).toBe(2);
    expect(filterVocabulary(items, { ...base, query: "할당" }, new Set()).map((v) => v.id)).toEqual(
      ["c"],
    );
  });

  it("문항·모르는 단어 필터", () => {
    expect(
      filterVocabulary(items, { query: "", questionNumber: 20, unknownOnly: false }, new Set()),
    ).toHaveLength(1);
    expect(
      filterVocabulary(
        items,
        { query: "", questionNumber: "all", unknownOnly: true },
        new Set(["b"]),
      ).map((v) => v.id),
    ).toEqual(["b"]);
  });
});
