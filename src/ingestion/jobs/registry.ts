import type { IngestionContext } from "../context";
import { JobError, handlePublishArtifact, handleVerifyArtifact } from "./handlers";
import type { Job } from "./queue";

const notImplemented = async (_ctx: IngestionContext, job: Job) => {
  throw new JobError("NOT_IMPLEMENTED", `job type ${job.type} is not implemented yet`);
};

/** job 종류 → 처리 함수 (DISCOVER 는 run 으로, 나머지 단계는 job 으로 처리) */
export const JOB_HANDLERS: Record<Job["type"], (ctx: IngestionContext, job: Job) => Promise<void>> = {
  verify_artifact: handleVerifyArtifact,
  publish_artifact: handlePublishArtifact,
  extract_vocabulary: notImplemented,
  generate_vocabulary_pdf: notImplemented,
};
