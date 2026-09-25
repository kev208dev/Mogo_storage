import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  courses,
  examCourses,
  examFiles,
  exams,
  examSubjects,
  sourceArtifacts,
} from "../db/schema";
import {
  FILE_TYPE_LABELS,
  SUBJECT_LABELS,
  SUBJECTS,
  type FileType,
  type Grade,
  type Subject,
} from "../lib/constants";
import { SUBJECT_AREA_LABELS } from "../lib/courses";

const SLOT_TYPES: Record<Subject, FileType[]> = {
  korean: ["question", "solution"],
  math: ["question", "solution"],
  english: ["question", "solution", "listening_audio", "listening_script"],
  history: ["question", "solution"],
  social: ["question", "solution"],
  science: ["question", "solution"],
  vocational: ["question", "solution"],
  second_language: ["question", "solution"],
};
const COURSE_SLOT_TYPES: FileType[] = ["question", "solution"];

export type SlotState = "published" | "pending" | "failed" | "missing";

export interface CoverageSlot {
  type: FileType;
  state: SlotState;
  source: string | null;
  status: string | null;
}

export interface CoverageReport {
  generatedAt: string;
  totals: {
    exams: number;
    slots: number;
    published: number;
    pending: number;
    failed: number;
    missing: number;
    unresolved: number;
  };
  exams: Array<{
    year: number;
    grade: number;
    month: number;
    examType: string;
    isSample: boolean;
    subjects: Array<{
      subject: Subject;
      /** 세부과목 구분 없는 자료 슬롯 (세부과목이 없는 과목, 또는 영역 전체 자료) */
      slots: CoverageSlot[];
      /** 세부과목별 슬롯 (사회·문화, 물리학 I …) */
      courses: Array<{ code: string; name: string; slots: CoverageSlot[] }>;
      /** 과목을 확정하지 못한 자료 (manual_review) */
      unresolved: Array<{ label: string | null; type: FileType; source: string; status: string }>;
    }>;
  }>;
}

type FileRow = typeof examFiles.$inferSelect;
type ArtifactRow = typeof sourceArtifacts.$inferSelect;

function slotFor(files: FileRow[], artifacts: ArtifactRow[], type: FileType): CoverageSlot {
  const file = files.find((f) => f.type === type);
  const candidates = artifacts.filter((a) => a.type === type);
  let state: SlotState = "missing";
  if (file) state = "published";
  else if (
    candidates.some((a) =>
      ["discovered", "verifying", "changed", "manual_review", "ready"].includes(a.status),
    )
  ) {
    state = "pending";
  } else if (candidates.length) state = "failed";
  return {
    type,
    state,
    source: file?.sourceLabel ?? candidates[0]?.sourceId ?? null,
    status: candidates.map((c) => `${c.sourceId}:${c.status}`).join(",") || null,
  };
}

/** backfill 이후 누락 자료를 확인하기 위한 coverage 계산 (세부과목 단위) */
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
  const [subjects, files, artifacts, lineups, catalog] = ids.length
    ? await Promise.all([
        db.select().from(examSubjects).where(inArray(examSubjects.examId, ids)),
        db.select().from(examFiles).where(inArray(examFiles.examId, ids)),
        db.select().from(sourceArtifacts).where(inArray(sourceArtifacts.examId, ids)),
        db.select().from(examCourses).where(inArray(examCourses.examId, ids)),
        db.select().from(courses),
      ])
    : [[], [], [], [], []];

  const report: CoverageReport = {
    generatedAt: new Date().toISOString(),
    totals: {
      exams: rows.length,
      slots: 0,
      published: 0,
      pending: 0,
      failed: 0,
      missing: 0,
      unresolved: 0,
    },
    exams: [],
  };
  const count = (slot: CoverageSlot) => {
    if (slot.type === "listening_script" && slot.state === "missing") return; // 선택 자료
    report.totals.slots += 1;
    report.totals[slot.state] += 1;
  };

  for (const exam of rows) {
    const subjectList = SUBJECTS.filter((s) =>
      subjects.some((x) => x.examId === exam.id && x.subject === s),
    );
    report.exams.push({
      year: exam.year,
      grade: exam.grade,
      month: exam.month,
      examType: exam.examType,
      isSample: exam.isSample,
      subjects: subjectList.map((subject) => {
        const inSubject = <T extends { examId: string; subject: Subject }>(list: T[]) =>
          list.filter((x) => x.examId === exam.id && x.subject === subject);
        const subjectFiles = inSubject(files);
        const subjectArtifacts = inSubject(artifacts);
        const courseIds = new Set([
          ...lineups.filter((l) => l.examId === exam.id).map((l) => l.courseId),
          ...subjectFiles.filter((f) => f.courseId).map((f) => f.courseId!),
          ...subjectArtifacts.filter((a) => a.courseId).map((a) => a.courseId!),
        ]);
        const courseRows = catalog
          .filter((c) => courseIds.has(c.id) && c.subject === subject)
          .sort((a, b) => a.displayOrder - b.displayOrder);

        const noCourseFiles = subjectFiles.filter((f) => !f.courseId);
        const noCourseArtifacts = subjectArtifacts.filter((a) => !a.courseId && a.slotKey === "");
        const showSubjectSlots =
          courseRows.length === 0 || noCourseFiles.length > 0 || noCourseArtifacts.length > 0;
        const slots = showSubjectSlots
          ? SLOT_TYPES[subject].map((t) => slotFor(noCourseFiles, noCourseArtifacts, t))
          : [];
        slots.forEach(count);

        const courseEntries = courseRows.map((c) => {
          const courseSlots = COURSE_SLOT_TYPES.map((t) =>
            slotFor(
              subjectFiles.filter((f) => f.courseId === c.id),
              subjectArtifacts.filter((a) => a.courseId === c.id),
              t,
            ),
          );
          courseSlots.forEach(count);
          return { code: c.code, name: c.name, slots: courseSlots };
        });

        const unresolved = subjectArtifacts
          .filter((a) => a.slotKey.startsWith("unresolved:") || a.containerType === "archive")
          .map((a) => ({
            label: a.courseLabel,
            type: a.type,
            source: a.sourceId,
            status: a.status,
          }));
        report.totals.unresolved += unresolved.length;
        return { subject, slots, courses: courseEntries, unresolved };
      }),
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

function formatSlots(slots: CoverageSlot[]): string {
  return slots
    .filter((slot) => !(slot.type === "listening_script" && slot.state === "missing"))
    .map((slot) => `${FILE_TYPE_LABELS[slot.type]} ${MARK[slot.state]}`)
    .join("  ");
}

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
      const label =
        (s.courses.length ? SUBJECT_AREA_LABELS[s.subject] : null) ?? SUBJECT_LABELS[s.subject];
      if (s.courses.length === 0) {
        lines.push(`    ${label.padEnd(5, "　")} ${formatSlots(s.slots)}`);
        continue;
      }
      lines.push(`    ${label}`);
      if (s.slots.length) lines.push(`      (영역 전체)  ${formatSlots(s.slots)}`);
      for (const c of s.courses)
        lines.push(`      ${c.name.padEnd(7, "　")} ${formatSlots(c.slots)}`);
      for (const u of s.unresolved) {
        lines.push(
          `      ⚠ 과목 미확정 "${u.label ?? "?"}" ${FILE_TYPE_LABELS[u.type]} (${u.source}: ${u.status})`,
        );
      }
    }
  }
  const t = report.totals;
  lines.push(
    "",
    `시험 ${t.exams}개 · 자료 슬롯 ${t.slots}개: 게시 ${t.published} / 처리 중 ${t.pending} / 실패 ${t.failed} / 없음 ${t.missing} · 과목 미확정 ${t.unresolved}`,
    "범례: ✓ 게시됨  … 검증·게시 대기  ✗! 수집 실패  ✗ 발견 안 됨",
  );
  return lines.join("\n");
}

