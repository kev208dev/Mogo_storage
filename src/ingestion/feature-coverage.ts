import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  courses,
  examCourses,
  examFiles,
  exams,
  examSubjects,
  gradeCuts,
  listeningTracks,
  questions,
  sourceArtifacts,
  vocabulary,
} from "../db/schema";
import type { Grade, Subject } from "../lib/constants";
import { gradingMode } from "../lib/grade-cut-mode";
import { megaStudyAdapter } from "./grade-cuts/adapters/megastudy";
import type { WatchExam, WatchSlot } from "./grade-cuts/core";
import { checkableHosts } from "./manual-import/url-check";
import { isHostAllowed } from "./net/url-policy";

/**
 * 시험별 기능 상태 — 파일 · 정답(채점) · 등급컷 · 영어 듣기 · 영어 단어장.
 *
 *  complete       필요한 슬롯이 모두 채워짐
 *  partial        일부만
 *  manual_review  사람이 확인해야 하는 대기 건이 있음 (검토 대기 자료, 정답표 보류)
 *  missing        없음 (자동화 가능하지만 아직 없음)
 *  blocked_policy 없음 + 정책상 자동 수집 불가 (수동 입력만 가능)
 *  not_applicable 해당 없음 (예: 절대평가 과목만 있는 등급컷, 영어가 없는 시험)
 *
 * 쿼리는 시험 목록 1회 + 테이블별 group by 1회씩 (시험 수와 무관, N+1 없음).
 */

export const FEATURES = ["files", "answers", "grade_cuts", "listening", "vocabulary"] as const;
export type Feature = (typeof FEATURES)[number];
export const FEATURE_STATUSES = [
  "complete",
  "partial",
  "manual_review",
  "missing",
  "blocked_policy",
  "not_applicable",
] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export const FEATURE_LABELS: Record<Feature, string> = {
  files: "시험지·해설",
  answers: "정답·채점",
  grade_cuts: "등급컷",
  listening: "영어 듣기",
  vocabulary: "영어 단어장",
};
export const STATUS_LABELS: Record<FeatureStatus, string> = {
  complete: "완료",
  partial: "일부",
  manual_review: "검토 대기",
  missing: "없음",
  blocked_policy: "정책상 수동",
  not_applicable: "해당 없음",
};

export interface ExamFeatureRow {
  examId: string;
  year: number;
  grade: number;
  month: number;
  examType: string;
  features: Record<Feature, { status: FeatureStatus; detail: string }>;
}

export interface FeatureCoverage {
  total: number;
  rows: ExamFeatureRow[];
  summary: Record<Feature, Record<FeatureStatus, number>>;
}

interface Slot {
  subject: Subject;
  courseId: string | null;
  courseCode: string | null;
}

const key = (subject: string, courseId: string | null) => `${subject}:${courseId ?? ""}`;

function ratio(done: number, total: number): FeatureStatus {
  if (total === 0) return "not_applicable";
  if (done === 0) return "missing";
  return done >= total ? "complete" : "partial";
}

/** 정답표 보류 상태 (answer_key_extractions 가 아직 없으면 빈 결과) */
async function answerKeyHolds(db: Database, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  try {
    const rows = (await db.execute(sql`
      select exam_id, count(*)::int as n from answer_key_extractions
      where status = 'manual_review' and exam_id in ${ids}
      group by exam_id`)) as unknown as Array<{ exam_id: string; n: number }>;
    return new Map(rows.map((r) => [r.exam_id, r.n]));
  } catch {
    return new Map();
  }
}

