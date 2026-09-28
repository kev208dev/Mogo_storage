import { describe, expect, it } from "vitest";
import {
  runGradeCutWatch,
  type GradeCutAdapter,
  type WatchExam,
  type WatchProgress,
  type WatchSlot,
  type WatchSourceEvent,
  type WatchStore,
} from "../../src/ingestion/grade-cuts/core";
import { parseGradeCutCsv } from "../../src/ingestion/grade-cuts/input";
import {
  checkCuts,
  checkObservedAt,
  checkSourceUrl,
  dedupeCollected,
  GradeCutValidationError,
  maxRawScore,
  validateGradeCut,
} from "../../src/ingestion/grade-cuts/validate";

const exam: WatchExam = {
  id: "exam",
  year: 2026,
  grade: 3,
  month: 9,
  examType: "kice_mock",
  academicYear: 2027,
  examDate: "2026-09-02",
};
const after = new Date("2026-09-02T09:00:00Z");
const problem = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof GradeCutValidationError ? e.problem : `other:${String(e)}`;
  }
  return "ok";
};

describe("grade cut validation", () => {
  it("영역별 만점: 국어·수학·영어 100, 탐구·한국사·제2외국어 50", () => {
    expect(maxRawScore("korean")).toBe(100);
    expect(maxRawScore("math")).toBe(100);
    expect(maxRawScore("social")).toBe(50);
    expect(maxRawScore("science")).toBe(50);
    expect(maxRawScore("second_language")).toBe(50);
    expect(problem(() => checkCuts("social", [{ grade: 1, rawScore: 51 }]))).toBe("over_max");
    expect(problem(() => checkCuts("korean", [{ grade: 1, rawScore: 96 }]))).toBe("ok");
  });

  it("형식 오류: 등급 중복 · 역순 · 범위 밖 · 빈 컷 · 1등급 0점; 소수는 보존", () => {
    const bad = [
      [
        { grade: 1, rawScore: 80 },
        { grade: 1, rawScore: 70 },
      ],
      [
        { grade: 1, rawScore: 70 },
        { grade: 2, rawScore: 80 },
      ],
      [{ grade: 10, rawScore: 20 }],
      [],
    ];
    for (const cuts of bad) expect(problem(() => checkCuts("korean", cuts))).toBe("malformed");
    expect(checkCuts("korean", [{ grade: 1, rawScore: 80.5 }])).toEqual([
      { grade: 1, rawScore: 80.5 },
    ]);
    expect(problem(() => checkCuts("korean", [{ grade: 1, rawScore: 0 }]))).toBe("zero_top_grade");
    // 입력 순서와 무관하게 정렬된다
    expect(
      checkCuts("korean", [
        { grade: 2, rawScore: 80 },
        { grade: 1, rawScore: 88 },
      ]),
    ).toEqual([
      { grade: 1, rawScore: 88 },
      { grade: 2, rawScore: 80 },
    ]);
  });

  it("공식 등급컷은 출처 도메인(provenance)으로만 인정한다", () => {
    expect(problem(() => checkSourceUrl("official", "https://www.suneung.re.kr/x"))).toBe("ok");
    expect(problem(() => checkSourceUrl("official", "https://www.sen.go.kr/x"))).toBe("ok");
    // "확정 등급컷" 을 게시하는 사설·방송 사이트는 공식이 아니다
    for (const url of [
      "https://m.megastudy.net/x",
      "https://www.ebsi.co.kr/x",
      "https://www.mimacstudy.com/x",
      "https://suneung.re.kr.evil.example/x",
    ])
      expect(problem(() => checkSourceUrl("official", url))).toBe("source_host_mismatch");
    expect(problem(() => checkSourceUrl("official", "http://www.suneung.re.kr/x"))).toBe(
      "bad_source_url",
    );
    expect(problem(() => checkSourceUrl("official", "https://u:p@www.suneung.re.kr/x"))).toBe(
      "bad_source_url",
    );
    // 예상 등급컷: 수동 입력은 다른 공개 출처 인용 가능, 자동 수집은 source 도메인만
    expect(problem(() => checkSourceUrl("megastudy", "https://news.example.com/a"))).toBe("ok");
    expect(
      problem(() =>
        checkSourceUrl("megastudy", "https://news.example.com/a", { strictHost: true }),
      ),
    ).toBe("source_host_mismatch");
  });

  it("관측 시각: 시험 종료 전 · 미래 · 잘못된 날짜 거부", () => {
    const now = new Date("2026-09-03T00:00:00Z");
    expect(problem(() => checkObservedAt(exam, after, now))).toBe("ok");
    expect(problem(() => checkObservedAt(exam, new Date("2026-09-02T07:00:00Z"), now))).toBe(
      "bad_observed_at",
    );
    expect(problem(() => checkObservedAt(exam, new Date("2026-09-04T00:00:00Z"), now))).toBe(
      "bad_observed_at",
    );
    expect(problem(() => checkObservedAt(exam, new Date("nope"), now))).toBe("bad_observed_at");
    expect(
      validateGradeCut({
        exam,
        subject: "science",
        source: "megastudy",
        sourceUrl: "https://m.megastudy.net/a",
        cuts: [{ grade: 1, rawScore: 47 }],
        observedAt: after,
        now,
      }),
    ).toEqual({ cuts: [{ grade: 1, rawScore: 47 }], sourceUrl: "https://m.megastudy.net/a" });
  });

  it("같은 슬롯의 값이 모두 같으면 하나만, 다르면 모두 버린다", () => {
    const v = (key: string, score: number) => ({ key, cuts: [{ grade: 1, rawScore: score }] });
    const { kept, conflicting } = dedupeCollected(
      [v("a", 40), v("a", 40), v("b", 40), v("b", 41), v("c", 30)],
      (x) => x.key,
    );
    expect(kept.map((x) => x.key)).toEqual(["a", "c"]);
    expect(conflicting).toEqual(["b"]);
  });

  it("CSV: 탐구 만점 초과 · 비공식 도메인의 official 행은 오류로 보고한다", () => {
    const header = "year,grade,month,subject,course_code,source,source_url,cuts";
    const { rows, invalid } = parseGradeCutCsv(
      [
        header,
        '2025,3,9,social,social-culture,megastudy,https://m.megastudy.net/a,"1:48;2:45"',
        '2025,3,9,social,economics,megastudy,https://m.megastudy.net/a,"1:55"',
        '2025,3,9,korean,,official,https://m.megastudy.net/a,"1:88"',
      ].join("\n"),
    );
    expect(rows.map((r) => r.courseCode)).toEqual(["social-culture"]);
    expect(invalid.map((r) => r.line)).toEqual([3, 4]);
    expect(invalid[0]!.error).toMatch(/만점/);
    expect(invalid[1]!.error).toMatch(/공식/);
  });
});

