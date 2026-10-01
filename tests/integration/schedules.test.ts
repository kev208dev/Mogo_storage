import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import {
  planSchedule,
  upsertSchedule,
  validateManualSchedule,
  type ScheduleInput,
} from "@/ingestion/schedule/schedules";
import { resetDb, setupDb, TEST_DB_URL } from "./helpers";

const run = describe.skipIf(!TEST_DB_URL);

// 테스트용 가상 일정 (2099년 — 실제 일정 아님). 근거 URL 도 형식 검사용 가상 주소
const base: ScheduleInput = {
  year: 2099,
  grade: 3,
  month: 10,
  examType: "school_mock",
  examDate: "2099-10-14",
  announcementUrl: "https://www.sen.go.kr/test/announcement",
};

describe("manual schedule validation", () => {
  it("requires an official https announcement (교육청 · 평가원 · 교육부)", () => {
    expect(validateManualSchedule(base)).toEqual([]);
    expect(validateManualSchedule({ ...base, announcementUrl: undefined })).toHaveLength(1);
    expect(
      validateManualSchedule({ ...base, announcementUrl: "https://www.megastudy.net/x" })[0],
    ).toContain("공식 도메인이 아닙니다");
    expect(
      validateManualSchedule({ ...base, announcementUrl: "http://www.sen.go.kr/x" })[0],
    ).toContain("공식 도메인이 아닙니다");
    expect(validateManualSchedule({ ...base, examDate: "2098-10-14" })[0]).toContain("year");
    expect(validateManualSchedule({ ...base, cancelled: true })[0]).toContain("cancelledReason");
  });
});

run("schedule import (verification · change · cancel · duplicates)", () => {
  let db: Database;
  beforeAll(async () => {
    db = await setupDb();
  });
  beforeEach(async () => {
    await resetDb(db);
  });

  it("creates exam + schedule with provenance, plans changes, keeps the previous date", async () => {
    expect(await planSchedule(db, base)).toEqual({ action: "create" });
    await upsertSchedule(db, base, { verifiedBy: "manual_json:2099.json" });
    const [exam] = await db.select().from(s.exams);
    expect(exam).toMatchObject({ year: 2099, grade: 3, month: 10, examDate: "2099-10-14" });
    expect(await planSchedule(db, base)).toEqual({ action: "unchanged" });

    const moved = { ...base, examDate: "2099-10-21", changeNote: "공지로 일정 변경" };
    expect(await planSchedule(db, moved)).toEqual({
      action: "update",
      changes: ["examDate 2099-10-14 → 2099-10-21"],
    });
    await upsertSchedule(db, moved, { verifiedBy: "manual_json:2099.json" });
    const [row] = await db.select().from(s.examSchedules);
    expect(row).toMatchObject({
      examDate: "2099-10-21",
      previousExamDate: "2099-10-14",
      changeNote: "공지로 일정 변경",
      verifiedBy: "manual_json:2099.json",
    });
    expect(row!.verifiedAt).not.toBeNull();
    const [updated] = await db.select().from(s.exams).where(eq(s.exams.id, exam!.id));
    expect(updated!.examDate).toBe("2099-10-21");
  });

  it("cancellation clears exams.exam_date so date-based jobs stop", async () => {
    await upsertSchedule(db, base);
    await upsertSchedule(db, { ...base, cancelled: true, cancelledReason: "공지로 취소" });
    const [row] = await db.select().from(s.examSchedules);
    expect(row).toMatchObject({ status: "cancelled", cancelledReason: "공지로 취소" });
    const [exam] = await db.select().from(s.exams);
    expect(exam!.examDate).toBeNull();
  });

  it("rejects a second exam type for the same grade/month and non-official URLs", async () => {
    await upsertSchedule(db, base);
    expect(await planSchedule(db, { ...base, examType: "kice_mock" })).toMatchObject({
      action: "conflict",
    });
    await expect(upsertSchedule(db, { ...base, examType: "kice_mock" })).rejects.toThrow(
      /다른 시험 유형/,
    );
    await expect(
      upsertSchedule(db, { ...base, announcementUrl: "https://blog.example.com/schedule" }),
    ).rejects.toThrow(/official/);
    expect(await db.select().from(s.examSchedules)).toHaveLength(1);
  });
});
