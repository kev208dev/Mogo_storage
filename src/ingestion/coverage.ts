import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { examFiles, exams, examSubjects, sourceArtifacts } from "../db/schema";
import {
  FILE_TYPE_LABELS,
  SUBJECT_LABELS,
  SUBJECTS,
  type FileType,
  type Grade,
  type Subject,
} from "../lib/constants";

const SLOT_TYPES: Record<Subject, FileType[]> = {
  korean: ["question", "solution"],
  math: ["question", "solution"],
  english: ["question", "solution", "listening_audio", "listening_script"],
  history: ["question", "solution"],
  social: ["question", "solution"],
  science: ["question", "solution"],
};

export type SlotState = "published" | "pending" | "failed" | "missing";

export interface CoverageReport {
  generatedAt: string;
  totals: {
    exams: number;
    slots: number;
    published: number;
    pending: number;
    failed: number;
    missing: number;
  };
  exams: Array<{
    year: number;
    grade: number;
    month: number;
    examType: string;
    isSample: boolean;
    subjects: Array<{
      subject: Subject;
      slots: Array<{
        type: FileType;
        state: SlotState;
        source: string | null;
        status: string | null;
      }>;
    }>;
  }>;
}

/** backfill 이후 누락 자료를 확인하기 위한 coverage 계산 */
export async function computeCoverage(
  db: Database,
  filter: {
    year?: number;
    grade?: Grade;
    fromYear?: number;
    toYear?: number;
    includeSample?: boolean;
  } = {},
): Promise<CoverageReport> {
  const conditions: SQL[] = [];
  if (filter.year) conditions.push(eq(exams.year, filter.year));
  if (filter.grade) conditions.push(eq(exams.grade, filter.grade));
  if (!filter.includeSample) conditions.push(eq(exams.isSample, false));
  let rows = await db
    .select()
    .from(exams)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(exams.year), asc(exams.grade), asc(exams.month));
  if (filter.fromYear) rows = rows.filter((e) => e.year >= filter.fromYear!);
  if (filter.toYear) rows = rows.filter((e) => e.year <= filter.toYear!);
  const ids = rows.map((e) => e.id);
  const [subjects, files, artifacts] = ids.length
    ? await Promise.all([
        db.select().from(examSubjects).where(inArray(examSubjects.examId, ids)),
        db.select().from(examFiles).where(inArray(examFiles.examId, ids)),
        db.select().from(sourceArtifacts).where(inArray(sourceArtifacts.examId, ids)),
      ])
    : [[], [], []];

  const report: CoverageReport = {
    generatedAt: new Date().toISOString(),
    totals: { exams: rows.length, slots: 0, published: 0, pending: 0, failed: 0, missing: 0 },
    exams: [],
  };
  for (const exam of rows) {
    const examSubjectList = SUBJECTS.filter((s) =>
      subjects.some((x) => x.examId === exam.id && x.subject === s),
    );
    report.exams.push({
      year: exam.year,
      grade: exam.grade,
      month: exam.month,
      examType: exam.examType,
      isSample: exam.isSample,
      subjects: examSubjectList.map((subject) => ({
        subject,
        slots: SLOT_TYPES[subject].map((type) => {
          const file = files.find(
            (f) => f.examId === exam.id && f.subject === subject && f.type === type,
          );
          const candidates = artifacts.filter(
            (a) => a.examId === exam.id && a.subject === subject && a.type === type,
          );
          let state: SlotState = "missing";
          if (file) state = "published";
          else if (
            candidates.some((a) =>
              ["discovered", "verifying", "changed", "manual_review", "ready"].includes(a.status),
            )
          )
            state = "pending";
          else if (candidates.length) state = "failed";
          const optional = type === "listening_script";
          if (!(optional && state === "missing")) {
            report.totals.slots += 1;
            report.totals[state] += 1;
          }
          return {
            type,
            state,
            source: file?.sourceLabel ?? candidates[0]?.sourceId ?? null,
            status: candidates.map((c) => `${c.sourceId}:${c.status}`).join(",") || null,
          };
        }),
      })),
    });
  }
  return report;
}

const MARK: Record<SlotState, string> = {
  published: "✓",
  pending: "…",
  failed: "✗!",
  missing: "✗",
};

export function formatCoverage(report: CoverageReport): string {
  const lines: string[] = [];
  let group = "";
  for (const exam of report.exams) {
    const header = `${exam.year} 고${exam.grade}`;
    if (header !== group) {
      group = header;
      lines.push("", header);
    }
    lines.push(`  ${exam.month}월${exam.isSample ? " (샘플)" : ""}`);
    if (exam.subjects.length === 0) lines.push("    (과목 정보 없음)");
    for (const s of exam.subjects) {
      const cells = s.slots
        .filter((slot) => !(slot.type === "listening_script" && slot.state === "missing"))
        .map((slot) => `${FILE_TYPE_LABELS[slot.type]} ${MARK[slot.state]}`);
      lines.push(`    ${SUBJECT_LABELS[s.subject].padEnd(4, "　")} ${cells.join("  ")}`);
    }
  }
  const t = report.totals;
  lines.push(
    "",
    `시험 ${t.exams}개 · 자료 슬롯 ${t.slots}개: 게시 ${t.published} / 처리 중 ${t.pending} / 실패 ${t.failed} / 없음 ${t.missing}`,
    "범례: ✓ 게시됨  … 검증·게시 대기  ✗! 수집 실패  ✗ 발견 안 됨",
  );
  return lines.join("\n");
}
