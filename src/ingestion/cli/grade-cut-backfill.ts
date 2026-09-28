import { and, eq, gte } from "drizzle-orm";
import { createDb } from "../../db/client";
import { courses, examCourses, exams, examSubjects } from "../../db/schema";
import type { GradeCutSource, Subject } from "../../lib/constants";
import { gradingMode } from "../../lib/grade-cut-mode";
import { createGradeCutStore } from "../grade-cuts/persistence";
import {
  normalizeCuts,
  type GradeCutAdapter,
  type WatchExam,
  type WatchSlot,
} from "../grade-cuts/core";
import { validateGradeCut } from "../grade-cuts/validate";
import { jongroAdapter, createJongroAdapter } from "../grade-cuts/adapters/jongro";
import { megaStudyAdapter } from "../grade-cuts/adapters/megastudy";
import { FixtureFetcher } from "../net/fixture-fetcher";

function option(name: string): string | null {
  const exact = "--" + name + "=";
  const inline = process.argv.find((arg) => arg.startsWith(exact));
  if (inline) return inline.slice(exact.length);
  const index = process.argv.indexOf("--" + name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}
const source = option("source");
const yearValue = option("year");
const fromValue = option("from");
const year = yearValue === null ? null : Number(yearValue);
const from = fromValue === null ? null : Number(fromValue);
const grade = option("grade") === null ? null : Number(option("grade"));
const month = option("month") === null ? null : Number(option("month"));
const limit = Number(option("limit") ?? "50");
const publish = process.argv.includes("--publish");
const dryRun = process.argv.includes("--dry-run");
const live = process.argv.includes("--live");

if (!source || !["jongro", "megastudy"].includes(source))
  throw new Error("--source must be jongro or megastudy");
if (year === null && from === null) throw new Error("provide exactly one of --year or --from");
if (year !== null && from !== null) throw new Error("use --year or --from, not both");
if (![year, from].every((v) => v === null || (Number.isInteger(v) && v >= 2000 && v <= 2100)))
  throw new Error("invalid --year/--from");
if (grade !== null && (!Number.isInteger(grade) || grade < 1 || grade > 3))
  throw new Error("invalid --grade");
if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12))
  throw new Error("invalid --month");
if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("invalid --limit");
if (publish === dryRun) throw new Error("choose exactly one of --dry-run or --publish");
if (publish && !process.env.INGESTION_DATABASE_URL)
  throw new Error("INGESTION_DATABASE_URL is required before publish mode starts");

const adapters: Record<string, GradeCutAdapter> = {
  jongro: jongroAdapter,
  megastudy: megaStudyAdapter,
};

function known2026ExamCandidates(): WatchExam[] {
  if ((year !== null && year !== 2026) || (from !== null && from > 2026)) return [];
  return ([1, 2, 3] as const)
    .filter((g) => grade === null || grade === g)
    .map((g) => ({
      id: "fixture-2026-09-g" + g,
      year: 2026,
      grade: g,
      month: 9,
      examDate: "2026-09-02",
      academicYear: 2026 + (4 - g),
      examType: "school_mock",
    }))
    .filter((exam) => month === null || exam.month === month);
}

function fixtureSlots(exam: WatchExam): WatchSlot[] {
  const common = (subject: Subject, courseCode: string | null): WatchSlot => ({
    examId: exam.id,
    subject,
    courseId: null,
    courseCode,
    status: "watching",
    lastPolledAt: null,
  });
  if (exam.grade === 1 || exam.grade === 2)
    return [
      common("korean", null),
      common("math", null),
      common("social", "integrated-social"),
      common("science", "integrated-science"),
    ];
  return [
    common("korean", "language-and-media"),
    common("korean", "speech-and-writing"),
    common("math", "calculus"),
    common("math", "probability-and-statistics"),
    common("social", "social-culture"),
    common("science", "physics-1"),
  ];
}

async function liveExams(): Promise<{ db: ReturnType<typeof createDb>; exams: WatchExam[] }> {
  const url = process.env.INGESTION_DATABASE_URL;
  if (!url) throw new Error("INGESTION_DATABASE_URL is required for live DB discovery");
  const db = createDb(url, 4);
  const clauses = [
    year !== null ? eq(exams.year, year) : gte(exams.year, from!),
    grade === null ? undefined : eq(exams.grade, grade as 1 | 2 | 3),
    month === null ? undefined : eq(exams.month, month),
    eq(exams.isSample, false),
  ].filter(Boolean);
  const rows = await db
    .select()
    .from(exams)
    .where(and(...(clauses as NonNullable<(typeof clauses)[number]>[])))
    .limit(limit);
  return {
    db,
    exams: rows
      .filter((row) => row.examDate)
      .map((row) => ({
        id: row.id,
        year: row.year,
        grade: row.grade as 1 | 2 | 3,
        month: row.month,
        examDate: row.examDate!,
        academicYear: row.academicYear,
        examType: row.examType,
      })),
  };
}

