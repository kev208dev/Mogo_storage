import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  examFiles,
  exams,
  listeningTracks,
  listeningTranscripts,
  questions,
  sourceArtifacts,
  vocabulary,
  vocabularyCandidates,
} from "../../db/schema";
import type { Grade } from "../../lib/constants";
import { examPath } from "../../lib/exam-path";
import type { IngestionContext } from "../context";
import { checkableHosts } from "../manual-import/url-check";
import { OPERATOR_IMPORT_SOURCE_ID } from "../manual-import/source";
import type { Fetcher } from "../net/fetcher";
import { isHostAllowed } from "../net/url-policy";
import {
  LISTENING_SCRIPT_PARSER_VERSION,
  parseListeningScript,
  validateListeningScript,
} from "../study/listening-script";
import { enqueueStudyMaterials } from "../study/materials";
import { extractVocabularyCandidates } from "../vocabulary/candidates";
import { extractPdfText } from "../vocabulary/pdf-text";

export const ENGLISH_ENRICHMENT_VERSION = "english-enrichment-v1";

export interface EnglishEnrichmentOptions {
  year?: number;
  grade?: number;
  month?: number;
  examId?: string;
  limit?: number;
  dryRun?: boolean;
  enqueueMaterials?: boolean;
}

export interface EnglishEnrichmentSummary {
  version: string;
  exams: number;
  fetched: number;
  skipped: number;
  unsupported: number;
  manualReview: number;
  vocabularyCandidates: number;
  vocabularyAutoApproved: number;
  vocabularyWritten: number;
  listeningQuestions: number;
  transcriptsWritten: number;
  materialJobsRequested: number;
  failures: Array<{ exam: string; kind: "vocabulary" | "listening_script"; error: string }>;
}

export interface EnrichmentFileRef {
  url: string;
  sourceId: string | null;
  artifactStatus: string | null;
  verificationMode: string | null;
  verifiedAt: Date | null;
  sourceUrl: string | null;
  finalUrl: string | null;
}

/**
 * 운영자 입력 자료를 자동 discovery 로 취급하지 않는다.
 * 이미 관리자가 브라우저로 검증하여 게시한 공식 파일만, 별도 배치에서 "내용 처리" 용으로 요청할 수 있다.
 * 요청 호스트는 answer-key extractor 와 동일한 좁은 allowlist 를 쓴다.
 */
export function enrichmentEligibility(
  file: EnrichmentFileRef,
  hosts = checkableHosts(),
): { ok: true } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(file.url);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (!isHostAllowed(url.hostname, hosts)) return { ok: false, reason: "host_not_allowed" };
  if (!file.sourceId) return { ok: false, reason: "missing_source_artifact" };
  if (file.artifactStatus !== "ready") return { ok: false, reason: "artifact_not_ready" };
  if (!file.verifiedAt) return { ok: false, reason: "artifact_not_verified" };

  const knownUrls = new Set([file.sourceUrl, file.finalUrl].filter((v): v is string => Boolean(v)));
  if (!knownUrls.has(file.url)) return { ok: false, reason: "published_url_not_verified" };

  if (file.sourceId === OPERATOR_IMPORT_SOURCE_ID && file.verificationMode !== "operator_browser") {
    return { ok: false, reason: "operator_browser_verification_required" };
  }
  return { ok: true };
}

interface FileRow extends EnrichmentFileRef {
  fileId: string;
  examId: string;
  type: "solution" | "listening_audio" | "listening_script";
  sourceArtifactId: string;
  sha256: string | null;
  year: number;
  grade: number;
  month: number;
}

async function loadFiles(
  db: IngestionContext["db"],
  opts: EnglishEnrichmentOptions,
): Promise<FileRow[]> {
  const rows = await db
    .select({
      fileId: examFiles.id,
      examId: examFiles.examId,
      type: examFiles.type,
      url: examFiles.externalUrl,
      sourceArtifactId: examFiles.sourceArtifactId,
      year: exams.year,
      grade: exams.grade,
      month: exams.month,
      sourceId: sourceArtifacts.sourceId,
      artifactStatus: sourceArtifacts.status,
      verificationMode: sourceArtifacts.verificationMode,
      verifiedAt: sourceArtifacts.verifiedAt,
      sourceUrl: sourceArtifacts.sourceUrl,
      finalUrl: sourceArtifacts.finalUrl,
      sha256: sourceArtifacts.sha256,
    })
    .from(examFiles)
    .innerJoin(exams, eq(exams.id, examFiles.examId))
    .leftJoin(sourceArtifacts, eq(sourceArtifacts.id, examFiles.sourceArtifactId))
    .where(
      and(
        eq(exams.isSample, false),
        eq(examFiles.subject, "english"),
        eq(examFiles.deliveryType, "redirect"),
        eq(examFiles.artifactOrigin, "official"),
        inArray(examFiles.type, ["solution", "listening_audio", "listening_script"]),
        isNull(examFiles.courseId),
        opts.year ? eq(exams.year, opts.year) : undefined,
        opts.grade ? eq(exams.grade, opts.grade) : undefined,
        opts.month ? eq(exams.month, opts.month) : undefined,
        opts.examId ? eq(exams.id, opts.examId) : undefined,
      ),
    );
  return rows.filter(
    (r): r is FileRow =>
      Boolean(
        r.url &&
          r.sourceArtifactId &&
          (r.type === "solution" ||
            r.type === "listening_audio" ||
            r.type === "listening_script"),
      ),
  );
}

