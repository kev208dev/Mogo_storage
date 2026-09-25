import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { enqueueJob } from "@/ingestion/jobs/queue";
import { runJobs } from "@/ingestion/jobs/worker";
import {
  approveImportedArtifacts,
  importOfficialUrls,
  OPERATOR_IMPORT_SOURCE_ID,
  rejectImportedArtifacts,
} from "@/ingestion/manual-import/import";
import { queueRechecks } from "@/ingestion/backfill";
import { syncBuiltinSources } from "@/ingestion/pipeline/sources";
import { makeContext, resetDb, setupDb, TEST_DB_URL } from "./helpers";

const HEADER =
  "year,grade,month,exam_type,exam_date,organizer,subject,course_code,file_type,official_url,original_file_name,source_label";
// 테스트 전용 경로 (__test__) — 서버가 요청하지 않으므로 존재하지 않아도 된다
const U = (p: string) => `https://www.suneung.re.kr/__test__/${p}`;
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");
const ROWS = {
  korQ: `2025,3,9,kice_mock,2025-09-03,한국교육과정평가원,korean,,question,${U("kor_q.pdf")},국어_문제.pdf,국어 문제`,
  socQ: `2025,3,9,kice_mock,2025-09-03,한국교육과정평가원,social,social-culture,question,${U("soc_q.pdf")},,사회탐구 사회·문화 문제`,
  jpnQ: `2024,3,7,school_mock,2024-07-11,서울특별시교육청,second-language,japanese-1,question,https://wdown.ebsi.co.kr/__test__/jpn.pdf,일본어_문제.pdf,제2외국어/한문 일본어Ⅰ 문제`,
};