export async function computeFeatureCoverage(
  db: Database,
  filter: {
    year?: number;
    grade?: Grade;
    includeSample?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): Promise<FeatureCoverage> {
  const conditions: SQL[] = [];
  if (filter.year) conditions.push(eq(exams.year, filter.year));
  if (filter.grade) conditions.push(eq(exams.grade, filter.grade));
  if (!filter.includeSample) conditions.push(eq(exams.isSample, false));
  const where = conditions.length ? and(...conditions) : undefined;

  const [[{ total } = { total: 0 }], examRows] = await Promise.all([
    db.select({ total: count() }).from(exams).where(where),
    db
      .select()
      .from(exams)
      .where(where)
      .orderBy(desc(exams.year), asc(exams.grade), asc(exams.month))
      .limit(filter.limit ?? 10_000)
      .offset(filter.offset ?? 0),
  ]);
  const ids = examRows.map((e) => e.id);
  const empty = () =>
    Object.fromEntries(
      FEATURES.map((f) => [f, Object.fromEntries(FEATURE_STATUSES.map((s) => [s, 0]))]),
    ) as FeatureCoverage["summary"];
  if (!ids.length) return { total, rows: [], summary: empty() };

  const [
    subjectRows,
    lineupRows,
    fileRows,
    questionRows,
    cutRows,
    trackRows,
    vocabRows,
    pendingRows,
    holds,
  ] = await Promise.all([
    db
      .select({ examId: examSubjects.examId, subject: examSubjects.subject })
      .from(examSubjects)
      .where(inArray(examSubjects.examId, ids)),
    db
      .select({
        examId: examCourses.examId,
        courseId: examCourses.courseId,
        code: courses.code,
        subject: courses.subject,
      })
      .from(examCourses)
      .innerJoin(courses, eq(courses.id, examCourses.courseId))
      .where(inArray(examCourses.examId, ids)),
    db
      .select({
        examId: examFiles.examId,
        subject: examFiles.subject,
        courseId: examFiles.courseId,
        code: courses.code,
        type: examFiles.type,
        url: examFiles.externalUrl,
      })
      .from(examFiles)
      .leftJoin(courses, eq(courses.id, examFiles.courseId))
      .where(inArray(examFiles.examId, ids)),
    db
      .select({
        examId: questions.examId,
        subject: questions.subject,
        courseId: questions.courseId,
        n: count(),
      })
      .from(questions)
      .where(inArray(questions.examId, ids))
      .groupBy(questions.examId, questions.subject, questions.courseId),
    db
      .select({
        examId: gradeCuts.examId,
        subject: gradeCuts.subject,
        courseId: gradeCuts.courseId,
        n: count(),
      })
      .from(gradeCuts)
      .where(inArray(gradeCuts.examId, ids))
      .groupBy(gradeCuts.examId, gradeCuts.subject, gradeCuts.courseId),
    db
      .select({ examId: listeningTracks.examId, n: count() })
      .from(listeningTracks)
      .where(inArray(listeningTracks.examId, ids))
      .groupBy(listeningTracks.examId),
    db
      .select({ examId: vocabulary.examId, n: count() })
      .from(vocabulary)
      .where(inArray(vocabulary.examId, ids))
      .groupBy(vocabulary.examId),
    db
      .select({ examId: sourceArtifacts.examId, n: count() })
      .from(sourceArtifacts)
      .where(
        and(
          inArray(sourceArtifacts.examId, ids),
          inArray(sourceArtifacts.status, [
            "manual_review",
            "verifying",
            "discovered",
            "changed",
            "ready",
          ]),
        ),
      )
      .groupBy(sourceArtifacts.examId),
    answerKeyHolds(db, ids),
  ]);

  const group = <T extends { examId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (r.examId) m.set(r.examId, [...(m.get(r.examId) ?? []), r]);
    return m;
  };
  const subjectsBy = group(subjectRows);
  const lineupBy = group(lineupRows);
  const filesBy = group(fileRows);
  const questionsBy = group(questionRows);
  const cutsBy = group(cutRows);
  const tracks = new Map(trackRows.map((r) => [r.examId, r.n]));
  const vocab = new Map(vocabRows.map((r) => [r.examId, r.n]));
  const pending = new Map(pendingRows.map((r) => [r.examId!, r.n]));
  const fetchHosts = checkableHosts();

  const summary = empty();
  const rows: ExamFeatureRow[] = examRows.map((exam) => {
    const files = filesBy.get(exam.id) ?? [];
    // 슬롯: 세부과목이 있으면 세부과목, 없으면 영역 전체 (자료·명단 기준)
    const slotMap = new Map<string, Slot>();
    const withCourses = new Set<string>();
    for (const l of lineupBy.get(exam.id) ?? []) withCourses.add(l.subject);
    for (const f of files) if (f.courseId) withCourses.add(f.subject);
    for (const s of subjectsBy.get(exam.id) ?? [])
      if (!withCourses.has(s.subject))
        slotMap.set(key(s.subject, null), { subject: s.subject, courseId: null, courseCode: null });
    for (const l of lineupBy.get(exam.id) ?? [])
      slotMap.set(key(l.subject, l.courseId), {
        subject: l.subject,
        courseId: l.courseId,
        courseCode: l.code,
      });
    for (const f of files)
      if (f.courseId || !withCourses.has(f.subject))
        slotMap.set(key(f.subject, f.courseId), {
          subject: f.subject,
          courseId: f.courseId,
          courseCode: f.code,
        });
    const slots = [...slotMap.values()];

    // 파일: 슬롯마다 문제지 + 정답·해설
    const has = (s: Slot, type: string) =>
      files.some((f) => f.subject === s.subject && f.courseId === s.courseId && f.type === type);
    const fileDone = slots.filter((s) => has(s, "question") && has(s, "solution")).length;
    let filesStatus = ratio(fileDone, slots.length);
    const waiting = pending.get(exam.id) ?? 0;
    if (filesStatus !== "complete" && waiting) filesStatus = "manual_review";

    // 정답: 해설 파일이 있는 슬롯 중 문항이 게시된 슬롯
    const qs = questionsBy.get(exam.id) ?? [];
    const answerSlots = slots.filter((s) => has(s, "solution"));
    const answered = answerSlots.filter((s) =>
      qs.some((q) => q.subject === s.subject && q.courseId === s.courseId && q.n > 0),
    ).length;
    let answersStatus = ratio(answered, answerSlots.length);
    const fetchable = files.some(
      (f) => f.type === "solution" && f.url && isHostAllowed(new URL(f.url).hostname, fetchHosts),
    );
    if (answersStatus !== "complete" && (holds.get(exam.id) ?? 0) > 0)
      answersStatus = "manual_review";
    else if (answersStatus === "missing" && answerSlots.length && !fetchable)
      answersStatus = "blocked_policy";

    // 등급컷: 상대평가 슬롯마다 1개 이상
    const regime = {
      year: exam.year,
      grade: exam.grade,
      examType: exam.examType,
      academicYear: exam.academicYear,
    };
    const relative = slots.filter((s) => gradingMode(regime, s.subject) === "relative");
    const cuts = cutsBy.get(exam.id) ?? [];
    const cutDone = relative.filter((s) =>
      cuts.some((c) => c.subject === s.subject && c.courseId === s.courseId),
    ).length;
    let cutStatus = ratio(cutDone, relative.length);
    if (cutStatus === "missing" && exam.examDate) {
      const watchExam: WatchExam = {
        id: exam.id,
        year: exam.year,
        grade: exam.grade as 1 | 2 | 3,
        month: exam.month,
        examType: exam.examType,
        academicYear: exam.academicYear,
        examDate: exam.examDate,
      };
      const auto = relative.some((s) =>
        megaStudyAdapter.supports?.(watchExam, {
          examId: exam.id,
          subject: s.subject,
          courseId: s.courseId,
          courseCode: s.courseCode,
          status: "waiting",
          lastPolledAt: null,
        } satisfies WatchSlot),
      );
      if (!auto) cutStatus = "blocked_policy";
    }

    // 영어 듣기 · 단어장
    const english = slots.some((s) => s.subject === "english");
    const audio = files.some((f) => f.subject === "english" && f.type === "listening_audio");
    const listeningStatus: FeatureStatus = !english
      ? "not_applicable"
      : (tracks.get(exam.id) ?? 0) > 0 && audio
        ? "complete"
        : audio
          ? "partial"
          : "missing";
    const vocabStatus: FeatureStatus = !english
      ? "not_applicable"
      : (vocab.get(exam.id) ?? 0) > 0
        ? "complete"
        : "missing";

    const features: ExamFeatureRow["features"] = {
      files: {
        status: filesStatus,
        detail: `${fileDone}/${slots.length} 슬롯${waiting ? ` · 검토 대기 ${waiting}` : ""}`,
      },
      answers: {
        status: answersStatus,
        detail: `${answered}/${answerSlots.length} 슬롯${holds.get(exam.id) ? ` · 정답표 보류 ${holds.get(exam.id)}` : ""}`,
      },
      grade_cuts: { status: cutStatus, detail: `${cutDone}/${relative.length} 상대평가 슬롯` },
      listening: {
        status: listeningStatus,
        detail: english
          ? `음원 ${audio ? "있음" : "없음"} · 구간 ${tracks.get(exam.id) ?? 0}`
          : "-",
      },
      vocabulary: { status: vocabStatus, detail: english ? `${vocab.get(exam.id) ?? 0}단어` : "-" },
    };
    for (const f of FEATURES) summary[f][features[f].status]++;
    return {
      examId: exam.id,
      year: exam.year,
      grade: exam.grade,
      month: exam.month,
      examType: exam.examType,
      features,
    };
  });
  return { total, rows, summary };
}

const SYMBOL: Record<FeatureStatus, string> = {
  complete: "●",
  partial: "◐",
  manual_review: "?",
  missing: "○",
  blocked_policy: "✕",
  not_applicable: "·",
};

export function formatFeatureCoverage(c: FeatureCoverage): string {
  const lines = [
    `시험 ${c.rows.length}/${c.total}   ● 완료  ◐ 일부  ? 검토 대기  ○ 없음  ✕ 정책상 수동  · 해당 없음`,
    `${"시험".padEnd(16)} ${FEATURES.map((f) => FEATURE_LABELS[f].padEnd(8)).join(" ")}`,
  ];
  for (const r of c.rows)
    lines.push(
      `${`${r.year} 고${r.grade} ${String(r.month).padStart(2)}월`.padEnd(16)} ${FEATURES.map((f) =>
        `${SYMBOL[r.features[f].status]} ${r.features[f].detail}`.slice(0, 22).padEnd(22),
      ).join(" ")}`,
    );
  lines.push("", "기능별 합계:");
  for (const f of FEATURES)
    lines.push(
      `  ${FEATURE_LABELS[f].padEnd(8)} ${FEATURE_STATUSES.filter((s) => c.summary[f][s])
        .map((s) => `${STATUS_LABELS[s]} ${c.summary[f][s]}`)
        .join(" · ")}`,
    );
  return lines.join("\n");
}
