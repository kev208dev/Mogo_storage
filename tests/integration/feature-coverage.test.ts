import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { computeFeatureCoverage, formatFeatureCoverage } from "@/ingestion/feature-coverage";
import { importOfficialUrls } from "@/ingestion/manual-import/import";
import { syncBuiltinSources } from "@/ingestion/pipeline/sources";
import type { Subject } from "@/lib/constants";
import { resetDb, setupDb, TEST_DB_URL } from "./helpers";

const W = "https://wdown.ebsi.co.kr/W61001/01exam/20250604/go3";
const KICE = "https://www.suneung.re.kr/boardCnts/file.pdf";

describe.skipIf(!TEST_DB_URL)("시험별 기능 coverage", () => {
  let db: Database;
  beforeAll(async () => {
    db = await setupDb();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await resetDb(db);
    await syncBuiltinSources(db);
  });

  async function exam(month: number, examType: "kice_mock" | "school_mock" = "kice_mock") {
    const [e] = await db
      .insert(s.exams)
      .values({
        year: 2025,
        grade: 3,
        month,
        examDate: `2025-${String(month).padStart(2, "0")}-04`,
        academicYear: 2026,
        examType,
        organizer: "x",
        slug: `cov-${month}`,
        isSample: false,
      })
      .returning();
    return e!.id;
  }
  const file = (
    examId: string,
    subject: Subject,
    type: "question" | "solution" | "listening_audio",
    courseId: string | null,
    externalUrl: string,
  ) => ({
    examId,
    subject,
    type,
    courseId,
    deliveryType: "redirect" as const,
    externalUrl,
    mimeType: type === "listening_audio" ? "audio/mpeg" : "application/pdf",
    originalFileName: `${subject}-${type}-${courseId ?? "all"}.pdf`,
  });

  it("완료 · 일부 · 없음 · 정책상 수동 · 해당 없음을 슬롯 기준으로 계산한다", async () => {
    const june = await exam(6);
    await db.insert(s.examSubjects).values([
      { examId: june, subject: "korean", questionCount: 45, totalScore: 100 },
      { examId: june, subject: "english", questionCount: 45, totalScore: 100 },
      { examId: june, subject: "science", questionCount: 20, totalScore: 50 },
    ]);
    await db
      .insert(s.examFiles)
      .values([
        file(june, "korean", "question", null, `${W}/kor_main_mun_A.pdf`),
        file(june, "korean", "solution", null, `${W}/kor_main_hsj_A.pdf`),
        file(june, "english", "question", null, `${W}/eng_1_mun_A.pdf`),
        file(june, "english", "solution", null, KICE),
        file(june, "english", "listening_audio", null, `${W}/eng_listen.mp3`),
        file(june, "science", "question", "chemistry-1", `${W}/g_che1_mun_A.pdf`),
        file(june, "science", "solution", "chemistry-1", `${W}/g_che1_hsj_A.pdf`),
        file(june, "science", "question", "physics-1", `${W}/g_phy1_mun_A.pdf`),
      ]);
    await db.insert(s.questions).values(
      Array.from({ length: 20 }, (_, i) => ({
        examId: june,
        subject: "science" as const,
        courseId: "chemistry-1",
        questionNumber: i + 1,
        answer: "1",
        score: i < 10 ? 3 : 2,
      })),
    );
    await db.insert(s.gradeCuts).values({
      examId: june,
      subject: "science",
      courseId: "chemistry-1",
      source: "megastudy",
      sourceUrl: "https://m.megastudy.net/x",
      cuts: [{ grade: 1, rawScore: 47 }],
      isOfficial: false,
    });

    const c = await computeFeatureCoverage(db);
    expect(c.total).toBe(1);
    const f = c.rows[0]!.features;
    // 국어 · 영어 · 화학Ⅰ 완료, 물리학Ⅰ 해설 없음 → 일부
    expect(f.files).toMatchObject({ status: "partial", detail: "3/4 슬롯" });
    // 해설이 있는 슬롯 3개 중 화학Ⅰ만 문항 게시
    expect(f.answers).toMatchObject({ status: "partial", detail: "1/3 슬롯" });
    // 상대평가: 국어 · 화학Ⅰ · 물리학Ⅰ (영어는 절대평가)
    expect(f.grade_cuts).toMatchObject({ status: "partial", detail: "1/3 상대평가 슬롯" });
    expect(f.listening.status).toBe("partial");
    expect(f.vocabulary.status).toBe("missing");
    expect(c.summary.files.partial).toBe(1);
    expect(formatFeatureCoverage(c)).toContain("2025 고3  6월");
  });

  it("정답 · 등급컷을 정책상 자동화할 수 없으면 blocked_policy, 영어가 없으면 not_applicable", async () => {
    const sep = await exam(9);
    await db
      .insert(s.examSubjects)
      .values({ examId: sep, subject: "korean", questionCount: 45, totalScore: 100 });
    await db
      .insert(s.examFiles)
      .values([
        file(sep, "korean", "question", null, KICE),
        file(sep, "korean", "solution", null, KICE.replace("file", "sol")),
      ]);
    const f = (await computeFeatureCoverage(db)).rows[0]!.features;
    expect(f.files.status).toBe("complete");
    // 해설이 KICE 에만 있음 → 정책상 요청 불가
    expect(f.answers.status).toBe("blocked_policy");
    // 고3 국어 원점수 등급컷을 자동 수집할 수 있는 허용 source 없음
    expect(f.grade_cuts.status).toBe("blocked_policy");
    expect(f.listening.status).toBe("not_applicable");
    expect(f.vocabulary.status).toBe("not_applicable");
  });

  it("검토 대기 자료가 있으면 파일은 manual_review, 페이지 나누기", async () => {
    for (const m of [4, 5]) await exam(m, "school_mock");
    await importOfficialUrls(db, {
      csv: [
        "year,grade,month,exam_type,exam_date,organizer,subject,course_code,file_type,official_url,original_file_name,source_label",
        `2025,3,3,school_mock,2025-03-26,서울특별시교육청,history,,question,${W.replace("20250604", "20250326")}/s_his_mun_Q.pdf,,EBSi test`,
      ].join("\n"),
      admin: "ops@example.com",
    });
    const all = await computeFeatureCoverage(db);
    expect(all.total).toBe(3);
    const march = all.rows.find((r) => r.month === 3)!;
    expect(march.features.files).toMatchObject({ status: "manual_review" });
    expect(march.features.files.detail).toMatch(/검토 대기 1/);
    const page = await computeFeatureCoverage(db, { limit: 2, offset: 0 });
    expect(page.rows).toHaveLength(2);
    expect((await computeFeatureCoverage(db, { limit: 2, offset: 2 })).rows).toHaveLength(1);
  });
});
