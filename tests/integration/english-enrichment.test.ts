import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { runEnglishEnrichment } from "@/ingestion/english/enrichment";
import { ensureOperatorImportSource } from "@/ingestion/manual-import/import";
import type { Fetcher, FetchResult } from "@/ingestion/net/fetcher";
import {
  makeContext,
  makePdf,
  resetDb,
  setupDb,
  TEST_DB_URL,
} from "./helpers";

const run = describe.skipIf(!TEST_DB_URL);
const BASE = "https://wdown.ebsi.co.kr/W61001/01exam/20260902/go3";
const SOLUTION = `${BASE}/eng_1_hsj_TEST.pdf`;
const AUDIO = `${BASE}/eng_1_lis_TEST.mp3`;
const SCRIPT = `${BASE}/eng_1_scr_TEST.pdf`;

function fakeFetcher(files: Map<string, Uint8Array>): Fetcher {
  return {
    async fetch(url): Promise<FetchResult> {
      const bytes = files.get(url);
      if (!bytes) throw new Error(`unexpected fetch: ${url}`);
      return {
        url,
        status: 200,
        contentType: url.endsWith(".mp3") ? "audio/mpeg" : "application/pdf",
        headers: new Headers({
          "content-type": url.endsWith(".mp3") ? "audio/mpeg" : "application/pdf",
          "content-length": String(bytes.byteLength),
        }),
        bytes,
        declaredSize: bytes.byteLength,
      };
    },
  };
}

run("English enrichment for browser-approved official files", () => {
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

  async function seedApprovedEnglishFiles() {
    await ensureOperatorImportSource(db);
    await db.insert(s.exams).values({
      id: "exam_2026_h3_09",
      year: 2026,
      grade: 3,
      month: 9,
      academicYear: 2027,
      examType: "kice_mock",
      organizer: "한국교육과정평가원",
      examDate: "2026-09-02",
      slug: "2026-high3-09",
      isSample: false,
    });
    await db.insert(s.examSubjects).values({
      examId: "exam_2026_h3_09",
      subject: "english",
      questionCount: 45,
      totalScore: 100,
    });
    await db.insert(s.questions).values(
      Array.from({ length: 28 }, (_, i) => {
        const n = i + 18;
        return {
          examId: "exam_2026_h3_09",
          subject: "english" as const,
          questionNumber: n,
          answer: "1",
          choiceCount: 5,
          score: n % 2 === 0 ? 2 : 3,
          solutionPage: 1,
        };
      }),
    );

    const specs = [
      { id: "sa_solution", type: "solution" as const, url: SOLUTION, mime: "application/pdf" },
      { id: "sa_audio", type: "listening_audio" as const, url: AUDIO, mime: "audio/mpeg" },
      { id: "sa_script", type: "listening_script" as const, url: SCRIPT, mime: "application/pdf" },
    ];
    for (const spec of specs) {
      await db.insert(s.sourceArtifacts).values({
        id: spec.id,
        examId: "exam_2026_h3_09",
        sourceId: "operator_import",
        subject: "english",
        slotKey: "",
        sourceLabel: `browser approved ${spec.type}`,
        type: spec.type,
        sourceUrl: spec.url,
        finalUrl: spec.url,
        containerType: "file",
        originalFileName: spec.url.split("/").at(-1)!,
        mimeType: spec.mime,
        deliveryPolicy: "manual_review",
        verificationMode: "operator_browser",
        contentFingerprint: `operator:${spec.url}`,
        status: "ready",
        verifiedAt: new Date("2026-10-01T00:00:00Z"),
        lastCheckedAt: new Date("2026-10-01T00:00:00Z"),
      });
      await db.insert(s.examFiles).values({
        id: `ef_${spec.type}`,
        examId: "exam_2026_h3_09",
        subject: "english",
        type: spec.type,
        deliveryType: "redirect",
        externalUrl: spec.url,
        artifactOrigin: "official",
        sourceArtifactId: spec.id,
        sourceLabel: "EBSi",
        mimeType: spec.mime,
        originalFileName: spec.url.split("/").at(-1)!,
      });
    }
  }

  it("extracts vocabulary and official transcripts without guessing audio timings", async () => {
    await seedApprovedEnglishFiles();
    const solution = await makePdf([
      "18. 해설",
      "[ 어휘 · 어구 ]",
      "renovation 보수, 개조",
      "participate 참여하다",
      "19. 해설",
      "[ 어휘 · 어구 ]",
      "sustainable 지속 가능한",
    ]);
    const scriptLines: string[] = ["TEST FIXTURE — NOT A REAL EXAM"];
    for (let n = 1; n <= 12; n += 1) {
      scriptLines.push(`${n}번`);
      scriptLines.push(`M: Synthetic question ${n} opening line.`);
      scriptLines.push(`W: Synthetic reply for question ${n}.`);
    }
    const script = await makePdf(scriptLines);
    const { ctx, revalidated } = makeContext(db);

    const summary = await runEnglishEnrichment(
      ctx,
      fakeFetcher(
        new Map([
          [SOLUTION, solution],
          [SCRIPT, script],
        ]),
      ),
      { examId: "exam_2026_h3_09" },
    );

    expect(summary.failures).toEqual([]);
    expect(summary.exams).toBe(1);
    expect(summary.fetched).toBe(2);
    expect(summary.vocabularyCandidates).toBeGreaterThanOrEqual(3);
    expect(summary.vocabularyAutoApproved).toBeGreaterThanOrEqual(3);
    expect(summary.vocabularyWritten).toBeGreaterThanOrEqual(3);
    expect(summary.listeningQuestions).toBe(12);
    expect(summary.transcriptsWritten).toBe(12);

    const words = await db.select().from(s.vocabulary);
    expect(words.map((w) => w.word)).toEqual(
      expect.arrayContaining(["participate", "renovation", "sustainable"]),
    );
    expect(words.every((w) => w.provenance === "solution_extract" && w.sourceArtifactId === "sa_solution")).toBe(true);
    expect(words.every((w) => w.questionId !== null)).toBe(true);

    const tracks = await db.select().from(s.listeningTracks);
    expect(tracks).toHaveLength(12);
    expect(
      tracks.every(
        (t) =>
          t.fileId === "ef_listening_audio" &&
          !t.timingVerified &&
          t.startSeconds === 0 &&
          t.endSeconds === 0,
      ),
    ).toBe(true);

    const transcripts = await db.select().from(s.listeningTranscripts);
    expect(transcripts).toHaveLength(12);
    expect(transcripts.every((t) => t.origin === "official")).toBe(true);
    expect(transcripts.every((t) => t.parserVersion === "listening-script-v1")).toBe(true);
    expect(revalidated).toContain("/exam/2026/high3/09/english");
  });

  it("does not fetch an operator import that lacks browser approval", async () => {
    await seedApprovedEnglishFiles();
    await db
      .update(s.sourceArtifacts)
      .set({ verificationMode: "operator" })
      .where(eq(s.sourceArtifacts.id, "sa_solution"));
    let fetched = 0;
    const { ctx } = makeContext(db);
    const summary = await runEnglishEnrichment(
      ctx,
      {
        async fetch(): Promise<FetchResult> {
          fetched += 1;
          throw new Error("must not fetch");
        },
      },
      { examId: "exam_2026_h3_09" },
    );

    expect(fetched).toBe(0);
    expect(summary.unsupported).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(s.vocabulary)).toHaveLength(0);
  });
});
