import { eq } from "drizzle-orm";
import { sourceArtifacts } from "../../db/schema";
import type { IngestionContext } from "../context";
import { IngestionError } from "../errors";
import { SafeFetcher, type FetchResult } from "../net/fetcher";
import { loadSource } from "../pipeline/sources";
import { userAgent } from "../sources/config";
import { createFetcherFor } from "../sources/registry";
import {
  expectedKindFor,
  MAX_ARTIFACT_BYTES,
  type ExpectedKind,
} from "../verify/artifact-validator";
import { isOperatorImport } from "../manual-import/source";

const PROCESSABLE_OPERATOR_HOSTS = new Set(["wdown.ebsi.co.kr"]);

type Artifact = typeof sourceArtifacts.$inferSelect;

export type OperatorStudyBlockReason =
  | "not_operator_import"
  | "not_ready"
  | "not_browser_verified"
  | "not_verified"
  | "unsupported_type"
  | "invalid_url"
  | "host_not_allowed"
  | "redirected";

type OperatorStudyArtifact = Pick<
  Artifact,
  "sourceId" | "sourceUrl" | "status" | "verificationMode" | "verifiedAt" | "finalUrl" | "type"
>;

/** 승인된 운영자 자료 예외에 해당하지 않는 이유 (해당하면 null). 진단·dry-run 출력용 */
export function operatorStudyArtifactBlockReason(
  artifact: OperatorStudyArtifact,
): OperatorStudyBlockReason | null {
  if (!isOperatorImport(artifact.sourceId)) return "not_operator_import";
  if (artifact.status !== "ready") return "not_ready";
  if (artifact.verificationMode !== "operator_browser") return "not_browser_verified";
  if (!artifact.verifiedAt) return "not_verified";
  if (artifact.type !== "solution" && artifact.type !== "listening_script")
    return "unsupported_type";
  let url: URL;
  try {
    url = new URL(artifact.sourceUrl);
  } catch {
    return "invalid_url";
  }
  if (url.protocol !== "https:" || !PROCESSABLE_OPERATOR_HOSTS.has(url.hostname))
    return "host_not_allowed";
  if (artifact.finalUrl && artifact.finalUrl !== artifact.sourceUrl) return "redirected";
  return null;
}

/**
 * 운영자가 브라우저에서 승인한 자료 중 서버-side 파생 학습자료 처리가 허용되는 좁은 예외.
 *
 * discovery / 승인 자체는 여전히 수동이다. 서버는 승인 전 URL을 요청하지 않는다.
 * 승인 후에도 robots 제한이 없는 EBSi 직접 파일 호스트(wdown)만 허용하며,
 * KICE/교육청/일반 operator_import URL은 계속 절대 요청하지 않는다.
 */
export function isApprovedOperatorStudyArtifact(artifact: OperatorStudyArtifact): boolean {
  return operatorStudyArtifactBlockReason(artifact) === null;
}

function operatorStudyFetcher() {
  return new SafeFetcher({
    policy: { allowedHosts: [...PROCESSABLE_OPERATOR_HOSTS] },
    timeoutMs: 30_000,
    maxConcurrent: 1,
    minGapMs: 1_500,
    maxRetries: 2,
    userAgent: userAgent(),
  });
}

export interface StudyArtifactDownload {
  artifact: Artifact;
  res: FetchResult;
  expected: ExpectedKind;
  operatorApproved: boolean;
}

/**
 * 영어 파생자료 처리 전용 전체 파일 다운로드.
 * 일반 source는 기존 source별 SafeFetcher 정책을 사용하고,
 * operator_import는 위의 좁은 승인+호스트 조건을 만족할 때만 전용 allowlist fetcher를 쓴다.
 */
export async function downloadEnglishStudyArtifact(
  ctx: Pick<IngestionContext, "db" | "adapterOptions">,
  artifactId: string,
): Promise<StudyArtifactDownload> {
  const [artifact] = await ctx.db
    .select()
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.id, artifactId));
  if (!artifact) throw new IngestionError("ARTIFACT_NOT_FOUND", `artifact ${artifactId} not found`);

  const expected = expectedKindFor(artifact.type);
  if (isOperatorImport(artifact.sourceId)) {
    if (!isApprovedOperatorStudyArtifact(artifact)) {
      throw new IngestionError(
        "OPERATOR_URL_FETCH_BLOCKED",
        "승인되지 않았거나 허용되지 않은 운영자 입력 URL은 서버에서 요청하지 않습니다",
      );
    }
    const res = await operatorStudyFetcher().fetch(artifact.sourceUrl, {
      maxBytes: MAX_ARTIFACT_BYTES[expected],
    });
    return { artifact, res, expected, operatorApproved: true };
  }

  const source = await loadSource(ctx.db, artifact.sourceId);
  if (!source)
    throw new IngestionError("SOURCE_NOT_FOUND", `source ${artifact.sourceId} not found`);
  const res = await createFetcherFor(source, ctx.adapterOptions).fetch(artifact.sourceUrl, {
    maxBytes: MAX_ARTIFACT_BYTES[expected],
  });
  return { artifact, res, expected, operatorApproved: false };
}