async function fetchPdfText(
  fetcher: Fetcher,
  file: FileRow,
): Promise<{ text: string; sha256: string }> {
  const res = await fetcher.fetch(file.url, {
    accept: "application/pdf",
    maxBytes: 40_000_000,
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  if (new TextDecoder("latin1").decode(res.bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("PDF signature missing");
  }
  const sha256 = createHash("sha256").update(res.bytes).digest("hex");
  if (file.sha256 && file.sha256 !== sha256) {
    throw new Error("verified artifact hash changed");
  }
  return { text: await extractPdfText(res.bytes), sha256 };
}

async function persistVocabulary(
  ctx: Pick<IngestionContext, "db" | "now">,
  file: FileRow,
  text: string,
): Promise<{ candidates: number; autoApproved: number; written: number }> {
  const candidates = extractVocabularyCandidates(text);
  const now = ctx.now();
  const approved = candidates.filter((c) => c.status === "auto_approved" && c.meaning);

  for (const c of candidates) {
    await ctx.db
      .insert(vocabularyCandidates)
      .values({
        examId: file.examId,
        sourceArtifactId: file.sourceArtifactId,
        questionNumber: c.questionNumber,
        word: c.word,
        meaning: c.meaning,
        confidence: c.confidence,
        status: c.status,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  const questionRows = await ctx.db
    .select({ id: questions.id, questionNumber: questions.questionNumber })
    .from(questions)
    .where(
      and(
        eq(questions.examId, file.examId),
        eq(questions.subject, "english"),
        isNull(questions.courseId),
      ),
    );
  const questionIds = new Map(questionRows.map((q) => [q.questionNumber, q.id]));

  const inserted =
    approved.length === 0
      ? []
      : await ctx.db
          .insert(vocabulary)
          .values(
            approved.map((c) => ({
              examId: file.examId,
              questionId: questionIds.get(c.questionNumber) ?? null,
              subject: "english" as const,
              questionNumber: c.questionNumber,
              word: c.word,
              meaning: c.meaning!,
              sourceArtifactId: file.sourceArtifactId,
              provenance: "solution_extract" as const,
              createdAt: now,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: vocabulary.id });

  return {
    candidates: candidates.length,
    autoApproved: approved.length,
    written: inserted.length,
  };
}

async function persistListeningScript(
  ctx: Pick<IngestionContext, "db" | "now">,
  script: FileRow,
  audio: FileRow,
  text: string,
): Promise<{ questions: number; written: number } | { manualReview: string }> {
  const parsed = parseListeningScript(text);
  const valid = validateListeningScript(parsed);
  if (!valid.ok) return { manualReview: valid.reason };

  const now = ctx.now();
  let written = 0;
  for (const q of parsed.questions) {
    const [track] = await ctx.db
      .insert(listeningTracks)
      .values({
        examId: script.examId,
        fileId: audio.fileId,
        questionNumber: q.questionNumber,
        label: `${q.questionNumber}번`,
        startSeconds: 0,
        endSeconds: 0,
        timingVerified: false,
      })
      .onConflictDoUpdate({
        target: [listeningTracks.examId, listeningTracks.questionNumber],
        set: { fileId: audio.fileId },
      })
      .returning({ id: listeningTracks.id });
    if (!track) continue;

    const [existing] = await ctx.db
      .select({ origin: listeningTranscripts.origin })
      .from(listeningTranscripts)
      .where(eq(listeningTranscripts.trackId, track.id));
    if (existing && existing.origin !== "official" && existing.origin !== "unverified") continue;

    await ctx.db
      .insert(listeningTranscripts)
      .values({
        trackId: track.id,
        lines: q.lines,
        origin: "official",
        sourceUrl: script.url,
        sourceFileId: script.fileId,
        parserVersion: LISTENING_SCRIPT_PARSER_VERSION,
        verifiedBy: `operator-approved-cli:${LISTENING_SCRIPT_PARSER_VERSION}`,
        verifiedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: listeningTranscripts.trackId,
        set: {
          lines: q.lines,
          origin: "official",
          sourceUrl: script.url,
          sourceFileId: script.fileId,
          parserVersion: LISTENING_SCRIPT_PARSER_VERSION,
          verifiedBy: `operator-approved-cli:${LISTENING_SCRIPT_PARSER_VERSION}`,
          verifiedAt: now,
          updatedAt: now,
        },
      });
    written += 1;
  }
  return { questions: parsed.questions.length, written };
}

export async function runEnglishEnrichment(
  ctx: Pick<IngestionContext, "db" | "logger" | "revalidator" | "now">,
  fetcher: Fetcher,
  opts: EnglishEnrichmentOptions = {},
): Promise<EnglishEnrichmentSummary> {
  const summary: EnglishEnrichmentSummary = {
    version: ENGLISH_ENRICHMENT_VERSION,
    exams: 0,
    fetched: 0,
    skipped: 0,
    unsupported: 0,
    manualReview: 0,
    vocabularyCandidates: 0,
    vocabularyAutoApproved: 0,
    vocabularyWritten: 0,
    listeningQuestions: 0,
    transcriptsWritten: 0,
    materialJobsRequested: 0,
    failures: [],
  };

  const files = await loadFiles(ctx.db, opts);
  const groups = new Map<string, FileRow[]>();
  for (const file of files) groups.set(file.examId, [...(groups.get(file.examId) ?? []), file]);

  let processed = 0;
  for (const [examId, group] of groups) {
    if (opts.limit && processed >= opts.limit) break;
    processed += 1;
    summary.exams += 1;
    const first = group[0]!;
    let changed = false;

    const solution = group.find((f) => f.type === "solution");
    if (solution) {
      const eligible = enrichmentEligibility(solution);
      if (!eligible.ok) {
        summary.unsupported += 1;
        ctx.logger.info("english.enrichment_skipped", {
          examId,
          kind: "vocabulary",
          reason: eligible.reason,
        });
      } else {
        try {
          const { text } = await fetchPdfText(fetcher, solution);
          summary.fetched += 1;
          const candidates = extractVocabularyCandidates(text);
          summary.vocabularyCandidates += candidates.length;
          summary.vocabularyAutoApproved += candidates.filter(
            (c) => c.status === "auto_approved" && c.meaning,
          ).length;
          if (!opts.dryRun) {
            const result = await persistVocabulary(ctx, solution, text);
            summary.vocabularyWritten += result.written;
            changed ||= result.written > 0;
          }
        } catch (error) {
          summary.failures.push({
            exam: examId,
            kind: "vocabulary",
            error: error instanceof Error ? error.message.slice(0, 200) : String(error),
          });
        }
      }
    } else {
      summary.skipped += 1;
    }

    const script = group.find((f) => f.type === "listening_script");
    const audio = group.find((f) => f.type === "listening_audio");
    if (script && audio) {
      const scriptEligibility = enrichmentEligibility(script);
      const audioEligibility = enrichmentEligibility(audio);
      if (!scriptEligibility.ok || !audioEligibility.ok) {
        summary.unsupported += 1;
        ctx.logger.info("english.enrichment_skipped", {
          examId,
          kind: "listening_script",
          reason: !scriptEligibility.ok ? scriptEligibility.reason : audioEligibility.ok ? "" : audioEligibility.reason,
        });
      } else {
        try {
          const { text } = await fetchPdfText(fetcher, script);
          summary.fetched += 1;
          const parsed = parseListeningScript(text);
          summary.listeningQuestions += parsed.questions.length;
          const valid = validateListeningScript(parsed);
          if (!valid.ok) {
            summary.manualReview += 1;
            ctx.logger.warn("english.listening_script_manual_review", {
              examId,
              reason: valid.reason,
            });
          } else if (!opts.dryRun) {
            const result = await persistListeningScript(ctx, script, audio, text);
            if ("manualReview" in result) {
              summary.manualReview += 1;
            } else {
              summary.transcriptsWritten += result.written;
              changed ||= result.written > 0;
            }
          }
        } catch (error) {
          summary.failures.push({
            exam: examId,
            kind: "listening_script",
            error: error instanceof Error ? error.message.slice(0, 200) : String(error),
          });
        }
      }
    }

    if (!opts.dryRun && opts.enqueueMaterials) {
      await enqueueStudyMaterials(ctx, examId);
      summary.materialJobsRequested += 1;
    }
    if (!opts.dryRun && changed) {
      await ctx.revalidator.revalidatePaths([
        examPath(
          { year: first.year, grade: first.grade as Grade, month: first.month },
          "english",
        ),
      ]);
    }
  }
  return summary;
}