describe("grade cut watch: 수집값 검증", () => {
  const slot = (courseCode: string): WatchSlot => ({
    examId: "exam",
    subject: "social",
    courseId: courseCode,
    courseCode,
    status: "waiting",
    lastPolledAt: null,
  });
  function store(slots: WatchSlot[]) {
    const saved: string[] = [];
    const s: WatchStore = {
      dueExams: async () => [exam],
      slots: async () => slots,
      save: async (_e, sl, source, value) => {
        saved.push(`${source}:${sl.courseCode}:${value.cuts.map((c) => c.rawScore).join(",")}`);
        return true;
      },
      markPolled: async () => {},
      fail: async () => {},
    };
    return { s, saved };
  }

  it("만점 초과 · 다른 도메인 · 모순 중복 값은 저장하지 않고 rejected 로 센다", async () => {
    const { s, saved } = store([
      slot("social-culture"),
      slot("economics"),
      slot("world-history"),
      slot("politics-and-law"),
    ]);
    const base = { subject: "social" as const, observedAt: after };
    const mega: GradeCutAdapter = {
      source: "megastudy",
      status: "automated_verified",
      collect: async () => [
        {
          ...base,
          courseCode: "social-culture",
          cuts: [{ grade: 1, rawScore: 47 }],
          sourceUrl: "https://m.megastudy.net/a",
        },
        {
          ...base,
          courseCode: "economics",
          cuts: [{ grade: 1, rawScore: 60 }],
          sourceUrl: "https://m.megastudy.net/a",
        },
        {
          ...base,
          courseCode: "world-history",
          cuts: [{ grade: 1, rawScore: 45 }],
          sourceUrl: "https://mirror.example.com/a",
        },
        {
          ...base,
          courseCode: "politics-and-law",
          cuts: [{ grade: 1, rawScore: 44 }],
          sourceUrl: "https://m.megastudy.net/a",
        },
        {
          ...base,
          courseCode: "politics-and-law",
          cuts: [{ grade: 1, rawScore: 43 }],
          sourceUrl: "https://m.megastudy.net/a",
        },
      ],
    };
    const events: WatchSourceEvent[] = [];
    const progress: WatchProgress[] = [];
    const result = await runGradeCutWatch(
      s,
      [mega],
      after,
      undefined,
      (e) => events.push(e),
      (p) => progress.push(p),
    );
    expect(saved).toEqual(["megastudy:social-culture:47"]);
    expect(result.changed).toBe(1);
    expect(events[0]).toMatchObject({ collected: 5, changed: 1, rejected: 3, failed: false });
    expect(progress.filter((p) => p.stage === "reject_cut").map((p) => p.reason ?? "")).toEqual([
      "conflict:social:politics-and-law",
      "over_max",
      "source_host_mismatch",
    ]);
  });

  it("공식 adapter 라도 공식 도메인이 아니면 확정(finalize)하지 않는다", async () => {
    const { s, saved } = store([slot("social-culture")]);
    const fake: GradeCutAdapter = {
      source: "official",
      status: "automated_verified",
      collect: async () => [
        {
          subject: "social",
          courseCode: "social-culture",
          cuts: [{ grade: 1, rawScore: 47 }],
          sourceUrl: "https://m.megastudy.net/confirmed",
          observedAt: after,
        },
      ],
    };
    const events: WatchSourceEvent[] = [];
    await runGradeCutWatch(s, [fake], after, undefined, (e) => events.push(e));
    expect(saved).toEqual([]);
    expect(events[0]).toMatchObject({ finalized: 0, rejected: 1 });
  });
});
