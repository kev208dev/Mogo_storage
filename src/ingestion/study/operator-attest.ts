import { and, eq, inArray, isNull } from "drizzle-orm";
import { examFiles, exams, sourceArtifacts } from "../../db/schema";
import type { IngestionContext } from "../context";
import { IngestionError } from "../errors";
import { enqueueJob } from "../jobs/queue";
import { maybeEnqueueListeningScript } from "../jobs/study-handlers";
import { isOperatorImport } from "../manual-import/source";
import { operatorStudyArtifactBlockReason } from "./artifact-fetch";

type Artifact = typeof sourceArtifacts.$inferSelect;

/**
 * 이미 게시된 운영자 입력 자료 중, 학습자료 처리(서버가 파일을 내려받음)가
 * "브라우저 확인 기록이 없다"는 이유 하나로만 막힌 영어 자료.
 * (호스트 allowlist · 자료 종류 · ready · redirect 없음 조건은 그대로 만족해야 한다)
 */
export function needsStudyAttestation(a: Artifact): boolean {
  if (!isOperatorImport(a.sourceId) || a.subject !== "english") return false;
  if (operatorStudyArtifactBlockReason(a) !== "not_browser_verified") return false;
  return operatorStudyArtifactBlockReason({ ...a, verificationMode: "operator_browser" }) === null;
}

/** 관리자 화면 목록: 게시된 영어 운영자 자료 중 브라우저 확인이 필요한 것 */
export async function listStudyAttestationCandidates(db: IngestionContext["db"]) {
  const rows = await db
    .select({ artifact: sourceArtifacts, exam: exams })
    .from(sourceArtifacts)
    .innerJoin(exams, eq(exams.id, sourceArtifacts.examId))
    .innerJoin(examFiles, eq(examFiles.sourceArtifactId, sourceArtifacts.id))
    .where(
      and(
        eq(sourceArtifacts.subject, "english"),
        eq(sourceArtifacts.status, "ready"),
        inArray(sourceArtifacts.type, ["solution", "listening_script"]),
      ),
    );
  return rows.filter((r) => needsStudyAttestation(r.artifact));
}

/**
 * 관리자 확인: "공식 파일을 브라우저에서 열어 맞는 자료임을 확인했다".
 * 기존 승인과 같은 기록(verification_mode=operator_browser)을 남기고 학습자료 PROCESS job 을 예약한다.
 * 다른 조건(호스트 · 종류 · redirect)은 완화하지 않는다.
 */
export async function attestOperatorArtifactForStudy(
  ctx: Pick<IngestionContext, "db" | "now" | "logger">,
  input: { artifactId: string; admin: string; browserChecked: boolean },
): Promise<{ enqueued: "vocabulary" | "listening" }> {
  if (!input.browserChecked)
    throw new IngestionError(
      "NOT_CONFIRMED",
      "공식 파일을 브라우저에서 열어 확인했다는 체크가 필요합니다",
    );
  const [a] = await ctx.db
    .select()
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.id, input.artifactId));
  if (!a) throw new IngestionError("NOT_FOUND", "자료를 찾을 수 없습니다");
  if (!needsStudyAttestation(a))
    throw new IngestionError(
      "NOT_ELIGIBLE",
      `브라우저 확인으로 처리할 수 있는 자료가 아닙니다 (${operatorStudyArtifactBlockReason(a) ?? "already_approved"})`,
    );
  const now = ctx.now();
  const [updated] = await ctx.db
    .update(sourceArtifacts)
    .set({
      verificationMode: "operator_browser",
      contentFingerprint: a.contentFingerprint ?? `operator:${a.sourceUrl}`,
      statusReason: `browser-checked for English study processing by ${input.admin}`,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(sourceArtifacts.id, a.id),
        a.verificationMode
          ? eq(sourceArtifacts.verificationMode, a.verificationMode)
          : isNull(sourceArtifacts.verificationMode),
      ),
    )
    .returning();
  if (!updated) throw new IngestionError("CONFLICT", "자료 상태가 바뀌었습니다. 다시 시도하세요");

  if (a.type === "solution") {
    await enqueueJob(ctx.db, {
      runAt: now,
      type: "extract_vocabulary",
      payload: { artifactId: a.id },
      dedupeKey: `vocab:${a.id}:${updated.contentFingerprint}`,
      maxAttempts: 3,
    });
  } else {
    await maybeEnqueueListeningScript(ctx, a.examId);
  }
  ctx.logger.info("artifact.study_attested", {
    artifactId: a.id,
    artifactType: a.type,
    approvedBy: input.admin,
  });
  return { enqueued: a.type === "solution" ? "vocabulary" : "listening" };
}
