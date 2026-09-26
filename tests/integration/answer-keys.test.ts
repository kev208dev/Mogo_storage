import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { runAnswerKeyExtraction } from "@/ingestion/answer-keys/extract";
import type { Fetcher } from "@/ingestion/net/fetcher";
import type { Subject } from "@/lib/constants";
import { makeContext, resetDb, setupDb, TEST_DB_URL } from "./helpers";

const fx = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/answer-keys/${name}.json`, import.meta.url), "utf8"),
  ) as { source: string; pages: string[] };
const FIXTURES = [
  "2025-06-g3-chemistry1-solution",
  "2025-06-g3-chemistry1-question",
  "2025-06-g3-korean-solution",
  "2025-06-g3-korean-speech-question",
].map(fx);
const byUrl = new Map(FIXTURES.map((f) => [f.source, f.pages]));
const url = (i: number) => FIXTURES[i]!.source;

/** 네트워크 없이: URL → "%PDF-" + URL, 텍스트는 fixture */
function fakeFetcher() {
  const calls: string[] = [];
  const fetcher: Fetcher = {
    async fetch(u) {
      calls.push(u);
      return {
        url: u,
        status: 200,
        contentType: "application/pdf",
        headers: new Headers(),
        bytes: new TextEncoder().encode(`%PDF-${u}`),
      };
    },
  };
  return { fetcher, calls };
}
const readPages = async (bytes: Uint8Array) =>
  byUrl.get(new TextDecoder().decode(bytes).slice(5)) ?? ["빈 문서"];

describe.skipIf(!TEST_DB_URL)("공식 정답표 추출 → 검증 → 게시", () => {
  let db: Database;
  beforeAll(async () => {
    db = await setupDb();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 5 });
  });

  let examId: string;
  beforeEach(async () => {
    await resetDb(db);
    const [exam] = await db
      .insert(s.exams)
      .values({
        year: 2025,
        grade: 3,
        month: 6,
        examDate: "2025-06-04",
        academicYear: 2026,
        examType: "kice_mock",
        organizer: "한국교육과정평가원",
        slug: "2025-3-6-answer-key-test",
        isSample: false,
      })
      .returning();
    examId = exam!.id;
    const file = (
      subject: Subject,
      type: "solution" | "question",
      courseId: string | null,
      externalUrl: string,
    ) => ({
      examId,
      subject,
      type,
      courseId,
      deliveryType: "redirect" as const,
      externalUrl,
      mimeType: "application/pdf",
      originalFileName: externalUrl.split("/").at(-1)!,
    });
    await db.insert(s.examFiles).values([
      file("science", "solution", "chemistry-1", url(0)),
      file("science", "question", "chemistry-1", url(1)),
      file("korean", "solution", null, url(2)),
      file("korean", "question", "speech-and-writing", url(3)),
      // 정책상 요청하지 않는 호스트 → 추출 대상 아님
      file("english", "solution", null, "https://www.suneung.re.kr/boardCnts/file.pdf"),
    ]);
  });

  const rows = () => db.select().from(s.answerKeyExtractions);
  const slotQuestions = (subject: Subject, courseId: string | null) =>
    db
      .select()
      .from(s.questions)
      .where(
        and(
          eq(s.questions.examId, examId),
          eq(s.questions.subject, subject),
          courseId ? eq(s.questions.courseId, courseId) : undefined,
        ),
      );

  it("검증된 슬롯만 게시하고, 배점을 확인할 수 없는 선택 과목은 manual_review", async () => {
    const { ctx, revalidated } = makeContext(db);
    const { fetcher, calls } = fakeFetcher();
    const summary = await runAnswerKeyExtraction(ctx, fetcher, { publish: true }, readPages);
    expect(summary).toMatchObject({ groups: 2, unsupported: 1, published: 3, manualReview: 1 });
    expect(calls.every((u) => u.startsWith("https://wdown.ebsi.co.kr/"))).toBe(true);

    const bySlot = Object.fromEntries((await rows()).map((r) => [`${r.subject}:${r.slotKey}`, r]));
    expect(bySlot["science:chemistry-1"]).toMatchObject({
      status: "published",
      answersVerified: true,
      pointsVerified: true,
      crossChecked: 20,
      parserVersion: "answer-key-v2",
    });
    expect(bySlot["science:chemistry-1"]!.solutionSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bySlot["korean:language-and-media"]).toMatchObject({
      status: "manual_review",
      pointsVerified: false,
    });
    expect(bySlot["korean:language-and-media"]!.reasons[0]!.code).toBe("points_missing");

    const chem = await slotQuestions("science", "chemistry-1");
    expect(chem).toHaveLength(20);
    expect(chem.reduce((a, q) => a + q.score, 0)).toBe(50);
    expect(chem.find((q) => q.questionNumber === 20)).toMatchObject({
      answer: "2",
      choiceCount: 5,
      solutionPage: 8,
      explanation: null,
    });
    const korean = await db.select().from(s.questions).where(eq(s.questions.subject, "korean"));
    expect(korean).toHaveLength(45); // 공통 34 + 화법과 작문 11
    expect(korean.reduce((a, q) => a + q.score, 0)).toBe(100);
    expect(revalidated.some((p) => p.includes("/korean"))).toBe(true);

    // 같은 파서 버전이면 다시 받지 않는다
    const again = await runAnswerKeyExtraction(ctx, fetcher, { publish: true }, readPages);
    expect(again).toMatchObject({ groups: 0, skipped: 2, fetched: 0 });
  });

  it("dry-run 은 아무것도 쓰지 않는다", async () => {
    const { ctx } = makeContext(db);
    const summary = await runAnswerKeyExtraction(
      ctx,
      fakeFetcher().fetcher,
      { publish: true, dryRun: true },
      readPages,
    );
    expect(summary).toMatchObject({ verified: 3, manualReview: 1, published: 0 });
    expect(await rows()).toEqual([]);
    expect(await db.select().from(s.questions)).toEqual([]);
  });

  it("기존 문항과 정답이 다르면 덮어쓰지 않고 manual_review", async () => {
    await db.insert(s.questions).values({
      examId,
      subject: "science",
      courseId: "chemistry-1",
      questionNumber: 1,
      answer: "3",
      score: 2,
    });
    const { ctx } = makeContext(db);
    await runAnswerKeyExtraction(ctx, fakeFetcher().fetcher, { publish: true }, readPages);
    const [chem] = await db
      .select()
      .from(s.answerKeyExtractions)
      .where(eq(s.answerKeyExtractions.slotKey, "chemistry-1"));
    expect(chem).toMatchObject({ status: "manual_review" });
    expect(chem!.reasons.map((r) => r.code)).toEqual(["conflicts_existing"]);
    const q = await slotQuestions("science", "chemistry-1");
    expect(q).toHaveLength(1);
    expect(q[0]!.answer).toBe("3");
  });

  it("샘플 시험은 다루지 않는다", async () => {
    await db.update(s.exams).set({ isSample: true }).where(eq(s.exams.id, examId));
    const { ctx } = makeContext(db);
    const { fetcher, calls } = fakeFetcher();
    const summary = await runAnswerKeyExtraction(ctx, fetcher, { publish: true }, readPages);
    expect(summary.groups).toBe(0);
    expect(calls).toEqual([]);
  });
});
