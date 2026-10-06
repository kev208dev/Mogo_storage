import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { backfillEnglishStudy } from "@/ingestion/study/backfill";
import { makeContext, resetDb, setupDb, TEST_DB_URL } from "./helpers";

const run = describe.skipIf(!TEST_DB_URL);

run("English study backfill", () => {
  let db: Database;

  beforeAll(async () => {
    db = await setupDb();
  });
  afterAll(async () => {
    await db.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await resetDb(db);
  });

  async function seed(urlHost = "wdown.ebsi.co.kr") {
    await db.insert(s.examSources).values({
      id: "operator_import",
      kind: "ebsi",
      name: "운영자 확인",
      baseUrl: "https://www.ebsi.co.kr",
      allowedHosts: ["wdown.ebsi.co.kr"],
      deliveryPolicy: "manual_review",
      enabled: false,
    });
    await db.insert(s.exams).values({
      id: "exam_backfill",
      year: 2026,
      grade: 3,
      month: 9,
      examType: "kice_mock",
      organizer: "한국교육과정평가원",
      examDate: "2026-09-02",
      slug: "2026-high3-09-test",
    });

    const base = `https://${urlHost}/W61001/01exam/20260902/go3`;
    const artifacts = [
      {
        id: "a_solution",
        type: "solution" as const,
        url: `${base}/eng_hsj.pdf`,
        mime: "application/pdf",
      },
      {
        id: "a_audio",
        type: "listening_audio" as const,
        url: `${base}/eng.mp3`,
        mime: "audio/mpeg",
      },
      {
        id: "a_script",
        type: "listening_script" as const,
        url: `${base}/eng_scr.pdf`,
        mime: "application/pdf",
      },
    ];
    for (const a of artifacts) {
      await db.insert(s.sourceArtifacts).values({
        id: a.id,
        examId: "exam_backfill",
        sourceId: "operator_import",
        subject: "english",
        type: a.type,
        sourceUrl: a.url,
        originalFileName: a.url.split("/").at(-1)!,
        mimeType: a.mime,
        deliveryPolicy: "manual_review",
        status: "ready",
        verificationMode: "operator_browser",
        contentFingerprint: `operator:${a.url}`,
        finalUrl: a.url,
        verifiedAt: new Date("2026-10-06T00:00:00Z"),
      });
      await db.insert(s.examFiles).values({
        id: `f_${a.id}`,
        examId: "exam_backfill",
        subject: "english",
        type: a.type,
        deliveryType: "redirect",
        externalUrl: a.url,
        artifactOrigin: "official",
        sourceArtifactId: a.id,
        sourceLabel: "EBSi",
        mimeType: a.mime,
        originalFileName: a.url.split("/").at(-1)!,
      });
    }
  }

  it("enqueues only extraction jobs for allowlisted direct operator files", async () => {
    await seed();
    const { ctx } = makeContext(db);
    const result = await backfillEnglishStudy(ctx, { examId: "exam_backfill" });
    expect(result).toMatchObject({
      exams: 1,
      vocabularyEligible: 1,
      listeningEligible: 1,
      vocabularyEnqueued: 1,
      listeningEnqueued: 1,
      skippedUnsafe: 0,
    });
    const jobs = await db.select().from(s.jobs);
    expect(jobs.map((j) => j.type).sort()).toEqual([
      "extract_listening_script",
      "extract_vocabulary",
    ]);
  });

  it("does not enqueue arbitrary operator URLs", async () => {
    await seed("evil.example.com");
    const { ctx } = makeContext(db);
    const result = await backfillEnglishStudy(ctx, { examId: "exam_backfill" });
    expect(result.vocabularyEnqueued).toBe(0);
    expect(result.listeningEnqueued).toBe(0);
    expect(result.skippedUnsafe).toBe(2);
    expect(await db.select().from(s.jobs)).toEqual([]);
  });

  it("dry-run reports eligibility without creating jobs", async () => {
    await seed();
    const { ctx } = makeContext(db);
    const result = await backfillEnglishStudy(ctx, {
      examId: "exam_backfill",
      dryRun: true,
    });
    expect(result).toMatchObject({ vocabularyEligible: 1, listeningEligible: 1 });
    expect(await db.select().from(s.jobs)).toEqual([]);
  });
});
