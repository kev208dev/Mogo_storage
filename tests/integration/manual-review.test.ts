import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { attachEvidence, parseEvidenceFile } from "@/ingestion/manual-import/attach";
import { buildCandidates } from "@/ingestion/manual-import/candidates";
import { loadReviewNotes } from "@/ingestion/manual-import/evidence";
import {
  approveImportedArtifacts,
  importOfficialUrls,
  OPERATOR_IMPORT_SOURCE_ID,
} from "@/ingestion/manual-import/import";
import {
  loadMappingRules,
  resolveDuplicatePendingImports,
  reviewInsights,
} from "@/ingestion/manual-import/review";
import { syncBuiltinSources } from "@/ingestion/pipeline/sources";
import { makeContext, resetDb, setupDb, TEST_DB_URL } from "./helpers";

const HEADER =
  "year,grade,month,exam_type,exam_date,organizer,subject,course_code,file_type,official_url,original_file_name,source_label";
const W = "https://wdown.ebsi.co.kr/W61001/01exam";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");
const row = (course: string, type: string, url: string) =>
  `2025,3,6,kice_mock,2025-06-04,한국교육과정평가원,social,${course},${type},${url},,EBSi test`;

describe.skipIf(!TEST_DB_URL)("manual_review: 근거 · 충돌 · 짝 · 확정 중복 · 승인 규칙", () => {
  let db: Database;
  beforeAll(async () => {
    db = await setupDb();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await resetDb(db);
    await db.delete(s.officialUrlImports);
    await db.delete(s.reviewMappingRules);
    await syncBuiltinSources(db);
  });

  const pendingItems = async () =>
    db
      .select({ artifact: s.sourceArtifacts, exam: s.exams })
      .from(s.sourceArtifacts)
      .innerJoin(s.exams, eq(s.exams.id, s.sourceArtifacts.examId))
      .where(eq(s.sourceArtifacts.status, "manual_review"));

  it("근거 파일을 붙이면 사유·근거가 보이고, 상태는 그대로다", async () => {
    const url = `${W}/20250604/go3/s_samun_hsj_522O36I8.pdf`;
    await importOfficialUrls(db, {
      csv: csv(row("social-culture", "solution", url)),
      admin: "ops@example.com",
    });
    const entries = parseEvidenceFile({
      records: [
        {
          url,
          result: "held_manual_review",
          reason: "1쪽·문서 전체에 시행 연도·월·학년 표기 없음",
          browser: {
            status: 200,
            contentType: "application/pdf",
            pdfPages: 8,
            checkedAt: "2026-09-25",
          },
          evidence: { page1Header: "1•사회·문화•정답", examLineInDocument: null },
        },
        { url: `${W}/20250604/go3/not_imported_hsj_X.pdf`, result: "approved" },
      ],
    });
    expect(await attachEvidence(db, entries, "ops@example.com")).toEqual({
      attached: 1,
      unmatched: [`${W}/20250604/go3/not_imported_hsj_X.pdf`],
    });
    const [a] = await db.select().from(s.sourceArtifacts);
    const note = (await loadReviewNotes(db, [a!.id])).get(a!.id)!;
    expect(note).toMatchObject({ reasonCode: "no_exam_identity", updatedBy: "ops@example.com" });
    expect(note.evidence.map((e) => e.kind)).toEqual([
      "browser_check",
      "page1_header",
      "exam_line",
    ]);
    expect(a!.status).toBe("manual_review");
    // 다시 붙이면 덮어쓴다 (중복 행 없음)
    await attachEvidence(db, entries, "ops2@example.com");
    expect((await db.select().from(s.artifactReviewNotes)).length).toBe(1);
  });

  it("같은 URL 을 다른 슬롯에 넣으면 충돌로, 짝(문제↔해설)은 추천으로 보인다", async () => {
    const q = `${W}/20250604/go3/s_samun_mun_Q1.pdf`;
    const h = `${W}/20250604/go3/s_samun_hsj_H1.pdf`;
    await importOfficialUrls(db, {
      csv: csv(
        row("social-culture", "question", q),
        row("social-culture", "solution", h),
        // 같은 파일을 다른 과목 슬롯에도 잘못 넣음
        row("economics", "question", q),
      ),
      admin: "ops@example.com",
    });
    const items = await pendingItems();
    const insights = await reviewInsights(db, items);
    const find = (course: string, type: string) =>
      items.find((i) => i.artifact.slotKey === course && i.artifact.type === type)!.artifact.id;
    const socQ = insights.get(find("social-culture", "question"))!;
    expect(socQ.sameUrl.map((l) => l.slotKey)).toEqual(["economics"]);
    expect(socQ.pairs.map((p) => [p.type, p.slotKey])).toEqual([["solution", "social-culture"]]);
    expect(socQ.publishedInSlot).toBeNull();
    expect(insights.get(find("economics", "question"))!.pairs).toEqual([]);
  });

  it("확정적 중복만 정리: 같은 슬롯에 같은 URL 이 게시돼 있을 때", async () => {
    const { ctx } = makeContext(db);
    const h = `${W}/20250604/go3/s_samun_hsj_H1.pdf`;
    await importOfficialUrls(db, {
      csv: csv(row("social-culture", "solution", h)),
      admin: "ops@example.com",
    });
    const [a] = await db.select().from(s.sourceArtifacts);
    await approveImportedArtifacts(ctx, {
      artifactIds: [a!.id],
      admin: "ops@example.com",
      browserChecked: true,
    });
    expect(await db.select().from(s.examFiles)).toHaveLength(1);

    // 같은 슬롯 · 같은 URL 이 (다른 경로로) 다시 검토 대기에 들어온 상황
    await db
      .update(s.sourceArtifacts)
      .set({ status: "manual_review" })
      .where(eq(s.sourceArtifacts.id, a!.id));
    // 같은 슬롯 · 다른 URL 은 건드리지 않는다
    const [exam] = await db.select().from(s.exams);
    const [other] = await db
      .insert(s.sourceArtifacts)
      .values({
        ...a!,
        id: undefined,
        sourceId: "ebsi",
        sourceUrl: `${W}/20250604/go3/s_samun_hsj_OTHER.pdf`,
        status: "manual_review",
      } as typeof s.sourceArtifacts.$inferInsert)
      .returning();
    const insights = await reviewInsights(db, [
      { artifact: { ...a!, status: "manual_review" }, exam: exam! },
      { artifact: other!, exam: exam! },
    ]);
    expect(insights.get(a!.id)!.publishedInSlot).toEqual({ url: h, sameUrl: true });
    expect(insights.get(other!.id)!.publishedInSlot).toEqual({ url: h, sameUrl: false });

    expect(await resolveDuplicatePendingImports(ctx, "ops@example.com")).toEqual({ resolved: 1 });
    const [after] = await db
      .select()
      .from(s.sourceArtifacts)
      .where(eq(s.sourceArtifacts.id, a!.id));
    expect(after).toMatchObject({ status: "failed" });
    expect(after!.statusReason).toMatch(/duplicate/);
    const [kept] = await db
      .select()
      .from(s.sourceArtifacts)
      .where(eq(s.sourceArtifacts.id, other!.id));
    expect(kept!.status).toBe("manual_review");
    expect((await loadReviewNotes(db, [a!.id])).get(a!.id)!.reasonCode).toBe("duplicate_file");
  });

  it("승인하면 EBSi 코드 → 세부과목 규칙이 쌓이고, 후보 분류가 재사용하며, 모순되면 규칙을 지운다", async () => {
    const { ctx } = makeContext(db);
    await importOfficialUrls(db, {
      csv: csv(
        row("social-culture", "solution", `${W}/20250604/go3/s_samun_hsj_A1.pdf`),
        row("social-culture", "question", `${W}/20250604/go3/s_samun_mun_A2.pdf`),
        // 공통 과목은 규칙을 만들지 않는다
        `2025,3,6,kice_mock,2025-06-04,한국교육과정평가원,korean,,question,${W}/20250604/go3/kor_main_mun_K1.pdf,,EBSi test`,
      ),
      admin: "ops@example.com",
    });
    const ids = (await db.select().from(s.sourceArtifacts)).map((a) => a.id);
    await approveImportedArtifacts(ctx, {
      artifactIds: ids,
      admin: "ops@example.com",
      browserChecked: true,
    });
    let rules = await loadMappingRules(db, OPERATOR_IMPORT_SOURCE_ID);
    expect([...rules.values()]).toEqual([
      {
        pattern: "s_samun",
        gradeScope: "",
        subject: "social",
        courseCode: "social-culture",
        approvals: 2,
      },
    ]);

    // 규칙 재사용: 제목에 과목명이 없는 2024 파일도 규칙으로 확정
    const { rows } = buildCandidates(
      [
        {
          url: `${W}/20240604/go3/s_samun_mun_B1.pdf`,
          title: "2025학년도 대학수학능력시험 6월 모의평가 문제지",
          query: "q",
        },
      ],
      { rules },
    );
    expect(rows.map((r) => [r.course_code, r.evidence.at(-1)])).toEqual([
      ["social-culture", { kind: "classification", via: "approved_rule(2)", score: 90 }],
    ]);

    // 같은 코드가 다른 과목으로 승인되면 규칙은 확정적이지 않다 → 삭제
    await importOfficialUrls(db, {
      csv: csv(row("economics", "question", `${W}/20250604/go3/s_samun_mun_C9.pdf`)),
      admin: "ops@example.com",
    });
    const [eco] = await db
      .select()
      .from(s.sourceArtifacts)
      .where(
        and(
          eq(s.sourceArtifacts.slotKey, "economics"),
          eq(s.sourceArtifacts.status, "manual_review"),
        ),
      );
    await approveImportedArtifacts(ctx, {
      artifactIds: [eco!.id],
      admin: "ops@example.com",
      browserChecked: true,
    });
    rules = await loadMappingRules(db, OPERATOR_IMPORT_SOURCE_ID);
    expect(rules.size).toBe(0);
  });
});
