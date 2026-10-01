import { describe, expect, it } from "vitest";
import { parseJongroResultCut } from "../../src/ingestion/grade-cuts/adapters/jongro";
import type { WatchExam } from "../../src/ingestion/grade-cuts/core";

const exam: WatchExam = {
  id: "exam-3",
  year: 2026,
  grade: 3,
  month: 9,
  examDate: "2026-09-02",
  examType: "school_mock",
  academicYear: 2027,
};

const url = "https://www.jongro.co.kr/service/examResult/ex20260902/go3_resultCut.asp";

const table = (raw: number, standard: number, percentile: number) => `
  <table class="view_data01">
    <tr>
      <th><img alt="등급"></th>
      <th><img alt="원점수"></th>
      <th><img alt="표준점수"></th>
      <th><img alt="백분위"></th>
    </tr>
    <tr>
      <td><img alt="1등급"></td>
      <td>${raw}</td>
      <td>${standard}</td>
      <td>${percentile}</td>
    </tr>
  </table>`;

const html = `
<html><body>
  <h1>2026 고3 9.2 확정 등급컷</h1>
  <ul id="tabController01" class="mlist01 tab_subject01">
    <li><img alt="국어"></li>
    <li><img alt="수학"></li>
    <li><img alt="영어"></li>
    <li><img alt="한국사"></li>
    <li><img alt="사회탐구"></li>
    <li><img alt="과학탐구"></li>
  </ul>

  <div id="tabCon01">
    <ul class="mlist02 tab_subject02">
      <li><img alt="국어(화법과 작문)"></li>
      <li><img alt="국어(언어와 매체)"></li>
    </ul>
    <div id="tabCon01_01">${table(91, 131, 96)}</div>
    <div id="tabCon01_02">${table(89, 131, 96)}</div>
  </div>

  <div id="tabCon02">
    <ul class="mlist02 tab_subject02">
      <li><img alt="수학(확률과 통계)"></li>
      <li><img alt="수학(미적분)"></li>
      <li><img alt="수학(기하)"></li>
    </ul>
    <div id="tabCon02_01">${table(88, 133, 96)}</div>
    <div id="tabCon02_02">${table(84, 133, 96)}</div>
    <div id="tabCon02_03">${table(85, 133, 96)}</div>
  </div>

  <div id="tabCon03"><ul class="mlist02 tab_subject02"><li><img alt="영어"></li></ul></div>
  <div id="tabCon04"><ul class="mlist02 tab_subject02"><li><img alt="한국사"></li></ul></div>

  <div id="tabCon05">
    <ul class="mlist02 tab_subject02">
      <li><img alt="생활과윤리"></li>
      <li><img alt="사회문화"></li>
    </ul>
    <div id="tabCon05_01">${table(47, 68, 96)}</div>
    <div id="tabCon05_02">${table(45, 67, 96)}</div>
  </div>

  <div id="tabCon06">
    <ul class="mlist02 tab_subject02">
      <li><img alt="물리학1"></li>
      <li><img alt="지구과학1"></li>
    </ul>
    <div id="tabCon06_01">${table(46, 68, 96)}</div>
    <div id="tabCon06_02">${table(45, 67, 96)}</div>
  </div>
</body></html>`;

describe("Jongro high3 live layout", () => {
  it("maps wrapped Korean/math labels and separate inquiry tabs through COURSE_CATALOG", () => {
    const result = parseJongroResultCut(html, exam, url);
    const codes = result.rows.map((row) => row.courseCode);

    expect(codes).toEqual(
      expect.arrayContaining([
        "speech-and-writing",
        "language-and-media",
        "probability-and-statistics",
        "calculus",
        "geometry",
        "life-and-ethics",
        "social-culture",
        "physics-1",
        "earth-science-1",
      ]),
    );
    expect(result.rows).toHaveLength(9);
    expect(result.rows.every((row) => row.providerStatus === "provider_final")).toBe(true);
  });
});