async function liveSlots(
  db: Awaited<ReturnType<typeof createDb>>,
  exam: WatchExam,
): Promise<WatchSlot[]> {
  const [subjects, details] = await Promise.all([
    db
      .select({ subject: examSubjects.subject })
      .from(examSubjects)
      .where(eq(examSubjects.examId, exam.id)),
    db
      .select({ courseId: examCourses.courseId, code: courses.code, subject: courses.subject })
      .from(examCourses)
      .innerJoin(courses, eq(examCourses.courseId, courses.id))
      .where(eq(examCourses.examId, exam.id)),
  ]);
  const candidates = [
    ...subjects.map((row) => ({
      subject: row.subject,
      courseId: null as string | null,
      courseCode: null as string | null,
    })),
    ...details.map((row) => ({
      subject: row.subject,
      courseId: row.courseId,
      courseCode: row.code,
    })),
  ];
  return candidates
    .filter((slot) => gradingMode(exam, slot.subject) === "relative")
    .map((slot) => ({ ...slot, examId: exam.id, status: "watching" as const, lastPolledAt: null }));
}

async function main() {
  let db: Awaited<ReturnType<typeof createDb>> | null = null;
  let examsToProcess: WatchExam[];
  if (publish) {
    const found = await liveExams();
    db = found.db;
    examsToProcess = found.exams;
  } else {
    examsToProcess = known2026ExamCandidates();
  }

  const fixtureRoutes: Record<string, string> = {};
  if (!live && !publish && (source !== "jongro" || examsToProcess.length === 0))
    throw new Error(
      "no offline fixtures match these filters; use the supported 2026 September Jongro fixture or pass --live",
    );
  if (source === "jongro" && !live && !publish) {
    for (const exam of examsToProcess) {
      fixtureRoutes[
        "https://www.jongro.co.kr/service/examResult/ex" +
          exam.examDate.replace(/-/g, "") +
          "/go" +
          exam.grade +
          "_resultCut.asp"
      ] = "tests/fixtures/grade-cuts/jongro/jongro-2026-09-g" + exam.grade + ".html";
    }
  }
  const adapter =
    source === "jongro" && Object.keys(fixtureRoutes).length > 0
      ? createJongroAdapter(new FixtureFetcher(fixtureRoutes, process.cwd()))
      : adapters[source]!;
  const store = db ? createGradeCutStore(db) : null;
  const now = new Date();
  const report: Array<Record<string, unknown>> = [];

  for (const exam of examsToProcess.slice(0, limit)) {
    const slots = db ? await liveSlots(db, exam) : fixtureSlots(exam);
    const collected = await adapter.collect(exam, slots);
    const normalized = collected.flatMap((value) => {
      try {
        return [
          {
            ...value,
            cuts: normalizeCuts(value.cuts),
            ...validateGradeCut({
              exam,
              subject: value.subject,
              source: adapter.source,
              sourceUrl: value.sourceUrl,
              cuts: value.cuts,
              observedAt: value.observedAt,
              now,
            }),
          },
        ];
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "grade_cut_backfill.rejected",
            exam: exam.id,
            subject: value.subject,
            courseCode: value.courseCode,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
        return [];
      }
    });

    let persisted = 0;
    if (publish) {
      for (const value of normalized) {
        const slot = slots.find(
          (item) => item.subject === value.subject && item.courseCode === value.courseCode,
        );
        if (!slot || !store) continue;
        if (await store.save(exam, slot, adapter.source as GradeCutSource, value)) persisted += 1;
      }
    }

    report.push({
      exam: { year: exam.year, grade: exam.grade, month: exam.month, examDate: exam.examDate },
      provider: source,
      mode: publish ? "publish" : live ? "live-dry-run" : "fixture-dry-run",
      discovered: true,
      fetched: true,
      parsed: collected.length,
      valid: normalized.length,
      persisted,
      rows: normalized.map((row) => ({
        subject: row.subject,
        courseCode: row.courseCode,
        providerStatus: row.providerStatus,
        providerLabel: row.providerLabel,
        sourceUrl: row.sourceUrl,
        cuts: row.cuts,
      })),
    });
  }

  console.log(
    JSON.stringify({ source, year: year ?? null, from, grade, month, results: report }, null, 2),
  );
  if (db) await db.$client.end({ timeout: 5 });
}

await main();
