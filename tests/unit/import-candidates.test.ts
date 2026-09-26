import { describe, expect, it } from "vitest";
import { parseEvidenceFile } from "@/ingestion/manual-import/attach";
import {
  buildCandidates,
  candidatesToCsv,
  type FoundEntry,
} from "@/ingestion/manual-import/candidates";
import { isAmbiguousVariant, parseEbsiFileUrl } from "@/ingestion/manual-import/ebsi-file";
import { ruleKeyFor, type MappingRule } from "@/ingestion/manual-import/review";
import { importRowSchema } from "@/ingestion/manual-import/schema";
import { parseCsv } from "@/ingestion/manual-import/csv";

const W = "https://wdown.ebsi.co.kr/W61001/01exam";

describe("EBSi 공식 파일 URL 해석", () => {
  it("경로 날짜·학년·코드·자료 종류·파일 ID", () => {
    expect(parseEbsiFileUrl(`${W}/20250604/go3/s_samun_hsj_522O36I8.pdf`)).toMatchObject({
      pathDate: "2025-06-04",
      year: 2025,
      month: 6,
      grade: 3,
      code: "s_samun",
      kind: "solution",
      fileId: "522O36I8",
      part: "",
    });
    expect(parseEbsiFileUrl(`${W}/20250903/go3/kor_main_hsj_2X96S4LB_5.pdf`)).toMatchObject({
      code: "kor",
      kind: "solution",
      fileId: "2X96S4LB",
      part: "5",
    });
    expect(parseEbsiFileUrl(`${W}/20250903/go3/korB_1_mun_1VK7ZJ83.pdf`)).toMatchObject({
      code: "korB",
      kind: "question",
    });
    expect(parseEbsiFileUrl(`${W}/20251113/go3/live_main_paper_1_math_9Q5HR738.pdf`)).toMatchObject(
      {
        code: "math",
        kind: "question",
      },
    );
    expect(parseEbsiFileUrl(`${W}/20251113/go3/live_main_paper_2_kor_942P72J5.pdf`)!.kind).toBe(
      "paper_even",
    );
    expect(parseEbsiFileUrl(`${W}/20251113/go3/live_main_answer_1_kor_8ZE3E1XR.pdf`)!.kind).toBe(
      "answer_key",
    );
    expect(parseEbsiFileUrl(`${W}/20230711/go3/eng_scr_J88734A4.pdf`)!.kind).toBe(
      "listening_script",
    );
    expect(isAmbiguousVariant("korA")).toBe(true);
    expect(isAmbiguousVariant("kor")).toBe(false);
  });

  it("공식 경로 형식이 아니면 해석하지 않는다 (http · 다른 호스트 · 경로 조작)", () => {
    for (const u of [
      `http://wdown.ebsi.co.kr/W61001/01exam/20250604/go3/s_samun_hsj_1.pdf`,
      `https://evil.example/W61001/01exam/20250604/go3/s_samun_hsj_1.pdf`,
      `${W}/20250604/go3/../x/s_samun_hsj_1.pdf`,
      `${W}/20250604/go4/s_samun_hsj_1.pdf`,
      `${W}/20250604/go3/s_samun_hsj_1.pdf?x=1`,
    ])
      expect(parseEbsiFileUrl(u)).toBeNull();
  });
});

