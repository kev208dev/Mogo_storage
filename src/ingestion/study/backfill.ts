import { and, eq, inArray, isNull } from "drizzle-orm";
import { examFiles, exams, sourceArtifacts } from "../../db/schema";
import type { IngestionContext } from "../context";
import { enqueueJob } from "../jobs/queue";
import { isCheckableFileUrl } from "../manual-import/url-check";

export interface EnglishStudyBackfillOptions {
  year?: number;
  examId?: string;
  dryRun?: boolean;
}

export interface EnglishStudyBackfillSummary {
  exams: number;
  vocabularyEligible: number;
  listeningEligible: number;
  vocabularyEnqueued: number;
  listeningEnqueued: number;
  skippedUnsafe: number;
}

type Candidate = {
  examId: string;
  year: number;
  type: string;
  sourceArtifactId: string | null;
  url: string | null;
  contentFingerprint: string | null;
  sha256: string | null;
  sourceUrl: string | null;
};

/**
 * 이미 게시된 영어 공식 파일을 새 학습 파이프라인에 연결한다.
 *
 * operator_import 여부와 무관하게 실제 내용 다운로드는 checkable file allowlist를 만족하는 파일만 대상으로 한다.
 * 생성 학습지는 별도 review 흐름을 거쳐야 하며 여기서 자동 게시하지 않는다.
 */
export async function backfillEnglishStudy(
  ctx: Pick<IngestionContext, "db" | "now">,
  options: EnglishStudyBackfillOptions = {},
): Promise<EnglishStudyBackfillSummary> {
  const rows = await ctx.db
    .select({
      examId: examFiles.examId,
      year: exams.year,
      type: examFiles.type,
      sourceArtifactId: examFiles.sourceArtifactId,
      url: examFiles.externalUrl,
      contentFingerprint: sourceArtifacts.contentFingerprint,
      sha256: sourceArtifacts.sha256,
      sourceUrl: sourceArtifacts.sourceUrl,
    })
    .from(examFiles)
    .innerJoin(exams, eq(exams.id, examFiles.examId))
    .leftJoin(sourceArtifacts, eq(sourceArtifacts.id, examFiles.sourceArtifactId))
    .where(
      and(
        eq(examFiles.subject, "english"),
        eq(examFiles.artifactOrigin, "official"),
        eq(examFiles.deliveryType, "redirect"),
        isNull(examFiles.courseId),
        inArray(examFiles.type, ["solution", "listening_audio", "listening_script"]),
        options.year ? eq(exams.year, options.year) : undefined,
        options.examId ? eq(exams.id, options.examId) : undefined,
      ),
    );

  const byExam = new Map<string, Candidate[]>();
  for (const row of rows as Candidate[]) {
    byExam.set(row.examId, [...(byExam.get(row.examId) ?? []), row]);
  }

  const summary: EnglishStudyBackfillSummary = {
    exams: byExam.size,
    vocabularyEligible: 0,
    listeningEligible: 0,
    vocabularyEnqueued: 0,
    listeningEnqueued: 0,
    skippedUnsafe: 0,
  };

  for (const [examId, files] of byExam) {
    const solution = files.find((f) => f.type === "solution");
    if (solution?.sourceArtifactId) {
      const url = solution.sourceUrl ?? solution.url;
      const version = solution.contentFingerprint ?? solution.sha256;
      if (url && version && isCheckableFileUrl(url)) {
        summary.vocabularyEligible += 1;
        if (!options.dryRun) {
          const added = await enqueueJob(ctx.db, {
            runAt: ctx.now(),
            type: "extract_vocabulary",
            payload: { artifactId: solution.sourceArtifactId },
            dedupeKey: `vocab:${solution.sourceArtifactId}:${version}`,
            maxAttempts: 3,
          });
          if (added) summary.vocabularyEnqueued += 1;
        }
      } else if (url) {
        summary.skippedUnsafe += 1;
      }
    }

    const audio = files.find((f) => f.type === "listening_audio");
    const script = files.find((f) => f.type === "listening_script");
    if (audio && script?.sourceArtifactId) {
      const url = script.sourceUrl ?? script.url;
      const version = script.contentFingerprint ?? script.sha256;
      if (url && version && isCheckableFileUrl(url)) {
        summary.listeningEligible += 1;
        if (!options.dryRun) {
          const added = await enqueueJob(ctx.db, {
            runAt: ctx.now(),
            type: "extract_listening_script",
            payload: { artifactId: script.sourceArtifactId },
            dedupeKey: `listening-script:${script.sourceArtifactId}:${version}`,
            maxAttempts: 3,
          });
          if (added) summary.listeningEnqueued += 1;
        }
      } else if (url) {
        summary.skippedUnsafe += 1;
      }
    }

    void examId;
  }

  return summary;
}
