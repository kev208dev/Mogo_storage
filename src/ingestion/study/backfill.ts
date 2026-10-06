import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client";
import { examFiles, exams, sourceArtifacts } from "../../db/schema";
import type { IngestionContext } from "../context";
import { isOperatorImport } from "../manual-import/source";
import { enqueueJob } from "../jobs/queue";
import { maybeEnqueueListeningScript } from "../jobs/study-handlers";
import { enqueueStudyMaterials, loadWorksheetInput } from "./materials";
import { worksheetSpecs } from "./worksheet-spec";

export interface EnglishStudyBackfillFilter {
  year?: number;
  grade?: 1 | 2 | 3;
  month?: number;
}

export interface EnglishStudyBackfillResult {
  exams: number;
  vocabularyEligible: number;
  vocabularyEnqueued: number;
  listeningEligible: number;
  listeningScheduled: number;
  worksheetEligible: number;
  worksheetScheduled: number;
  blockedOperatorArtifacts: number;
  missingSourceArtifacts: number;
}

type BackfillCtx = Pick<IngestionContext, "db" | "now">;

export function processableStudyArtifactVersion(input: {
  sourceId: string;
  contentFingerprint: string | null;
  sha256: string | null;
}): string | null {
  if (isOperatorImport(input.sourceId)) return null;
  return input.contentFingerprint ?? input.sha256 ?? null;
}

async function selectedExams(db: Database, filter: EnglishStudyBackfillFilter) {
  const where = and(
    filter.year === undefined ? undefined : eq(exams.year, filter.year),
    filter.grade === undefined ? undefined : eq(exams.grade, filter.grade),
    filter.month === undefined ? undefined : eq(exams.month, filter.month),
  );
  const query = db
    .select({ id: exams.id, year: exams.year, grade: exams.grade, month: exams.month })
    .from(exams);
  return where
    ? query.where(where).orderBy(exams.year, exams.grade, exams.month)
    : query.orderBy(exams.year, exams.grade, exams.month);
}

async function sourceForPublishedFile(
  db: Database,
  examId: string,
  type: "solution" | "listening_audio" | "listening_script",
) {
  const [file] = await db
    .select({
      fileId: examFiles.id,
      sourceArtifactId: examFiles.sourceArtifactId,
      artifactOrigin: examFiles.artifactOrigin,
    })
    .from(examFiles)
    .where(
      and(
        eq(examFiles.examId, examId),
        eq(examFiles.subject, "english"),
        eq(examFiles.type, type),
        isNull(examFiles.courseId),
      ),
    );
  if (!file?.sourceArtifactId) return { file, artifact: null };
  const [artifact] = await db
    .select()
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.id, file.sourceArtifactId));
  return { file, artifact: artifact ?? null };
}

/**
 * 이미 게시된 영어 공식 자료를 PROCESS 단계에 다시 연결한다.
 *
 * - 해설 PDF: 비-operator source 만 extract_vocabulary job 을 예약한다.
 * - 듣기: 공식 음원 + 대본이 있고 대본 source 가 비-operator 일 때 기존 안전한 대본 추출 예약 로직을 호출한다.
 * - 단어/대본/웹 정답이 이미 있으면 학습지 생성 job 을 예약한다.
 *
 * operator_import 는 "브라우저 확인 URL을 서버가 다시 요청하지 않는다"는 기존 정책을 유지하므로
 * 네트워크가 필요한 vocabulary/listening 추출 대상에서 제외한다.
 */
export async function backfillEnglishStudy(
  ctx: BackfillCtx,
  filter: EnglishStudyBackfillFilter = {},
  options: { dryRun?: boolean } = {},
): Promise<EnglishStudyBackfillResult> {
  const rows = await selectedExams(ctx.db, filter);
  const result: EnglishStudyBackfillResult = {
    exams: rows.length,
    vocabularyEligible: 0,
    vocabularyEnqueued: 0,
    listeningEligible: 0,
    listeningScheduled: 0,
    worksheetEligible: 0,
    worksheetScheduled: 0,
    blockedOperatorArtifacts: 0,
    missingSourceArtifacts: 0,
  };

  for (const exam of rows) {
    const solution = await sourceForPublishedFile(ctx.db, exam.id, "solution");
    if (solution.file) {
      if (!solution.artifact) {
        result.missingSourceArtifacts += 1;
      } else {
        const version = processableStudyArtifactVersion(solution.artifact);
        if (!version) {
          if (isOperatorImport(solution.artifact.sourceId)) result.blockedOperatorArtifacts += 1;
          else result.missingSourceArtifacts += 1;
        } else {
          result.vocabularyEligible += 1;
          if (!options.dryRun) {
            const inserted = await enqueueJob(ctx.db, {
              runAt: ctx.now(),
              type: "extract_vocabulary",
              payload: { artifactId: solution.artifact.id },
              dedupeKey: `vocab:${solution.artifact.id}:${version}`,
              maxAttempts: 3,
            });
            if (inserted) result.vocabularyEnqueued += 1;
          }
        }
      }
    }

    const [audio, script] = await Promise.all([
      sourceForPublishedFile(ctx.db, exam.id, "listening_audio"),
      sourceForPublishedFile(ctx.db, exam.id, "listening_script"),
    ]);
    if (audio.file && script.file) {
      if (!script.artifact) {
        result.missingSourceArtifacts += 1;
      } else {
        const version = processableStudyArtifactVersion(script.artifact);
        if (!version) {
          if (isOperatorImport(script.artifact.sourceId)) result.blockedOperatorArtifacts += 1;
          else result.missingSourceArtifacts += 1;
        } else {
          result.listeningEligible += 1;
          if (!options.dryRun) {
            await maybeEnqueueListeningScript(ctx, exam.id);
            result.listeningScheduled += 1;
          }
        }
      }
    }

    const input = await loadWorksheetInput(ctx.db, exam.id);
    const specs = input ? worksheetSpecs(input) : [];
    if (specs.length > 0) {
      result.worksheetEligible += 1;
      if (!options.dryRun) {
        await enqueueStudyMaterials(ctx, exam.id);
        result.worksheetScheduled += 1;
      }
    }
  }

  return result;
}
