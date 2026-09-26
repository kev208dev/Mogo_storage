import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { courses, examFiles, exams, reviewMappingRules, sourceArtifacts } from "@/db/schema";
import type { Subject } from "@/lib/constants";
import type { IngestionContext } from "../context";
import {
  GRADE_DEPENDENT_CODES,
  isAmbiguousVariant,
  parseEbsiFileUrl,
  WHOLE_SUBJECT_CODES,
} from "./ebsi-file";
import { upsertReviewNote } from "./evidence";
import { OPERATOR_IMPORT_SOURCE_ID } from "./source";

type Tx = Pick<Database, "select" | "insert" | "update" | "delete">;

export interface PendingItem {
  artifact: typeof sourceArtifacts.$inferSelect;
  exam: typeof exams.$inferSelect;
}

export interface LinkedArtifact {
  artifactId: string;
  examLabel: string;
  subject: Subject;
  type: string;
  slotKey: string;
  status: string;
  sourceUrl: string;
}

export interface ReviewInsight {
  /** 같은 URL 이 다른 슬롯·시험에 연결됨 (같은 파일을 두 곳에 올리면 안 된다) */
  sameUrl: LinkedArtifact[];
  /** 같은 슬롯에 이미 게시된 파일 */
  publishedInSlot: { url: string | null; sameUrl: boolean } | null;
  /** 같은 시험·과목·세부과목의 짝(문제↔정답 및 해설) */
  pairs: LinkedArtifact[];
}

const examLabel = (e: { year: number; grade: number; month: number }) =>
  `${e.year} 고${e.grade} ${e.month}월`;

const PAIR: Record<string, string> = { question: "solution", solution: "question" };

/** 검토 대기 목록의 충돌·짝 정보 (한 번에 조회 — N+1 없음) */
export async function reviewInsights(
  db: Database,
  items: PendingItem[],
): Promise<Map<string, ReviewInsight>> {
  const out = new Map<string, ReviewInsight>();
  if (items.length === 0) return out;
  const urls = [...new Set(items.map((i) => i.artifact.sourceUrl))];
  const examIds = [...new Set(items.map((i) => i.artifact.examId))];

  const [byUrl, inExams, files] = await Promise.all([
    db
      .select({ a: sourceArtifacts, e: exams })
      .from(sourceArtifacts)
      .innerJoin(exams, eq(exams.id, sourceArtifacts.examId))
      .where(inArray(sourceArtifacts.sourceUrl, urls)),
    db.select().from(sourceArtifacts).where(inArray(sourceArtifacts.examId, examIds)),
    db.select().from(examFiles).where(inArray(examFiles.examId, examIds)),
  ]);
  const examById = new Map(items.map((i) => [i.exam.id, i.exam]));
  const link = (
    a: typeof sourceArtifacts.$inferSelect,
    e: { year: number; grade: number; month: number },
  ) => ({
    artifactId: a.id,
    examLabel: examLabel(e),
    subject: a.subject,
    type: a.type,
    slotKey: a.slotKey,
    status: a.status,
    sourceUrl: a.sourceUrl,
  });

  for (const { artifact: a } of items) {
    const sameUrl = byUrl
      .filter(({ a: o }) => o.sourceUrl === a.sourceUrl && o.id !== a.id)
      .map(({ a: o, e }) => link(o, e));
    const file = files.find(
      (f) =>
        f.examId === a.examId &&
        f.subject === a.subject &&
        (f.courseId ?? null) === (a.courseId ?? null) &&
        f.type === a.type,
    );
    const pairType = PAIR[a.type];
    const pairs = pairType
      ? inExams
          .filter(
            (o) =>
              o.examId === a.examId &&
              o.subject === a.subject &&
              (o.courseId ?? null) === (a.courseId ?? null) &&
              o.type === pairType &&
              o.status !== "failed",
          )
          .map((o) => link(o, examById.get(o.examId)!))
      : [];
    out.set(a.id, {
      sameUrl,
      publishedInSlot: file
        ? { url: file.externalUrl, sameUrl: file.externalUrl === a.sourceUrl }
        : null,
      pairs,
    });
  }
  return out;
}

/**
 * 확정적인 경우만 자동 정리: 같은 슬롯에 같은 공식 URL 이 이미 게시돼 있으면 검토 대기 건은 중복이다.
 * (다른 URL 이 게시돼 있거나 다른 슬롯에 같은 URL 이 있는 경우는 사람이 판단 — 건드리지 않는다)
 */