describe.skipIf(!TEST_DB_URL)("운영자 공식 URL CSV 입력 → 검토 → redirect 게시", () => {
  let db: Database;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    db = await setupDb();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await resetDb(db);
    await db.delete(s.officialUrlImports);
    await syncBuiltinSources(db);
    // 서버가 입력된 URL 에 요청하면 안 된다 — 모든 fetch 를 감시한다
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => fetchSpy.mockRestore());

  /** 개발용 샘플 시험 (같은 시험 identity) */
  async function seedSampleExam() {
    const [exam] = await db
      .insert(s.exams)
      .values({
        year: 2025,
        grade: 3,
        month: 9,
        academicYear: 2026,
        examType: "kice_mock",
        organizer: "한국교육과정평가원",
        slug: "2025-high3-09",
        isSample: true,
      })
      .returning();
    await db.insert(s.examSubjects).values({ examId: exam!.id, subject: "korean" });
    await db.insert(s.examFiles).values({
      examId: exam!.id,
      subject: "korean",
      type: "question",
      deliveryType: "storage",
      storageKey: "exams/2025/high3/09/korean/question.pdf",
      artifactOrigin: "official",
      mimeType: "application/pdf",
      originalFileName: "[샘플] 국어.pdf",
    });
    await db.insert(s.gradeCuts).values({
      examId: exam!.id,
      subject: "korean",
      source: "official",
      isOfficial: true,
      isSample: true,
      cuts: [],
    });
    await db.insert(s.questions).values({
      examId: exam!.id,
      subject: "korean",
      questionNumber: 1,
      answer: "1",
      score: 2,
    });
    return exam!;
  }

  it("검토 대기로 저장, 재입력 idempotent, URL 변경은 재검토, 같은 슬롯 다른 URL 은 오류", async () => {
    const { ctx } = makeContext(db);
    const first = await importOfficialUrls(db, {
      csv: csv(ROWS.korQ, ROWS.socQ, ROWS.jpnQ),
      admin: "ops@example.com",
      now: ctx.now(),
    });
    expect(first.counts).toEqual({ created: 3, updated: 0, unchanged: 0, invalid: 0 });
    const artifacts = await db.select().from(s.sourceArtifacts);
    expect(artifacts.every((a) => a.status === "manual_review")).toBe(true);
    expect(artifacts.every((a) => a.sourceId === OPERATOR_IMPORT_SOURCE_ID)).toBe(true);
    expect(artifacts.every((a) => a.deliveryPolicy === "manual_review")).toBe(true);
    expect(artifacts.find((a) => a.courseLabel === "japanese-1")?.sourceLabel).toBe(
      "제2외국어/한문 일본어Ⅰ 문제",
    );
    expect(await db.select().from(s.examFiles)).toHaveLength(0); // 승인 전 비공개
    const [exam2024] = await db.select().from(s.exams).where(eq(s.exams.year, 2024));
    expect(exam2024).toMatchObject({ examDate: "2024-07-11", organizer: "서울특별시교육청" });

    const again = await importOfficialUrls(db, {
      csv: csv(ROWS.korQ, ROWS.socQ, ROWS.jpnQ),
      admin: "ops@example.com",
    });
    expect(again.counts).toEqual({ created: 0, updated: 0, unchanged: 3, invalid: 0 });
    expect(await db.select().from(s.sourceArtifacts)).toHaveLength(3);
    expect(await db.select().from(s.exams)).toHaveLength(2);

    const changed = await importOfficialUrls(db, {
      csv: csv(ROWS.korQ.replace("kor_q.pdf", "kor_q_v2.pdf")),
      admin: "ops@example.com",
    });
    expect(changed.counts.updated).toBe(1);

    const dupSlot = await importOfficialUrls(db, {
      csv: csv(ROWS.korQ, ROWS.korQ.replace("kor_q.pdf", "other.pdf")),
      admin: "ops@example.com",
      dryRun: true,
    });
    expect(dupSlot.counts.invalid).toBe(1);
    expect(dupSlot.rows[1]!.errors![0]).toMatch(/같은 슬롯에 다른 URL/);

    const bad = await importOfficialUrls(db, {
      csv: csv(ROWS.korQ.replace(U("kor_q.pdf"), "https://mirror.example.com/q.pdf")),
      admin: "ops@example.com",
    });
    expect(bad.counts.invalid).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.select().from(s.officialUrlImports)).toHaveLength(4); // dry-run 은 기록 안 함
  });

  it("브라우저 확인 체크 없이는 승인 불가, 승인하면 redirect 로 게시 + 샘플 시험을 실제 시험으로 교체", async () => {
    const sample = await seedSampleExam();
    const { ctx, revalidated } = makeContext(db);
    await importOfficialUrls(db, {
      csv: csv(ROWS.korQ, ROWS.socQ),
      admin: "ops@example.com",
    });
    const ids = (await db.select().from(s.sourceArtifacts)).map((a) => a.id);
    // 샘플 시험에 붙었지만 승인 전에는 샘플 그대로 (섞이지 않음)
    expect((await db.select().from(s.exams))[0]!.isSample).toBe(true);

    await expect(
      approveImportedArtifacts(ctx, {
        artifactIds: ids,
        admin: "ops@example.com",
        browserChecked: false,
      }),
    ).rejects.toThrow(/브라우저/);

    const result = await approveImportedArtifacts(ctx, {
      artifactIds: ids,
      admin: "ops@example.com",
      browserChecked: true,
    });
    expect(result).toEqual({ published: 2, skipped: [] });

    const [exam] = await db.select().from(s.exams).where(eq(s.exams.id, sample.id));
    expect(exam!.isSample).toBe(false);
    // 샘플 내용 제거
    expect(await db.select().from(s.gradeCuts)).toHaveLength(0);
    expect(await db.select().from(s.questions)).toHaveLength(0);
    const files = await db.select().from(s.examFiles);
    expect(
      files.map((f) => [f.subject, f.type, f.deliveryType, f.externalUrl, f.storageKey]),
    ).toEqual(
      expect.arrayContaining([
        ["korean", "question", "redirect", U("kor_q.pdf"), null],
        ["social", "question", "redirect", U("soc_q.pdf"), null],
      ]),
    );
    expect(files).toHaveLength(2); // 샘플 파일은 교체됨
    expect(files.every((f) => f.sourceLabel === "공식 자료 (운영자 확인)")).toBe(true);
    expect(revalidated).toContain("/exam/2025/high3/09/social/social-culture");

    // 게시 후 job 이 돌아도 서버는 공식 URL 에 요청하지 않는다 (재검증·단어장 제외)
    await runJobs(ctx);
    ctx.now = () => new Date("2026-12-01T00:00:00Z");
    expect(await queueRechecks(ctx)).toBe(0);
    await enqueueJob(db, {
      type: "verify_artifact",
      payload: { artifactId: ids[0] },
      dedupeKey: "forced-verify",
    });
    await runJobs(ctx);
    const [still] = await db
      .select()
      .from(s.sourceArtifacts)
      .where(eq(s.sourceArtifacts.id, ids[0]!));
    expect(still!.status).toBe("ready");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("거절하면 공개하지 않고, 다시 입력해도 거절 상태를 덮지 않는다(같은 URL)", async () => {
    const { ctx } = makeContext(db);
    await importOfficialUrls(db, { csv: csv(ROWS.jpnQ), admin: "ops@example.com" });
    const [a] = await db.select().from(s.sourceArtifacts);
    expect(
      await rejectImportedArtifacts(ctx, {
        artifactIds: [a!.id],
        admin: "ops@example.com",
        reason: "다른 과목 파일",
      }),
    ).toBe(1);
    const again = await importOfficialUrls(db, { csv: csv(ROWS.jpnQ), admin: "ops@example.com" });
    expect(again.counts.unchanged).toBe(1);
    const [row] = await db
      .select()
      .from(s.sourceArtifacts)
      .where(and(eq(s.sourceArtifacts.id, a!.id)));
    expect(row!.status).toBe("failed");
    expect(await db.select().from(s.examFiles)).toHaveLength(0);
  });
});
