import { describe, expect, it } from "vitest";
import { conceptCandidate, conceptSlug, normalizeConceptName } from "@/lib/concepts";

const entry = (heading: string | null, form: "leading" | "trailing" | null = "leading") => ({
  number: 3,
  heading,
  headingForm: form,
  reordered: false,
  page: 4,
});

describe("concept normalization", () => {
  it("출제 의도 표지를 떼고 표기를 통일한다", () => {
    expect(normalizeConceptName("[출제 의도] 목적 파악")?.name).toBe("목적 파악");
    expect(normalizeConceptName("[출제의도] 지수 계산하기")?.name).toBe("지수 계산하기");
    expect(normalizeConceptName("매체 언어와 개인적・사회적 소통")?.name).toBe(
      "매체 언어와 개인적·사회적 소통",
    );
    expect(normalizeConceptName("발표에서 자료,매체  활용하기")?.name).toBe(
      "발표에서 자료, 매체 활용하기",
    );
  });

  it("같은 개념은 같은 slug", () => {
    expect(conceptSlug("분자의 구조와 성질")).toBe(conceptSlug(" 분자의  구조와 성질 "));
    expect(conceptSlug("pH와 물의 자동 이온화")).toBe("ph와-물의-자동-이온화");
  });

  it("개념이 아닌 제목은 버린다", () => {
    expect(normalizeConceptName("")).toBeNull();
    expect(normalizeConceptName("①")).toBeNull();
    expect(normalizeConceptName("정답 ④")).toBeNull();
    expect(normalizeConceptName("다음 중 옳은 것은?")).toBeNull();
    expect(normalizeConceptName("12")).toBeNull();
  });

  it("정상 머리말 + 검증된 정답표만 자동 승인", () => {
    const ok = conceptCandidate(entry("탄소 화합물"), true)!;
    expect(ok.status).toBe("approved");
    expect(ok.evidence).toBe("3. 탄소 화합물 (해설지 4쪽)");
    expect(conceptCandidate(entry("탄소 화합물"), false)!.status).toBe("manual_review");
    expect(conceptCandidate(entry("외부 효과의 이해", "trailing"), true)!.status).toBe(
      "manual_review",
    );
    expect(conceptCandidate({ ...entry("동적 평형"), reordered: true }, true)!.status).toBe(
      "manual_review",
    );
  });

  it("문장형 출제의도는 잘렸을 수 있어 검토 대기", () => {
    const c = conceptCandidate(entry("출제의도 : 지수법칙을 이용하여 식의"), true)!;
    expect(c.status).toBe("manual_review");
    expect(c.sentence).toBe(true);
  });
});

describe("emptyIfMissingTable", () => {
  it("undefined_table 만 빈 결과, 다른 오류는 그대로", async () => {
    const { emptyIfMissingTable } = await import("@/lib/data/drizzle-repository");
    expect(emptyIfMissingTable({ cause: { code: "42P01" } })).toEqual([]);
    expect(emptyIfMissingTable({ code: "42P01" })).toEqual([]);
    const other = { cause: { code: "57014" } };
    expect(() => emptyIfMissingTable(other)).toThrow();
  });
});
