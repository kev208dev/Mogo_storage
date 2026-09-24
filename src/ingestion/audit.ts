import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  artifactWatchStates,
  backfillAudits,
  examFiles,
  exams,
  examSchedules,
  examSources,
  sourceArtifacts,
  sourceExams,
} from "../db/schema";
import { isHostAllowed } from "./net/url-policy";
import { computeReleaseWindow } from "./schedule/release-window";

/**
 * backfill / 운영 데이터 audit (읽기 전용, --record 일 때만 결과 기록).
 * blocking: 데이터가 틀렸을 가능성 (canary 다음 단계로 넘어가면 안 됨)
 * warning: 누락·검토 대기 등 운영자가 알아야 하는 상태 (시험 자체를 invalid 로 보지 않는다)
 */
export type AuditCode =
  | "duplicate_exam"
  | "duplicate_source_mapping"
  | "duplicate_artifact_url"
  | "invalid_url"
  | "non_https_url"
  | "unexpected_domain"
  | "invalid_mime"
  | "unresolved_course"
  | "failed_artifact"
  | "missing_question"
  | "missing_solution"
  | "missing_english_audio"
  | "file_artifact_mismatch"
  | "missing_provenance"
  | "release_passed_without_files"
  | "watch_missed";

export const BLOCKING_CODES: AuditCode[] = [
  "duplicate_exam",
  "duplicate_source_mapping",
  "duplicate_artifact_url",
  "invalid_url",
  "unexpected_domain",
  "file_artifact_mismatch",
];

export interface AuditIssue {
  code: AuditCode;
  message: string;
  examId?: string;
  artifactId?: string;
  sourceId?: string;
}

export interface AuditReport {
  scope: { sourceId: string | null; fromYear: number; toYear: number };
  counts: {
    exams: number;
    sourceExams: number;
    artifacts: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    unresolved: number;
  };
  blocking: AuditIssue[];
  warnings: AuditIssue[];
  passed: boolean;
}

const MIME_BY_TYPE: Record<string, string[]> = {
  question: ["application/pdf"],
  solution: ["application/pdf"],
  listening_script: ["application/pdf"],
  vocabulary_pdf: ["application/pdf"],
  listening_audio: ["audio/mpeg"],
};

const label = (e: { year: number; grade: number; month: number }) =>
  `${e.year} 고${e.grade} ${e.month}월`;

