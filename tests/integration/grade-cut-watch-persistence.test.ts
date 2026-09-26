import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { courses, exams, gradeCutWatchStates } from "@/db/schema";
import { createGradeCutStore } from "@/ingestion/grade-cuts/persistence";
import { resetDb, setupDb, TEST_DB_URL } from "./helpers";

describe.skipIf(!TEST_DB_URL)("grade cut completion against Postgres", () => {
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

  it("marks a waiting slot with both timestamps and preserves unsupported slots", async () => {
    const [exam] = await db
      .insert(exams)
      .values({
        year: 2026,
        grade: 3,
        month: 7,
        examDate: "2026-07-08",
        academicYear: 2027,
        examType: "school_mock",
        organizer: "test",
        slug: "grade-cut-completion-test",
        isSample: true,
      })
      .returning();
    await db.insert(courses).values({ id: "grade-cut-test-course", code: "grade-cut-test-course", name: "Test course", subject: "social" });
    await db.insert(gradeCutWatchStates).values([
      { examId: exam!.id, subject: "social", slotKey: "grade-cut-test-course", courseId: "grade-cut-test-course" },
      { examId: exam!.id, subject: "korean", slotKey: "" },
    ]);
    const now = new Date("2026-07-08T09:00:00Z");
    await createGradeCutStore(db).markPolled(
      {
        examId: exam!.id,
        subject: "social",
      courseId: "grade-cut-test-course",
      courseCode: "grade-cut-test-course",
        status: "waiting",
        lastPolledAt: null,
      },
      now,
    );
    const rows = await db
      .select()
      .from(gradeCutWatchStates)
      .where(eq(gradeCutWatchStates.examId, exam!.id));
    const social = rows.find((row) => row.subject === "social")!;
    const korean = rows.find((row) => row.subject === "korean")!;
    expect(social.status).toBe("watching");
    expect(social.startedAt?.toISOString()).toBe(now.toISOString());
    expect(social.lastPolledAt?.toISOString()).toBe(now.toISOString());
    expect(korean.status).toBe("waiting");
    expect(korean.lastPolledAt).toBeNull();
  });
});
