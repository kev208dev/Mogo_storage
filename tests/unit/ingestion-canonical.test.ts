import { describe, expect, it } from "vitest";
import { dedupeArtifacts, normalizeArtifactType } from "@/ingestion/canonical/artifact-type";
import {
  canonicalizeExamTitle,
  canonicalKey,
  sameCanonicalExam,
} from "@/ingestion/canonical/exam-title";
import { normalizeSubject } from "@/ingestion/canonical/subject";
import type { DiscoveredArtifact } from "@/ingestion/types";

const ok = (title: string, hints = {}) => {
  const r = canonicalizeExamTitle(title, hints);
  if (!r.ok) throw new Error(`${title}: ${r.reason}`);
  return r.exam;
};

describe("canonicalizeExamTitle — 학년도 vs 시행 연도", () => {
  it.each([
    // [title, year, grade, month, examType, academicYear]
    ["2026학년도 대학수학능력시험", 2025, 3, 11, "csat", 2026],
    ["2027학년도 수능", 2026, 3, 11, "csat", 2027],
    ["2026학년도 9월 모의평가", 2025, 3, 9, "kice_mock", 2026],
    ["2026학년도 대학수학능력시험 9월 모의평가 문제 및 정답", 2025, 3, 9, "kice_mock", 2026],
    ["2026학년도 대학수학능력시험 6월 모의평가", 2025, 3, 6, "kice_mock", 2026],
    ["2025년 9월 모의평가", 2025, 3, 9, "kice_mock", 2026],
    ["2025년 6월 고3 모의평가", 2025, 3, 6, "kice_mock", 2026],
    ["2025년 9월 고2 전국연합학력평가", 2025, 2, 9, "school_mock", null],
    ["2025년 고1 3월 학력평가", 2025, 1, 3, "school_mock", null],
    ["2025학년도 고2 11월 전국연합학력평가", 2025, 2, 11, "school_mock", null],
    ["2025년 4월 고3 전국연합학력평가", 2025, 3, 4, "school_mock", null],
    ["2026학년도 대비 3월 고3 전국연합학력평가", 2025, 3, 3, "school_mock", null],
    ["2025년 10월 고등학교 2학년 전국연합학력평가", 2025, 2, 10, "school_mock", null],
    ["２０２５년　９월　고２　학평", 2025, 2, 9, "school_mock", null],
  ])("%s", (title, year, grade, month, examType, academicYear) => {
    expect(ok(title)).toEqual({ year, grade, month, examType, academicYear });
  });

  it("'9월 모평' 처럼 연도가 없으면 목록 페이지 hint 의 시행 연도를 쓴다", () => {
    expect(ok("9월 모평", { year: 2025 })).toMatchObject({
      year: 2025,
      grade: 3,
      month: 9,
      academicYear: 2026,
    });
  });

  it("같은 시험의 다른 표기는 같은 identity 가 된다", () => {
    const names = [
      "2026학년도 9월 모의평가",
      "2025년 9월 모의평가",
      "2026학년도 대학수학능력시험 9월 모의평가 문제 및 정답",
    ];
    const exams = names.map((n) => ok(n));
    for (const e of exams) expect(sameCanonicalExam(e, exams[0]!)).toBe(true);
    expect(canonicalKey(exams[0]!)).toBe("2025-3-09");
  });

  it("학년도 표기를 시행 연도로 착각하지 않는다 (URL/SEO year = 시행 연도)", () => {
    const csat = ok("2027학년도 대학수학능력시험");
    expect(csat.year).toBe(2026);
    expect(csat.academicYear).toBe(2027);
  });

  it("학년이 없는 학력평가는 hint 를 쓰고, 없으면 실패한다", () => {
    expect(ok("2025년 9월 전국연합학력평가", { grade: 1 })).toMatchObject({ grade: 1 });
    expect(canonicalizeExamTitle("2025년 9월 전국연합학력평가").ok).toBe(false);
  });

  it("모순된 조합은 거부한다", () => {
    expect(canonicalizeExamTitle("2025년 9월 고2 모의평가").ok).toBe(false);
    expect(canonicalizeExamTitle("기출문제 이용 안내").ok).toBe(false);
  });
});

describe("normalizeSubject / normalizeArtifactType", () => {
  it.each([
    ["국어", "korean"],
    ["국어영역", "korean"],
    ["수학영역_문제지.pdf", "math"],
    ["영어", "english"],
    ["한국사영역", "history"],
    ["사회탐구", "social"],
    ["통합사회", "social"],
    ["과학탐구", "science"],
    ["kor_q.pdf", "korean"],
    ["eng_listen.mp3", "english"],
  ])("%s → %s", (raw, subject) => expect(normalizeSubject(raw)).toBe(subject));

  it("지원하지 않는 과목은 null", () => {
    expect(normalizeSubject("제2외국어")).toBeNull();
    expect(normalizeSubject("제2외국어한문영역_문제지.pdf")).toBeNull();
    expect(normalizeSubject("직업탐구")).toBeNull();
  });

  it.each([
    ["문제", "question"],
    ["문제지", "question"],
    ["정답 및 해설", "solution"],
    ["정답표", "solution"],
    ["듣기 MP3", "listening_audio"],
    ["영어영역_듣기평가.mp3", "listening_audio"],
    ["듣기 대본", "listening_script"],
    ["기타", null],
  ])("%s → %s", (raw, type) => expect(normalizeArtifactType(raw)).toBe(type));
});

describe("dedupeArtifacts", () => {
  const a = (over: Partial<DiscoveredArtifact>): DiscoveredArtifact => ({
    subject: "math",
    type: "solution",
    url: "https://x/a.pdf",
    label: "해설",
    fileNameHint: null,
    publishedAt: null,
    course: { status: "none" },
    courseLabel: null,
    containerType: "file",
    containsMultipleCourses: false,
    ...over,
  });

  it("같은 슬롯이면 해설 포함본을 정답표보다 우선한다", () => {
    const { artifacts } = dedupeArtifacts([
      a({ url: "https://x/ans.pdf", label: "정답" }),
      a({ url: "https://x/sol.pdf", label: "해설" }),
    ]);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.url).toBe("https://x/sol.pdf");
  });

  it("같은 URL 중복은 하나로 합친다", () => {
    expect(dedupeArtifacts([a({}), a({})]).artifacts).toHaveLength(1);
  });

  it("선택과목처럼 우열을 가릴 수 없는 후보는 conflicts 로 분리한다", () => {
    const r = dedupeArtifacts([
      a({ subject: "social", type: "question", url: "https://x/geo.pdf", label: "한국지리 문제" }),
      a({
        subject: "social",
        type: "question",
        url: "https://x/eth.pdf",
        label: "생활과윤리 문제",
      }),
    ]);
    expect(r.artifacts).toHaveLength(0);
    expect(r.conflicts).toHaveLength(1);
  });
});
