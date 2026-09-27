import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../../db/client";
import {
  answerKeyExtractions,
  concepts,
  courses,
  examFiles,
  exams,
  questionConcepts,
  questions,
} from "../../db/schema";
import { conceptCandidate } from "../../lib/concepts";
import type { ExamType, FileType, Subject } from "../../lib/constants";
import { examCoursePath, examPath } from "../../lib/exam-path";
import type { IngestionContext } from "../context";
import { checkableHosts } from "../manual-import/url-check";
import type { Fetcher } from "../net/fetcher";
import { isHostAllowed } from "../net/url-policy";
import {
  ANSWER_KEY_PARSER_VERSION,
  assembleAnswerKeys,
  slotStatus,
  type PaperDoc,
  type SlotAnswerKey,
  type SolutionDoc,
} from "./assemble";

/**
 * 게시된 공식 정답·해설 PDF + 문제지 → answer_key_extractions (슬롯별 검증 결과) → (선택) questions 게시.
 *
 *  - 정책상 파일 요청이 허용된 호스트(현재 EBSi 파일 서버)만 요청한다. KICE·교육청 URL 은 건너뛴다.
 *  - 샘플 시험은 다루지 않는다. 해설 본문은 저장하지 않는다 (정답·배점·해설 쪽 번호만).
 *  - 검증을 통과한 슬롯만 게시한다. 이미 있는 문항의 정답과 다르면 덮어쓰지 않고 manual_review.
 */

export interface ExtractOptions {
  year?: number;
  examId?: string;
  publish?: boolean;
  dryRun?: boolean;
  /** 같은 파서 버전으로 이미 처리한 시험·영역도 다시 받는다 */
  force?: boolean;
  /** 한 번에 처리할 시험·영역 수 (요청량 제한) */
  limit?: number;
}

export interface ExtractSummary {
  groups: number;
  skipped: number;
  fetched: number;
  verified: number;
  manualReview: number;
  published: number;
  unsupported: number;
  failures: Array<{ exam: string; subject: Subject; error: string }>;
}

export type PdfPages = (bytes: Uint8Array) => Promise<string[]>;

export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return Array.isArray(text) ? text : [text];
}

interface FileRow {
  fileId: string;
  examId: string;
  subject: Subject;
  type: FileType;
  url: string;
  courseCode: string | null;
  year: number;
  grade: number;
  month: number;
  examType: ExamType;
}

async function loadCandidateFiles(db: Database, opts: ExtractOptions): Promise<FileRow[]> {
  const rows = await db
    .select({
      fileId: examFiles.id,
      examId: examFiles.examId,
      subject: examFiles.subject,
      type: examFiles.type,
      url: examFiles.externalUrl,
      courseCode: courses.code,
      year: exams.year,
      grade: exams.grade,
      month: exams.month,
      examType: exams.examType,
    })
    .from(examFiles)
    .innerJoin(exams, eq(exams.id, examFiles.examId))
    .leftJoin(courses, eq(courses.id, examFiles.courseId))
    .where(
      and(
        eq(exams.isSample, false),
        eq(examFiles.deliveryType, "redirect"),
        eq(examFiles.artifactOrigin, "official"),
        inArray(examFiles.type, ["solution", "question"]),
        opts.year ? eq(exams.year, opts.year) : undefined,
        opts.examId ? eq(exams.id, opts.examId) : undefined,
      ),
    );
  return rows.filter((r): r is FileRow => !!r.url);
}

