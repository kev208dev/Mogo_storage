import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { runBackfill } from "@/ingestion/backfill";
import { ebsiListingUrl } from "@/ingestion/sources/ebsi/structure";
import { reviewStudyMaterial } from "@/ingestion/study/materials";
import { importReadingNotes } from "@/ingestion/study/reading-notes";
import {
  ebsiListingHtml,
  installSources,
  makeContext,
  makeMp3,
  makePdf,
  resetDb,
  setupDb,
  startFakeSource,
  testSource,
  TEST_DB_URL,
  type FakeSource,
} from "./helpers";

const run = describe.skipIf(!TEST_DB_URL);

/** 직접 쓴 합성 대본 (실제 시험 대본 아님) — 1~15번 단일 문항 + 16~17번 공유 지문 */
function scriptLines(): string[] {
  const lines = ["TEST FIXTURE — NOT A REAL EXAM (합성 듣기 대본)"];
  for (let n = 1; n <= 15; n += 1) {
    lines.push(`${n}번`);
    lines.push(`M: Synthetic question ${n} opening line.`);
  }
  lines.push("[16~17]");
  lines.push("W: Shared synthetic passage for the last two questions.");
  lines.push("M: It continues with a second shared line.");
  return lines;
}

run("English study pipeline (official script → transcripts → worksheets → review)", () => {
  let db: Database;
  let fake: FakeSource;

  beforeAll(async () => {
    db = await setupDb();
    fake = await startFakeSource();
  });
  afterAll(async () => {
    await fake.close();
  });
  beforeEach(async () => {
    await resetDb(db);
    fake.routes.clear();
    process.env.VOCABULARY_PIPELINE_ENABLED = "true";
  });

  async function seed(withScript: boolean) {
    const listing = new URL(ebsiListingUrl(fake.baseUrl, 2, 2025));
    for (const g of [1, 3] as const) {
      const u = new URL(ebsiListingUrl(fake.baseUrl, g, 2025));
      fake.set(u.pathname + u.search, {
        contentType: "text/html",
        body: ebsiListingHtml(fake.baseUrl, []),
      });
    }
    fake.set(listing.pathname + listing.search, {
      contentType: "text/html; charset=utf-8",
      body: ebsiListingHtml(fake.baseUrl, [
        {
          id: "E-2025-2-09",
          title: "2025년 9월 고2 전국연합학력평가",
          date: "2025.09.03",
          subjects: [
            {
              name: "영어",
              links: [
                { label: "문제", path: "/files/eng_q.pdf" },
                { label: "듣기", path: "/files/eng.mp3" },
                ...(withScript ? [{ label: "듣기 대본", path: "/files/eng_script.pdf" }] : []),
              ],
            },
          ],
        },
      ]),
    });
    fake.set("/files/eng_q.pdf", {
      contentType: "application/pdf",
      body: await makePdf(["TEST FIXTURE — NOT A REAL EXAM", "x".repeat(60)]),
    });
    fake.set("/files/eng.mp3", { contentType: "audio/mpeg", body: makeMp3() });
    if (withScript)
      fake.set("/files/eng_script.pdf", {
        contentType: "application/pdf",
        body: await makePdf(scriptLines()),
      });
    await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
  }

  it("official script → per-question transcripts (origin official, timing unverified) → site", async () => {
    await seed(true);
    const { ctx, revalidated } = makeContext(db);
    const { jobs } = await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
    expect(jobs?.failed).toBe(0);

    const tracks = await db.select().from(s.listeningTracks);
    expect(tracks).toHaveLength(17);
    // 구간은 만들지 않는다
    expect(
      tracks.every((t) => !t.timingVerified && t.startSeconds === 0 && t.endSeconds === 0),
    ).toBe(true);
    const transcripts = await db.select().from(s.listeningTranscripts);
    expect(transcripts).toHaveLength(17);
    expect(new Set(transcripts.map((t) => t.origin))).toEqual(new Set(["official"]));
    for (const t of transcripts) {
      expect(t.sourceUrl).toBe(`${fake.baseUrl}/files/eng_script.pdf`);
      expect(t.parserVersion).toBe("listening-script-v2");
    }
    // 16·17번은 같은 공유 지문에서 나온 같은 대본, 출처도 같다
    const numberOf = new Map(tracks.map((t) => [t.id, t.questionNumber]));
    const byNumber = (n: number) => transcripts.find((t) => numberOf.get(t.trackId) === n)!;
    expect(byNumber(16).lines).toEqual([
      { speaker: "W", text: "Shared synthetic passage for the last two questions." },
      { speaker: "M", text: "It continues with a second shared line." },
    ]);
    expect(byNumber(17).lines).toEqual(byNumber(16).lines);
    expect(byNumber(17).sourceFileId).toBe(byNumber(16).sourceFileId);
    expect(byNumber(15).lines).toEqual([
      { speaker: "M", text: "Synthetic question 15 opening line." },
    ]);
    expect(revalidated).toContain("/exam/2025/high2/09/english");

    // 학습지: 받아쓰기 학습지/정답이 생성됐지만 게시되지 않았다
    const materials = await db.select().from(s.studyMaterials);
    expect(materials.map((m) => m.kind).sort()).toEqual(["dictation_answers", "dictation_sheet"]);
    expect(materials.every((m) => m.status === "generated" && m.examFileId === null)).toBe(true);

    const { DrizzleExamRepository } = await import("@/lib/data/drizzle-repository");
    const repo = new DrizzleExamRepository(db);
    const detail = await repo.getSubjectDetail({ year: 2025, grade: 2, month: 9 }, "english");
    const withScript = detail!.listeningTracks.filter((t) => t.transcript);
    expect(withScript).toHaveLength(17);
    expect(withScript[0]).toMatchObject({
      timingVerified: false,
      transcriptOrigin: "official",
      transcript: [{ speaker: "M", text: "Synthetic question 1 opening line." }],
    });
    expect(detail!.pendingMaterialKinds.sort()).toEqual(["dictation_answers", "dictation_sheet"]);
    expect(detail!.files.some((f) => f.type === "dictation_sheet")).toBe(false);

    // 출처 미확인 대본은 공개 데이터에서 빠진다
    await db
      .update(s.listeningTranscripts)
      .set({ origin: "unverified" })
      .where(eq(s.listeningTranscripts.id, transcripts[0]!.id));
    const hidden = await repo.getSubjectDetail({ year: 2025, grade: 2, month: 9 }, "english");
    expect(hidden!.listeningTracks.filter((t) => t.transcript)).toHaveLength(16);

    // 승인 → 게시하면 generated 파일로 공개
    const sheet = materials.find((m) => m.kind === "dictation_sheet")!;
    await reviewStudyMaterial(ctx, { id: sheet.id, action: "approve", admin: "ops@example.com" });
    await reviewStudyMaterial(ctx, { id: sheet.id, action: "publish", admin: "ops@example.com" });
    const published = await repo.getSubjectDetail({ year: 2025, grade: 2, month: 9 }, "english");
    expect(published!.files.find((f) => f.type === "dictation_sheet")).toMatchObject({
      artifactOrigin: "generated",
      sourceLabel: "모의고사 창고",
      originalFileName: "2025-고2-09월-영어-받아쓰기.pdf",
    });
    // 게시 내리기
    await reviewStudyMaterial(ctx, { id: sheet.id, action: "reject", admin: "ops@example.com" });
    const [gone] = await db
      .select()
      .from(s.examFiles)
      .where(and(eq(s.examFiles.type, "dictation_sheet")));
    expect(gone).toBeUndefined();
  });

  it("reprocesses v1 data: study:backfill re-enqueues with the new parser version and restores 17번", async () => {
    await seed(true);
    const { ctx } = makeContext(db);
    await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
    // v1 시절 상태 재현: 17번 없음 · parser v1 · dedupe key 에 parser version 없음
    const [t17] = await db
      .select()
      .from(s.listeningTracks)
      .where(eq(s.listeningTracks.questionNumber, 17));
    await db.delete(s.listeningTracks).where(eq(s.listeningTracks.id, t17!.id));
    await db.update(s.listeningTranscripts).set({ parserVersion: "listening-script-v1" });
    await db.execute(
      sql`update jobs set dedupe_key = regexp_replace(dedupe_key, ':listening-script-v2$', '') where type = 'extract_listening_script'`,
    );

    const { backfillEnglishStudy } = await import("@/ingestion/study/backfill");
    const filter = { year: 2025, grade: 2 as const, month: 9 };
    const dry = await backfillEnglishStudy(ctx, filter, { dryRun: true });
    expect(dry).toMatchObject({ listeningEligible: 1, listeningScheduled: 0 });
    expect(await db.select().from(s.jobs).where(eq(s.jobs.status, "pending"))).toHaveLength(0);

    await backfillEnglishStudy(ctx, filter);
    const { runJobs } = await import("@/ingestion/jobs/worker");
    const worker = await runJobs(ctx, { limit: 20 });
    expect(worker.failed).toBe(0);

    const tracks = await db.select().from(s.listeningTracks);
    expect(tracks.map((t) => t.questionNumber).sort((a, b) => a! - b!)).toEqual(
      Array.from({ length: 17 }, (_, i) => i + 1),
    );
    const transcripts = await db.select().from(s.listeningTranscripts);
    expect(transcripts).toHaveLength(17);
    expect(new Set(transcripts.map((t) => t.parserVersion))).toEqual(
      new Set(["listening-script-v2"]),
    );
    expect(tracks.every((t) => !t.timingVerified && t.endSeconds === 0)).toBe(true);
    // 읽기 전용 상태 보고 (운영 검증용)
    const { englishStudyStatus } = await import("@/ingestion/study/status");
    const status = await englishStudyStatus(db, filter);
    const report = status.exams[0]!;
    expect(report.exam).toBe("2025-g2-09");
    expect(report.transcripts.map((t) => t.q)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    for (const t of report.transcripts)
      expect(t).toMatchObject({
        origin: "official",
        parserVersion: "listening-script-v2",
        sourceHost: "127.0.0.1",
        lineTimings: false,
        timingVerified: false,
      });
    expect(report.transcripts[15]!.firstLine).toBe(report.transcripts[16]!.firstLine);
    expect(report.studyMaterials.every((m) => !m.published && m.status === "generated")).toBe(true);
    expect(status.recentFailures).toEqual([]);
    // 같은 버전으로 다시 돌려도 중복 job 이 생기지 않는다
    await backfillEnglishStudy(ctx, filter);
    expect(
      await db
        .select()
        .from(s.jobs)
        .where(and(eq(s.jobs.type, "extract_listening_script"), eq(s.jobs.status, "pending"))),
    ).toHaveLength(0);
  });

  it("without an official script there are no transcripts (full-audio fallback only)", async () => {
    await seed(false);
    const { ctx } = makeContext(db);
    await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
    expect(await db.select().from(s.listeningTracks)).toHaveLength(0);
    expect(await db.select().from(s.listeningTranscripts)).toHaveLength(0);
  });

  it("reading notes: import → reviewing (not public) → approve → publish", async () => {
    await seed(false);
    const { ctx, revalidated } = makeContext(db);
    await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
    const note = {
      year: 2025,
      grade: 2 as const,
      month: 9,
      questionNumber: 31,
      origin: "ai_assisted" as const,
      questionType: "빈칸 추론",
      keyPoints: ["직접 쓴 짧은 요약"],
      grammarPoints: ["분사구문"],
      wrongChoices: [{ choice: 2, reason: "본문 내용과 반대" }],
      tags: ["빈칸"],
      sources: [],
    };
    expect(await importReadingNotes(db, [note])).toMatchObject({ created: 1 });
    expect(await importReadingNotes(db, [note])).toMatchObject({ unchanged: 1 });

    const { DrizzleExamRepository } = await import("@/lib/data/drizzle-repository");
    const repo = new DrizzleExamRepository(db);
    const key = { year: 2025, grade: 2 as const, month: 9 };
    let detail = await repo.getSubjectDetail(key, "english");
    expect(detail!.readingNotes).toEqual([]);
    expect(detail!.pendingMaterialKinds).toContain("reading_note");

    const [m] = await db.select().from(s.studyMaterials);
    expect(m!.status).toBe("reviewing");
    await reviewStudyMaterial(ctx, { id: m!.id, action: "approve", admin: "ops@example.com" });
    await reviewStudyMaterial(ctx, { id: m!.id, action: "publish", admin: "ops@example.com" });
    expect(revalidated).toContain("/exam/2025/high2/09/english");
    detail = await repo.getSubjectDetail(key, "english");
    expect(detail!.readingNotes).toEqual([
      expect.objectContaining({
        questionNumber: 31,
        questionType: "빈칸 추론",
        grammarPoints: ["분사구문"],
        origin: "ai_assisted",
      }),
    ]);
  });
});