describe("검색 결과 → CSV 후보", () => {
  const found: FoundEntry[] = [
    // 제목이 월을 말함 → 2025-06-04 경로 인정, 제목에 과목명
    {
      url: `${W}/20250604/go3/s_samun_hsj_522O36I8.pdf`,
      title: "2026학년도 대학수학능력시험 6월 모의평가 사회탐구영역 사회ㆍ문화 정답 및 해설",
      query: "q1",
    },
    // 같은 코드의 문제지는 제목에 과목명이 없어도 코드 투표로 확정
    {
      url: `${W}/20250604/go3/s_samun_mun_ABCDEF12.pdf`,
      title: "이 문제지에 관한 저작권은 …",
      query: "q2",
    },
    // 국어 A/B 변형 → 보류
    { url: `${W}/20250604/go3/korB_1_mun_34L3Q845_1.pdf`, title: "국어 영역", query: "q3" },
    // 매년 04-30 경로: 어떤 제목도 4월을 말하지 않음 → 보류
    { url: `${W}/20250430/go3/kor_main_hsj_4R8V482P.pdf`, title: "1교시 국어 영역", query: "q4" },
    // 고1 3월 gat — 중학 과정 탐구(통합과학 아님)
    {
      url: `${W}/20240328/go1/gat_main_mun_266Y98DR.pdf`,
      title: "2024학년도 3월 고1 전국연합학력평가",
      query: "q5",
    },
    // 같은 슬롯에 서로 다른 파일 ID → 둘 다 보류
    {
      url: `${W}/20250326/go1/kor_main_hsj_2L3Y8861.pdf`,
      title: "2025학년도 3월 고1 전국연합학력평가 정답 및 해설",
      query: "q6",
    },
    { url: `${W}/20250326/go1/kor_hsj_1V99HKS3.pdf`, title: "국어", query: "q7" },
    // 수능 짝수형 · 정답표 → 보조 자료
    {
      url: `${W}/20251113/go3/live_main_paper_2_kor_942P72J5.pdf`,
      title: "2026학년도 대학수학능력시험 짝수형",
      query: "q8",
    },
    {
      url: `${W}/20251113/go3/live_main_answer_1_kor_8ZE3E1XR.pdf`,
      title: "2026학년도 대학수학능력시험 국어 영역 정답표",
      query: "q9",
    },
    // 같은 파일 ID 의 다른 번호 → 번호 없는/낮은 쪽 채택
    {
      url: `${W}/20250903/go3/kor_main_hsj_2X96S4LB_2.pdf`,
      title: "2026학년도 대학수학능력시험 9월 모의평가 국어 정답 및 해설",
      query: "q10",
    },
    {
      url: `${W}/20250903/go3/kor_main_hsj_2X96S4LB_5.pdf`,
      title: "2026학년도 대학수학능력시험 9월 모의평가 국어 정답 및 해설",
      query: "q11",
    },
    // 공식 경로가 아님
    { url: "https://blog.example.com/x.pdf", title: "2025 6월 모의고사", query: "q12" },
  ];

  it("확실한 것만 CSV 로, 나머지는 사유와 함께 보류", () => {
    const { rows, held } = buildCandidates(found);
    expect(
      rows.map((r) => [r.subject, r.course_code, r.file_type, r.official_url.split("/").pop()]),
    ).toEqual([
      ["social", "social-culture", "question", "s_samun_mun_ABCDEF12.pdf"],
      ["social", "social-culture", "solution", "s_samun_hsj_522O36I8.pdf"],
      ["korean", "", "solution", "kor_main_hsj_2X96S4LB_2.pdf"],
    ]);
    const vias = Object.fromEntries(
      rows.map((r) => [
        r.official_url.split("/").pop(),
        r.evidence.find((e) => e.kind === "classification"),
      ]),
    );
    expect(vias["s_samun_hsj_522O36I8.pdf"]).toMatchObject({ via: "own_title" });
    expect(vias["s_samun_mun_ABCDEF12.pdf"]).toMatchObject({ via: "code_vote" });
    const reasons = Object.fromEntries(held.map((h) => [h.url.split("/").pop(), h.reasonCode]));
    expect(reasons).toEqual({
      "korB_1_mun_34L3Q845_1.pdf": "ambiguous_variant",
      "kor_main_hsj_4R8V482P.pdf": "exam_month_unconfirmed",
      "gat_main_mun_266Y98DR.pdf": "subject_mismatch",
      "kor_main_hsj_2L3Y8861.pdf": "slot_conflict",
      "kor_hsj_1V99HKS3.pdf": "slot_conflict",
      "live_main_paper_2_kor_942P72J5.pdf": "secondary_document",
      "live_main_answer_1_kor_8ZE3E1XR.pdf": "secondary_document",
      "kor_main_hsj_2X96S4LB_5.pdf": "duplicate_file",
      "x.pdf": "other",
    });
  });

  it("관리자가 승인한 규칙을 재사용하고, 체제에 없는 과목은 규칙이 있어도 보류", () => {
    const rules = new Map<string, MappingRule>([
      [
        "s_hanji|",
        {
          pattern: "s_hanji",
          gradeScope: "",
          subject: "social",
          courseCode: "korean-geography",
          approvals: 3,
        },
      ],
      [
        "2nd_ja|",
        {
          pattern: "2nd_ja",
          gradeScope: "",
          subject: "second_language",
          courseCode: "japanese-1",
          approvals: 2,
        },
      ],
    ]);
    const input: FoundEntry[] = [
      {
        url: `${W}/20250604/go3/s_hanji_mun_HY6L555G.pdf`,
        title: "2026학년도 6월 모의평가 문제지",
        query: "q",
      },
      // 고2 시험의 제2외국어는 카탈로그 체제에 없다 → 규칙이 있어도 보류
      {
        url: `${W}/20241015/go2/2nd_ja_hsj_JZU9L6AV.pdf`,
        title: "2024학년도 10월 고2 전국연합학력평가 정답 및 해설",
        query: "q",
      },
    ];
    const { rows, held } = buildCandidates(input, { rules });
    expect(rows.map((r) => [r.course_code, r.evidence.at(-1)])).toEqual([
      ["korean-geography", { kind: "classification", via: "approved_rule(3)", score: 90 }],
    ]);
    expect(held.map((h) => h.reasonCode)).toEqual(["course_unconfirmed"]);
  });

  it("CSV 는 import 검증을 그대로 통과하고, 연도 필터를 지킨다", () => {
    const { rows } = buildCandidates(found, { year: 2025 });
    const [header, ...lines] = parseCsv(candidatesToCsv(rows));
    expect(lines).toHaveLength(rows.length);
    for (const { cells } of lines) {
      const record = Object.fromEntries(header!.cells.map((h, i) => [h, cells[i] ?? ""]));
      expect(importRowSchema.safeParse(record).success).toBe(true);
    }
    expect(rows.every((r) => r.year === 2025)).toBe(true);
  });
});