export async function runAnswerKeyExtraction(
  ctx: Pick<IngestionContext, "db" | "logger" | "revalidator" | "now">,
  fetcher: Fetcher,
  opts: ExtractOptions = {},
  readPages: PdfPages = pdfPages,
): Promise<ExtractSummary> {
  const summary: ExtractSummary = {
    groups: 0,
    skipped: 0,
    fetched: 0,
    verified: 0,
    manualReview: 0,
    published: 0,
    unsupported: 0,
    failures: [],
  };
  const hosts = checkableHosts();
  const files = await loadCandidateFiles(ctx.db, opts);
  const groups = new Map<string, FileRow[]>();
  for (const f of files) {
    const k = `${f.examId}|${f.subject}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }

  const done = opts.force
    ? new Set<string>()
    : new Set(
        (
          await ctx.db
            .select({ examId: answerKeyExtractions.examId, subject: answerKeyExtractions.subject })
            .from(answerKeyExtractions)
            .where(eq(answerKeyExtractions.parserVersion, ANSWER_KEY_PARSER_VERSION))
            .catch(() => [])
        ).map((r) => `${r.examId}|${r.subject}`),
      );

  const paths = new Set<string>();
  let processed = 0;
  for (const [k, group] of groups) {
    if (!group.some((f) => f.type === "solution")) continue;
    if (done.has(k)) {
      summary.skipped++;
      continue;
    }
    // 정책상 요청할 수 없는 호스트의 자료는 추출하지 않는다 (수동 입력 대상)
    const allowed = group.filter((f) => isHostAllowed(new URL(f.url).hostname, hosts));
    if (!allowed.some((f) => f.type === "solution")) {
      summary.unsupported++;
      continue;
    }
    if (opts.limit && processed >= opts.limit) break;
    processed++;
    summary.groups++;
    const first = group[0]!;
    try {
      const solutions: SolutionDoc[] = [];
      const papers: PaperDoc[] = [];
      // 같은 파일을 여러 슬롯이 가리키면(통합 문제지) 한 번만 받는다
      const cache = new Map<string, { pages: string[]; sha256: string }>();
      for (const f of allowed) {
        let doc = cache.get(f.url);
        if (!doc) {
          const res = await fetcher.fetch(f.url, {
            accept: "application/pdf",
            maxBytes: 40_000_000,
          });
          summary.fetched++;
          if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${f.type}`);
          if (new TextDecoder("latin1").decode(res.bytes.subarray(0, 5)) !== "%PDF-")
            throw new Error(`PDF 서명 없음: ${f.type}`);
          doc = {
            pages: await readPages(res.bytes),
            sha256: createHash("sha256").update(res.bytes).digest("hex"),
          };
          cache.set(f.url, doc);
        }
        const { pages } = doc;
        if (f.type === "solution")
          solutions.push({
            fileId: f.fileId,
            courseCode: f.courseCode,
            url: f.url,
            sha256: doc.sha256,
            pages,
          });
        else papers.push({ fileId: f.fileId, courseCode: f.courseCode, url: f.url, pages });
      }
      const slots = assembleAnswerKeys(
        { year: first.year, month: first.month, examType: first.examType },
        first.subject,
        solutions,
        papers,
      );
      for (const slot of slots) {
        let status: "verified" | "manual_review" | "published" = slotStatus(slot);
        if (status === "verified") summary.verified++;
        else summary.manualReview++;
        if (opts.dryRun) continue;
        const courseId = slot.courseCode
          ? ((
              await ctx.db
                .select({ id: courses.id })
                .from(courses)
                .where(eq(courses.code, slot.courseCode))
                .limit(1)
            )[0]?.id ?? null)
          : null;
        if (slot.courseCode && !courseId) {
          slot.reasons.push({ code: "unknown_course", detail: slot.courseCode });
          status = "manual_review";
        }
        if (status === "verified" && opts.publish) {
          const outcome = await publishSlot(ctx.db, first.examId, first.subject, courseId, slot);
          if (outcome.ok) {
            status = "published";
            summary.published++;
            const key = { year: first.year, grade: first.grade as 1 | 2 | 3, month: first.month };
            paths.add(examPath(key, first.subject));
            if (slot.courseCode) paths.add(examCoursePath(key, first.subject, slot.courseCode));
          } else {
            slot.reasons.push(outcome.reason);
            status = "manual_review";
          }
        }
        await saveExtraction(
          ctx.db,
          first.examId,
          first.subject,
          courseId,
          slot,
          status,
          ctx.now(),
        );
      }
      ctx.logger.info("artifact.verified", {
        kind: "answer_key",
        exam: first.examId,
        subject: first.subject,
        slots: slots.map((s) => `${s.courseCode ?? "-"}:${slotStatus(s)}`).join(","),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : String(error);
      summary.failures.push({ exam: first.examId, subject: first.subject, error: message });
      ctx.logger.warn("artifact.manual_review", {
        kind: "answer_key",
        exam: first.examId,
        subject: first.subject,
        error: message,
      });
    }
  }
  if (paths.size) await ctx.revalidator.revalidatePaths([...paths]);
  return summary;
}