export async function resolveDuplicatePendingImports(
  ctx: IngestionContext,
  admin: string,
): Promise<{ resolved: number }> {
  const now = ctx.now();
  const pending = await ctx.db
    .select()
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.sourceId, OPERATOR_IMPORT_SOURCE_ID),
        eq(sourceArtifacts.status, "manual_review"),
      ),
    );
  if (pending.length === 0) return { resolved: 0 };
  const files = await ctx.db
    .select()
    .from(examFiles)
    .where(inArray(examFiles.examId, [...new Set(pending.map((p) => p.examId))]));
  let resolved = 0;
  for (const a of pending) {
    const dup = files.find(
      (f) =>
        f.examId === a.examId &&
        f.subject === a.subject &&
        (f.courseId ?? null) === (a.courseId ?? null) &&
        f.type === a.type &&
        f.externalUrl === a.sourceUrl,
    );
    if (!dup) continue;
    const rows = await ctx.db
      .update(sourceArtifacts)
      .set({
        status: "failed",
        statusReason: `duplicate: 같은 슬롯에 같은 공식 URL 이 이미 게시됨 (resolved by ${admin})`,
        updatedAt: now,
      })
      .where(and(eq(sourceArtifacts.id, a.id), eq(sourceArtifacts.status, "manual_review")))
      .returning({ id: sourceArtifacts.id });
    if (rows.length === 0) continue;
    resolved += 1;
    try {
      await upsertReviewNote(ctx.db, {
        artifactId: a.id,
        reasonCode: "duplicate_file",
        reason: "같은 슬롯에 같은 공식 URL 이 이미 게시됨 — 자동 정리",
        evidence: [],
        updatedBy: admin,
        now,
      });
    } catch {
      // 근거 테이블이 없으면(migration 전) 상태 변경만 한다
    }
  }
  return { resolved };
}

// ── 승인 매핑 규칙 ─────────────────────────────────────────

export interface MappingRule {
  pattern: string;
  gradeScope: string;
  subject: Subject;
  courseCode: string | null;
  approvals: number;
}

const COURSE_AREAS: Subject[] = ["social", "science", "vocational", "second_language", "history"];

/** 이 승인이 규칙으로 쓸 만한가 (EBSi 파일 코드 → 영역/세부과목) */
export function ruleKeyFor(
  url: string,
  exam: { grade: number; month: number },
): { pattern: string; gradeScope: string } | null {
  const f = parseEbsiFileUrl(url);
  if (!f || f.kind === "unknown" || !f.code) return null;
  if (f.code in WHOLE_SUBJECT_CODES || isAmbiguousVariant(f.code)) return null;
  if (GRADE_DEPENDENT_CODES.has(f.code)) {
    // 고2·3 의 sat/gat 는 파일마다 다른 선택과목, 고1 3월은 중학 과정 탐구 — 코드만으로 정할 수 없다
    if (exam.grade !== 1 || exam.month === 3) return null;
    return { pattern: f.code, gradeScope: `go${exam.grade}` };
  }
  return { pattern: f.code, gradeScope: "" };
}

/**
 * 관리자 승인 시 규칙 기록. 같은 코드가 다른 과목으로 승인된 적이 있으면 규칙을 지운다 (확정적인 것만 남긴다).
 * 규칙 테이블이 없으면(migration 전) 건너뛴다 — 승인 자체에는 영향이 없다.
 */
export async function recordApprovalRule(
  tx: Tx,
  input: {
    artifact: typeof sourceArtifacts.$inferSelect;
    exam: { grade: number; month: number };
    admin: string;
    now: Date;
  },
): Promise<void> {
  const { artifact: a } = input;
  if (!COURSE_AREAS.includes(a.subject)) return;
  if (a.subject !== "history" && !a.courseId) return;
  const key = ruleKeyFor(a.sourceUrl, input.exam);
  if (!key) return;
  const where = and(
    eq(reviewMappingRules.sourceId, a.sourceId),
    eq(reviewMappingRules.kind, "ebsi_file_code"),
    eq(reviewMappingRules.pattern, key.pattern),
    eq(reviewMappingRules.gradeScope, key.gradeScope),
  );
  const [existing] = await tx.select().from(reviewMappingRules).where(where);
  if (!existing) {
    await tx
      .insert(reviewMappingRules)
      .values({
        sourceId: a.sourceId,
        kind: "ebsi_file_code",
        pattern: key.pattern,
        gradeScope: key.gradeScope,
        subject: a.subject,
        courseId: a.courseId,
        createdBy: input.admin,
        updatedAt: input.now,
      })
      .onConflictDoNothing();
    return;
  }
  if (existing.subject === a.subject && (existing.courseId ?? null) === (a.courseId ?? null)) {
    await tx
      .update(reviewMappingRules)
      .set({ approvals: sql`${reviewMappingRules.approvals} + 1`, updatedAt: input.now })
      .where(eq(reviewMappingRules.id, existing.id));
  } else {
    await tx.delete(reviewMappingRules).where(eq(reviewMappingRules.id, existing.id));
  }
}

/** 후보 분류에 쓸 규칙 (key: `${pattern}|${gradeScope}`). 테이블이 없으면 빈 Map */
export async function loadMappingRules(
  db: Database,
  sourceId = OPERATOR_IMPORT_SOURCE_ID,
): Promise<Map<string, MappingRule>> {
  try {
    const rows = await db
      .select({ r: reviewMappingRules, code: courses.code })
      .from(reviewMappingRules)
      .leftJoin(courses, eq(courses.id, reviewMappingRules.courseId))
      .where(
        and(
          eq(reviewMappingRules.sourceId, sourceId),
          eq(reviewMappingRules.kind, "ebsi_file_code"),
        ),
      );
    return new Map(
      rows.map(({ r, code }) => [
        `${r.pattern}|${r.gradeScope}`,
        {
          pattern: r.pattern,
          gradeScope: r.gradeScope,
          subject: r.subject,
          courseCode: code,
          approvals: r.approvals,
        },
      ]),
    );
  } catch {
    return new Map();
  }
}