describe("근거 파일", () => {
  it("브라우저 검증 기록을 근거 목록과 보류 사유 코드로 바꾼다", () => {
    const entries = parseEvidenceFile({
      records: [
        {
          url: "https://wdown.ebsi.co.kr/a.pdf",
          result: "held_manual_review",
          reason: "1쪽·문서 전체에 시행 연도·월·학년 표기 없음 (영역·정답만 보임)",
          browser: { status: 200, contentType: "application/pdf", pdfPages: 6, checkedAt: "t" },
          evidence: { method: "visual", page1Header: "1•영어영역•…", examLineInDocument: null },
          recheck: {
            method: "full PDF text, every page",
            checkedAt: "2026-09-25T13:08:33Z",
            reason: "재확인 결과 표기 없음",
          },
        },
        {
          url: "https://wdown.ebsi.co.kr/b.pdf",
          result: "approved",
          evidence: { examLineInDocument: "2025학년도3월고1전국연합학력평가" },
        },
      ],
    });
    expect(entries[0]).toMatchObject({
      reasonCode: "no_exam_identity",
      reason: "재확인 결과 표기 없음",
    });
    expect(entries[0]!.evidence.map((e) => e.kind)).toEqual([
      "browser_check",
      "page1_header",
      "exam_line",
      "visual_check",
    ]);
    expect(entries[1]).toMatchObject({ reasonCode: null, reason: null });
    expect(
      parseEvidenceFile([
        { url: "u", evidence: [{ kind: "classification", via: "own_title", score: 90 }] },
      ]),
    ).toHaveLength(1);
    expect(() => parseEvidenceFile({ nope: 1 })).toThrow();
  });

  it("규칙 키: 공통 과목·변형·고2·3 sat/gat·고1 3월은 규칙을 만들지 않는다", () => {
    expect(ruleKeyFor(`${W}/20250604/go3/s_samun_hsj_1.pdf`, { grade: 3, month: 6 })).toEqual({
      pattern: "s_samun",
      gradeScope: "",
    });
    expect(ruleKeyFor(`${W}/20250604/go3/kor_main_hsj_1.pdf`, { grade: 3, month: 6 })).toBeNull();
    expect(ruleKeyFor(`${W}/20250604/go3/korB_mun_1.pdf`, { grade: 3, month: 6 })).toBeNull();
    expect(ruleKeyFor(`${W}/20250604/go2/sat_main_mun_1.pdf`, { grade: 2, month: 6 })).toBeNull();
    expect(ruleKeyFor(`${W}/20250326/go1/gat_main_mun_1.pdf`, { grade: 1, month: 3 })).toBeNull();
    expect(ruleKeyFor(`${W}/20250604/go1/gat_main_mun_1.pdf`, { grade: 1, month: 6 })).toEqual({
      pattern: "gat",
      gradeScope: "go1",
    });
  });
});