export async function runAudit(
  db: Database,
  input: { sourceId?: string | null; fromYear: number; toYear: number; now?: Date },
): Promise<AuditReport> {
  const now = input.now ?? new Date();
  const blocking: AuditIssue[] = [];
  const warnings: AuditIssue[] = [];
  const push = (issue: AuditIssue) =>
    (BLOCKING_CODES.includes(issue.code) ? blocking : warnings).push(issue);

  const examRows = await db
    .select()
    .from(exams)
    .where(and(gte(exams.year, input.fromYear), lte(exams.year, input.toYear)));
  const realExams = examRows.filter((e) => !e.isSample);
  const examIds = realExams.map((e) => e.id);
  const examById = new Map(realExams.map((e) => [e.id, e]));

  // 1) 같은 identity 시험 중복 (unique index 가 막지만 과거 데이터 확인)
  const identity = new Map<string, string[]>();
  for (const e of realExams) {
    const key = `${e.year}-${e.grade}-${e.month}-${e.examType}`;
    identity.set(key, [...(identity.get(key) ?? []), e.id]);
  }
  for (const [key, ids] of identity)
    if (ids.length > 1)
      push({ code: "duplicate_exam", message: `${key}: ${ids.length}개`, examId: ids[0] });

  const sourceFilter = input.sourceId ? [eq(sourceArtifacts.sourceId, input.sourceId)] : [];
  const mappings = examIds.length
    ? await db
        .select()
        .from(sourceExams)
        .where(
          and(
            inArray(sourceExams.examId, examIds),
            ...(input.sourceId ? [eq(sourceExams.sourceId, input.sourceId)] : []),
          ),
        )
    : [];
  // 2) 한 source 에서 같은 시험에 external id 가 여러 개
  const mapKey = new Map<string, number>();
  for (const m of mappings) {
    const k = `${m.sourceId}:${m.examId}`;
    mapKey.set(k, (mapKey.get(k) ?? 0) + 1);
  }
  for (const [k, n] of mapKey)
    if (n > 1) {
      const [sourceId, examId] = k.split(":");
      push({
        code: "duplicate_source_mapping",
        message: `${label(examById.get(examId!)!)}: ${sourceId} external id ${n}개`,
        examId,
        sourceId,
      });
    }

  const artifacts = examIds.length
    ? await db
        .select()
        .from(sourceArtifacts)
        .where(and(inArray(sourceArtifacts.examId, examIds), ...sourceFilter))
    : [];
  const sources = await db.select().from(examSources);
  const hostsOf = new Map(
    sources.map((s) => [
      s.id,
      s.allowedHosts.length ? s.allowedHosts : [new URL(s.baseUrl).hostname],
    ]),
  );

  // 3) 같은 시험·source 에서 같은 URL 이 서로 다른 슬롯에 (잘못된 분류 가능성)
  const urlSlots = new Map<string, Set<string>>();
  for (const a of artifacts) {
    const k = `${a.sourceId}|${a.examId}|${a.sourceUrl}`;
    const slots = urlSlots.get(k) ?? new Set();
    slots.add(`${a.subject}:${a.slotKey}:${a.type}`);
    urlSlots.set(k, slots);
  }
  for (const [k, slots] of urlSlots)
    if (slots.size > 1) {
      const [sourceId, examId] = k.split("|");
      push({
        code: "duplicate_artifact_url",
        message: `${label(examById.get(examId!)!)}: 같은 URL 이 ${[...slots].join(", ")} 에 동시에 있음`,
        examId,
        sourceId,
      });
    }

  for (const a of artifacts) {
    const exam = examById.get(a.examId)!;
    const where = `${label(exam)} ${a.subject}${a.slotKey ? `/${a.slotKey}` : ""} ${a.type}`;
    // 4) URL · 도메인
    let url: URL | null = null;
    try {
      url = new URL(a.sourceUrl);
    } catch {
      /* invalid */
    }
    if (!url || !/^https?:$/.test(url.protocol)) {
      push({ code: "invalid_url", message: `${where}: ${a.sourceUrl}`, artifactId: a.id });
      continue;
    }
    if (url.protocol !== "https:")
      push({ code: "non_https_url", message: `${where}: http URL`, artifactId: a.id });
    const allowed = hostsOf.get(a.sourceId) ?? [];
    for (const u of [url.hostname, a.finalUrl ? new URL(a.finalUrl).hostname : null]) {
      if (u && !isHostAllowed(u, allowed))
        push({
          code: "unexpected_domain",
          message: `${where}: ${u} (허용: ${allowed.join(", ")})`,
          artifactId: a.id,
          sourceId: a.sourceId,
        });
    }
    // 5) 검증된 자료의 MIME
    if (a.verifiedAt && !(MIME_BY_TYPE[a.type] ?? []).includes(a.mimeType))
      push({ code: "invalid_mime", message: `${where}: ${a.mimeType}`, artifactId: a.id });
    if (a.slotKey.startsWith("unresolved:"))
      push({
        code: "unresolved_course",
        message: `${where}: 원문 "${a.sourceLabel ?? a.courseLabel}"`,
        artifactId: a.id,
      });
    if (a.status === "failed")
      push({ code: "failed_artifact", message: `${where}: ${a.statusReason}`, artifactId: a.id });
  }

  // 6) 시험은 있는데 자료 일부가 없음 — 시험을 지우지 않고 누락으로만 표시
  const files = examIds.length
    ? await db.select().from(examFiles).where(inArray(examFiles.examId, examIds))
    : [];
  for (const exam of realExams) {
    const own = artifacts.filter((a) => a.examId === exam.id);
    const ownFiles = files.filter((f) => f.examId === exam.id);
    if (own.length === 0 && ownFiles.length === 0) continue; // 아직 자료 발견 전 (예정 시험 등)
    const subjects = new Set([...own.map((a) => a.subject), ...ownFiles.map((f) => f.subject)]);
    for (const subject of subjects) {
      const has = (type: string) =>
        own.some((a) => a.subject === subject && a.type === type) ||
        ownFiles.some((f) => f.subject === subject && f.type === type);
      if (!has("question"))
        push({ code: "missing_question", message: `${label(exam)} ${subject}`, examId: exam.id });
      if (!has("solution"))
        push({ code: "missing_solution", message: `${label(exam)} ${subject}`, examId: exam.id });
      if (subject === "english" && !has("listening_audio"))
        push({
          code: "missing_english_audio",
          message: `${label(exam)} 영어 듣기`,
          examId: exam.id,
        });
    }
  }

  // 7) 게시 파일 ↔ artifact 관계 (다른 시험/영역의 artifact 를 가리키면 잘못된 관계)
  const byArtifact = new Map(artifacts.map((a) => [a.id, a]));
  const linked = files.filter((f) => f.sourceArtifactId);
  const missingIds = linked.map((f) => f.sourceArtifactId!).filter((id) => !byArtifact.has(id));
  if (missingIds.length) {
    for (const a of await db
      .select()
      .from(sourceArtifacts)
      .where(inArray(sourceArtifacts.id, missingIds)))
      byArtifact.set(a.id, a);
  }
  for (const f of linked) {
    const a = byArtifact.get(f.sourceArtifactId!);
    if (!a) continue;
    if (
      a.examId !== f.examId ||
      a.subject !== f.subject ||
      a.type !== f.type ||
      (a.courseId ?? null) !== (f.courseId ?? null)
    )
      push({
        code: "file_artifact_mismatch",
        message: `${label(examById.get(f.examId)!)} ${f.subject} ${f.type}: 게시 파일이 다른 슬롯의 artifact 를 가리킴`,
        examId: f.examId,
        artifactId: a.id,
      });
  }
  // 8) provenance: 공식 자료로 게시됐는데 출처 표기가 없음
  for (const f of files)
    if (f.artifactOrigin === "official" && f.sourceArtifactId && !f.sourceLabel)
      push({
        code: "missing_provenance",
        message: `${label(examById.get(f.examId)!)} ${f.subject} ${f.type}: 출처 표기 없음`,
        examId: f.examId,
      });

  // 9) 공개 시간대가 지났는데 자료가 없는 시험 / 감시에서 놓친 자료
  const schedules = await db
    .select()
    .from(examSchedules)
    .where(
      and(
        gte(examSchedules.year, input.fromYear),
        lte(examSchedules.year, input.toYear),
        eq(examSchedules.isSample, false),
      ),
    );
  for (const s of schedules) {
    if (!s.examId) continue;
    const window = computeReleaseWindow(s);
    if (now > window.end && !files.some((f) => f.examId === s.examId))
      push({
        code: "release_passed_without_files",
        message: `${label(s)}: 공개 시간대(${window.end.toISOString()})가 지났지만 게시된 자료 없음`,
        examId: s.examId,
      });
  }
  if (examIds.length) {
    const missed = await db
      .select()
      .from(artifactWatchStates)
      .where(
        and(inArray(artifactWatchStates.examId, examIds), eq(artifactWatchStates.status, "missed")),
      );
    for (const m of missed)
      push({
        code: "watch_missed",
        message: `${label(examById.get(m.examId)!)} ${m.subject}${m.slotKey ? `/${m.slotKey}` : ""} ${m.type}: 감시 시간 안에 발견되지 않음`,
        examId: m.examId,
      });
  }

  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const a of artifacts) {
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    byType[a.type] = (byType[a.type] ?? 0) + 1;
  }
  return {
    scope: { sourceId: input.sourceId ?? null, fromYear: input.fromYear, toYear: input.toYear },
    counts: {
      exams: realExams.length,
      sourceExams: mappings.length,
      artifacts: artifacts.length,
      byStatus,
      byType,
      unresolved: artifacts.filter((a) => a.slotKey.startsWith("unresolved:")).length,
    },
    blocking,
    warnings,
    passed: blocking.length === 0,
  };
}

