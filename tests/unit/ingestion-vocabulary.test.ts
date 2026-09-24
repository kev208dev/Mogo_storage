import { describe, expect, it } from "vitest";
import { extractVocabularyCandidates, splitByQuestion } from "@/ingestion/vocabulary/candidates";

const SOLUTION_TEXT = `
영어 영역 정답 및 해설 (TEST FIXTURE)
1. 정답 ③ 듣기 문항
18. 정답 ③
해석: 학교 시설 보수 공사에 대한 안내문이다.
[어휘]
renovation 보수, 개조
facility 시설
take part in ~에 참여하다
19. 정답 ②
[어휘]
interaction 상호작용
anxious 불안한
20. 정답 ①
본문에서 significant 중요한 이라는 표현이 쓰였다.
consistent 일관된
`;

describe("vocabulary candidate extraction", () => {
  it("splits text by reading question numbers only (18–45)", () => {
    expect(splitByQuestion(SOLUTION_TEXT).map((q) => q.questionNumber)).toEqual([18, 19, 20]);
  });

  it("extracts only headword + meaning pairs that literally appear in the text", () => {
    const candidates = extractVocabularyCandidates(SOLUTION_TEXT);
    for (const c of candidates) {
      expect(SOLUTION_TEXT.toLowerCase()).toContain(c.word);
      if (c.meaning) expect(SOLUTION_TEXT).toContain(c.meaning.split(",")[0]!);
    }
    const auto = candidates
      .filter((c) => c.status === "auto_approved")
      .map((c) => `${c.questionNumber}:${c.word}`);
    expect(auto).toEqual([
      "18:facility",
      "18:renovation",
      "18:take part in",
      "19:anxious",
      "19:interaction",
    ]);
    expect(candidates.find((c) => c.word === "renovation")?.meaning).toBe("보수, 개조");
  });

  it("entries outside an 어휘 section are low-confidence needs_review", () => {
    const q20 = extractVocabularyCandidates(SOLUTION_TEXT).filter((c) => c.questionNumber === 20);
    expect(q20.map((c) => c.word)).toEqual(["consistent"]);
    expect(q20[0]!.status).toBe("needs_review");
    expect(q20[0]!.confidence).toBeLessThan(0.8);
  });

  it("returns nothing for text without vocabulary (never invents words)", () => {
    expect(extractVocabularyCandidates("18. 정답 ③ 해석만 있는 해설입니다.")).toEqual([]);
    expect(extractVocabularyCandidates("")).toEqual([]);
  });
});