export interface CoverageCounts {
  exams: number;
  slots: number;
  published: number;
  pending: number;
  failed: number;
  missing: number;
}

export interface CoverageSummary {
  byYear: Record<string, CoverageCounts>;
  byGrade: Record<string, CoverageCounts>;
  byType: Record<string, CoverageCounts>;
  total: CoverageCounts;
}

const emptyCounts = (): CoverageCounts => ({
  exams: 0,
  slots: 0,
  published: 0,
  pending: 0,
  failed: 0,
  missing: 0,
});

/**
 * 연도별 · 학년별 · 자료 종류별 집계 (누락 = missing + failed).
 * 영어 대본은 선택 자료라 "없음"을 누락으로 세지 않는다 (formatCoverage 와 같은 규칙).
 */
export function summarizeCoverage(report: CoverageReport): CoverageSummary {
  const summary: CoverageSummary = { byYear: {}, byGrade: {}, byType: {}, total: emptyCounts() };
  const bucket = (map: Record<string, CoverageCounts>, key: string) => (map[key] ??= emptyCounts());
  for (const exam of report.exams) {
    const yearKey = String(exam.year);
    const gradeKey = `고${exam.grade}`;
    bucket(summary.byYear, yearKey).exams += 1;
    bucket(summary.byGrade, gradeKey).exams += 1;
    summary.total.exams += 1;
    const slots = exam.subjects.flatMap((s) => [...s.slots, ...s.courses.flatMap((c) => c.slots)]);
    for (const slot of slots) {
      if (slot.type === "listening_script" && slot.state === "missing") continue;
      for (const b of [
        bucket(summary.byYear, yearKey),
        bucket(summary.byGrade, gradeKey),
        bucket(summary.byType, slot.type),
        summary.total,
      ]) {
        b.slots += 1;
        b[slot.state] += 1;
      }
    }
  }
  return summary;
}

export function formatCoverageSummary(summary: CoverageSummary): string {
  const row = (label: string, c: CoverageCounts) =>
    `${label.padEnd(14)} 시험 ${String(c.exams).padStart(4)} · 슬롯 ${String(c.slots).padStart(5)} · 게시 ${String(c.published).padStart(5)} · 대기 ${String(c.pending).padStart(4)} · 실패 ${String(c.failed).padStart(4)} · 누락 ${String(c.missing + c.failed).padStart(5)}`;
  const lines = ["[연도별]"];
  for (const [k, c] of Object.entries(summary.byYear).sort()) lines.push(row(k, c));
  lines.push("", "[학년별]");
  for (const [k, c] of Object.entries(summary.byGrade).sort()) lines.push(row(k, c));
  lines.push("", "[자료 종류별]");
  for (const [k, c] of Object.entries(summary.byType))
    lines.push(row(FILE_TYPE_LABELS[k as FileType] ?? k, { ...c, exams: 0 }));
  lines.push("", row("합계", summary.total));
  return lines.join("\n");
}