export async function recordAudit(db: Database, report: AuditReport) {
  const [row] = await db
    .insert(backfillAudits)
    .values({
      sourceId: report.scope.sourceId,
      fromYear: report.scope.fromYear,
      toYear: report.scope.toYear,
      passed: report.passed,
      blockingCount: report.blocking.length,
      warningCount: report.warnings.length,
      report: report as unknown as Record<string, unknown>,
    })
    .returning();
  return row!;
}

// ── canary backfill 단계 ─────────────────────────────────────

export type BackfillStage = "canary_1y" | "canary_3y" | "full";

/**
 * 요청 범위가 어느 단계인지. 연도는 올해 기준:
 *   canary_1y: from ≥ 올해-1 (최근 1년 + 올해)
 *   canary_3y: from ≥ 올해-3
 *   full: 그 이전
 */
export function backfillStage(fromYear: number, currentYear: number): BackfillStage {
  if (fromYear >= currentYear - 1) return "canary_1y";
  if (fromYear >= currentYear - 3) return "canary_3y";
  return "full";
}

/**
 * 단계 게이트: canary_3y 는 canary_1y 범위의 통과한 audit 이, full 은 canary_3y 범위의 통과한 audit 이 필요하다.
 * 반환값이 null 이면 진행 가능, 문자열이면 막힌 이유.
 */
export async function canaryGate(
  db: Database,
  input: { sourceId: string; fromYear: number; currentYear: number },
): Promise<string | null> {
  const stage = backfillStage(input.fromYear, input.currentYear);
  if (stage === "canary_1y") return null;
  const required = stage === "canary_3y" ? input.currentYear - 1 : input.currentYear - 3;
  const passed = await db
    .select({ id: backfillAudits.id })
    .from(backfillAudits)
    .where(
      and(
        eq(backfillAudits.sourceId, input.sourceId),
        eq(backfillAudits.passed, true),
        lte(backfillAudits.fromYear, required),
        gte(backfillAudits.toYear, input.currentYear - 1),
      ),
    )
    .limit(1);
  if (passed.length) return null;
  return `${stage} backfill 전에 ${required}년~${input.currentYear} 범위 backfill 과 audit 통과가 필요합니다 (npm run ingest:audit -- --source=${input.sourceId} --from=${required} --record)`;
}