async function saveExtraction(
  db: Database,
  examId: string,
  subject: Subject,
  courseId: string | null,
  slot: SlotAnswerKey,
  status: string,
  now: Date,
) {
  const values = {
    examId,
    subject,
    slotKey: courseId ?? "",
    courseId,
    status,
    answersVerified: slot.answersVerified,
    pointsVerified: slot.points !== null,
    reasons: slot.reasons,
    answers: slot.entries.map((e) => ({
      number: e.number,
      answer: e.answer,
      choice: e.choice,
      page: e.page,
      heading: e.heading,
    })),
    points: slot.points
      ? Object.fromEntries([...slot.points].map(([n, p]) => [String(n), p]))
      : null,
    crossChecked: slot.crossChecked,
    solutionFileId: slot.solutionFileId,
    questionFileId: slot.questionFileId,
    solutionUrl: slot.solutionUrl,
    solutionSha256: slot.solutionSha256,
    parserVersion: ANSWER_KEY_PARSER_VERSION,
    extractedAt: now,
    publishedAt: status === "published" ? now : null,
  };
  await db
    .insert(answerKeyExtractions)
    .values(values)
    .onConflictDoUpdate({
      target: [
        answerKeyExtractions.examId,
        answerKeyExtractions.subject,
        answerKeyExtractions.slotKey,
      ],
      set: { ...values, updatedAt: now },
    });
}

/**
 * 검증된 슬롯 → questions. 이미 있는 문항의 정답이 다르면 아무것도 쓰지 않는다 (수동 입력 보호).
 * 정답이 같으면 배점·선택지 수·해설 쪽만 채운다.
 */
async function publishSlot(
  db: Database,
  examId: string,
  subject: Subject,
  courseId: string | null,
  slot: SlotAnswerKey,
): Promise<{ ok: true } | { ok: false; reason: { code: string; detail: string } }> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(questions)
      .where(
        and(
          eq(questions.examId, examId),
          eq(questions.subject, subject),
          courseId ? eq(questions.courseId, courseId) : isNull(questions.courseId),
        ),
      )
      .for("update");
    const byNumber = new Map(existing.map((q) => [q.questionNumber, q]));
    const conflicts = slot.entries.filter((e) => {
      const q = byNumber.get(e.number);
      return q && q.answer !== e.answer;
    });
    if (conflicts.length)
      return {
        ok: false as const,
        reason: {
          code: "conflicts_existing",
          detail: `기존 문항과 정답이 다름: ${conflicts.map((c) => c.number).join(", ")}번`,
        },
      };
    for (const e of slot.entries) {
      const score = slot.points!.get(e.number)!;
      const fields = {
        answer: e.answer,
        choiceCount: e.choice ? 5 : null,
        score,
        solutionPage: e.page,
      };
      const q = byNumber.get(e.number);
      let questionId: string;
      if (q) {
        await tx.update(questions).set(fields).where(eq(questions.id, q.id));
        questionId = q.id;
      } else {
        const [row] = await tx
          .insert(questions)
          .values({ examId, subject, courseId, questionNumber: e.number, ...fields })
          .returning({ id: questions.id });
        questionId = row!.id;
      }
      await linkConcept(tx, subject, questionId, e, slot);
    }
    return { ok: true as const };
  });
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * 해설지 문항 머리말 → 개념 태그. 이미 있는 연결(관리자가 승인·거절·수정한 것 포함)은 건드리지 않는다.
 * 개념 이름도 이미 있으면 그대로 둔다 (관리자가 고친 표기 보호).
 */
async function linkConcept(
  tx: Tx,
  subject: Subject,
  questionId: string,
  entry: SlotAnswerKey["entries"][number],
  slot: SlotAnswerKey,
) {
  const candidate = conceptCandidate(entry, slot.answersVerified);
  if (!candidate) return;
  await tx
    .insert(concepts)
    .values({ subject, name: candidate.name, slug: candidate.slug })
    .onConflictDoNothing({ target: [concepts.subject, concepts.slug] });
  const [concept] = await tx
    .select({ id: concepts.id })
    .from(concepts)
    .where(and(eq(concepts.subject, subject), eq(concepts.slug, candidate.slug)))
    .limit(1);
  if (!concept) return;
  await tx
    .insert(questionConcepts)
    .values({
      questionId,
      conceptId: concept.id,
      status: candidate.status,
      source: "solution_heading",
      confidence: candidate.confidence,
      evidence: candidate.evidence,
      reviewReason: candidate.reason,
      sourceFileId: slot.solutionFileId,
      sourceUrl: slot.solutionUrl,
    })
    .onConflictDoNothing({ target: [questionConcepts.questionId, questionConcepts.conceptId] });
}
