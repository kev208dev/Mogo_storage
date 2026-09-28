import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { exams, gradeCuts, gradeCutSnapshots } from "@/db/schema";
import { persistGradeCut } from "@/ingestion/grade-cuts/persistence";
import { resetDb, setupDb, TEST_DB_URL } from "./helpers";

describe.skipIf(!TEST_DB_URL)("grade-cut extended value and provenance round-trip", () => {
  let db: Database;

  beforeAll(async () => {
    db = await setupDb();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await resetDb(db);
  });

  it("stores extended raw scores, standard scores, percentiles, and provider provenance in current/history rows", async () => {
    const [exam] = await db
      .insert(exams)
      .values({
        year: 2026,
        grade: 3,
        month: 9,
        examDate: "2026-09-02",
        academicYear: 2027,
        examType: "school_mock",
        organizer: "test",
        slug: "jongro-provenance-round-trip",
        isSample: true,
      })
      .returning();
    const cuts = [
      {
        grade: 1,
        rawScore: 89,
        standardScore: 130,
        percentile: 99,
      },
      {
        grade: 2,
        rawScoreMin: 88,
        rawScoreMax: 89,
        rawScoreText: "88~89",
        standardScore: 120,
        percentile: 90,
      },
      { grade: 3, rawScore: 43.5, standardScore: 110, percentile: 80 },
    ];
    await persistGradeCut(db, {
      examId: exam!.id,
      subject: "korean",
      courseId: null,
      source: "jongro",
      sourceUrl: "https://www.jongro.co.kr/service/examResult/ex20260902/go3_resultCut.asp",
      cuts,
      observedAt: new Date("2026-09-28T00:00:00Z"),
      providerStatus: "provider_final",
      providerLabel: "종로 최종",
      observedVia: null,
      firstParty: true,
      scoreBasis: "raw",
      parserVersion: "jongro-result-cut-v1",
    });

    const [current] = await db.select().from(gradeCuts).where(eq(gradeCuts.examId, exam!.id));
    const [snapshot] = await db
      .select()
      .from(gradeCutSnapshots)
      .where(eq(gradeCutSnapshots.examId, exam!.id));

    expect(current).toMatchObject({
      source: "jongro",
      isOfficial: false,
      providerStatus: "provider_final",
      providerLabel: "종로 최종",
      observedVia: null,
      firstParty: true,
      scoreBasis: "raw",
      parserVersion: "jongro-result-cut-v1",
      cuts,
    });
    expect(snapshot).toMatchObject({
      providerStatus: "provider_final",
      providerLabel: "종로 최종",
      observedVia: null,
      firstParty: true,
      scoreBasis: "raw",
      parserVersion: "jongro-result-cut-v1",
      cuts,
    });
    expect(snapshot?.fingerprint).toContain("43.5");
    expect(snapshot?.fingerprint).toContain("88");
    expect(snapshot?.fingerprint).toContain("89");
  });
});
