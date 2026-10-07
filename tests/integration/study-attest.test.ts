import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { ensureOperatorImportSource } from "@/ingestion/manual-import/import";
import {
  attestOperatorArtifactForStudy,
  listStudyAttestationCandidates,
} from "@/ingestion/study/operator-attest";
import { makeContext, resetDb, setupDb, TEST_DB_URL } from "./helpers";

const run = describe.skipIf(!TEST_DB_URL);

// 가상 시험 · 가상 경로 (실제 파일 아님)
const WDOWN = "https://wdown.ebsi.co.kr/test/2099/eng_scr_TEST.pdf";

run("operator artifact study attestation", () => {
  let db: Database;
  beforeAll(async () => {
    db = await setupDb();
  });
  beforeEach(async () => {
    await resetDb(db);
    await ensureOperatorImportSource(db);
  });

  async function seed(over: Partial<typeof s.sourceArtifacts.$inferInsert> = {}) {
    const [exam] = await db
      .insert(s.exams)
      .values({
        year: 2099,
        grade: 3,
        month: 9,
        examType: "kice_mock",
        organizer: "test",
        slug: "2099-g3-09",
      })
      .returning();
    const mk = async (type: "listening_script" | "listening_audio", url: string, extra = {}) => {
      const [a] = await db
        .insert(s.sourceArtifacts)
        .values({
          examId: exam!.id,
          sourceId: "operator_import",
          subject: "english",
          type,
          sourceUrl: url,
          originalFileName: `${type}.bin`,
          mimeType: type === "listening_audio" ? "audio/mpeg" : "application/pdf",
          deliveryPolicy: "source_redirect",
          status: "ready",
          verificationMode: "url_check",
          verifiedAt: new Date("2099-09-10T00:00:00Z"),
          finalUrl: url,
          contentFingerprint: `operator:${url}`,
          ...extra,
        })
        .returning();
      await db.insert(s.examFiles).values({
        examId: exam!.id,
        subject: "english",
        type,
        deliveryType: "redirect",
        externalUrl: url,
        sourceArtifactId: a!.id,
        mimeType: a!.mimeType,
        originalFileName: a!.originalFileName,
      });
      return a!;
    };
    const audio = await mk("listening_audio", "https://wdown.ebsi.co.kr/test/2099/eng.mp3");
    const script = await mk("listening_script", WDOWN, over);
    return { exam: exam!, audio, script };
  }

  it("lists only artifacts blocked solely by the missing browser check, and attests them", async () => {
    const { script } = await seed();
    const { ctx } = makeContext(db);
    const candidates = await listStudyAttestationCandidates(db);
    expect(candidates.map((c) => c.artifact.id)).toEqual([script.id]);

    await expect(
      attestOperatorArtifactForStudy(ctx, {
        artifactId: script.id,
        admin: "ops@example.com",
        browserChecked: false,
      }),
    ).rejects.toThrow(/체크가 필요/);

    expect(
      await attestOperatorArtifactForStudy(ctx, {
        artifactId: script.id,
        admin: "ops@example.com",
        browserChecked: true,
      }),
    ).toEqual({ enqueued: "listening" });
    const [after] = await db
      .select()
      .from(s.sourceArtifacts)
      .where(eq(s.sourceArtifacts.id, script.id));
    expect(after).toMatchObject({
      verificationMode: "operator_browser",
      status: "ready",
      sourceUrl: WDOWN,
      finalUrl: WDOWN,
      statusReason: "browser-checked for English study processing by ops@example.com",
    });
    const jobs = await db.select().from(s.jobs);
    expect(jobs.map((j) => j.type)).toEqual(["extract_listening_script"]);
    expect(jobs[0]!.dedupeKey).toContain("listening-script-v2");
    // 이미 확인된 자료는 다시 받을 수 없다
    await expect(
      attestOperatorArtifactForStudy(ctx, {
        artifactId: script.id,
        admin: "ops@example.com",
        browserChecked: true,
      }),
    ).rejects.toThrow(/already_approved/);
    expect(await listStudyAttestationCandidates(db)).toEqual([]);
  });

  it.each([
    ["host outside the allowlist", { sourceUrl: "https://www.kice.re.kr/x.pdf", finalUrl: null }],
    ["redirected file", { finalUrl: "https://wdown.ebsi.co.kr/test/other.pdf" }],
    ["not ready", { status: "manual_review" as const }],
  ])("refuses %s (other safety conditions are not relaxed)", async (_, over) => {
    const { script } = await seed(over);
    const { ctx } = makeContext(db);
    expect(await listStudyAttestationCandidates(db)).toEqual([]);
    await expect(
      attestOperatorArtifactForStudy(ctx, {
        artifactId: script.id,
        admin: "ops@example.com",
        browserChecked: true,
      }),
    ).rejects.toThrow(/처리할 수 있는 자료가 아닙니다/);
    expect(await db.select().from(s.jobs)).toEqual([]);
  });
});
