import type { IngestionContext } from "../context";
import { handlePublishArtifact, handleVerifyArtifact } from "./handlers";
import type { Job } from "./queue";
import { handleExtractVocabulary, handleGenerateVocabularyPdf } from "./vocabulary-handlers";

/** job 종류 → 처리 함수 (DISCOVER 는 run 으로, 나머지 단계는 job 으로 처리) */
export const JOB_HANDLERS: Record<Job["type"], (ctx: IngestionContext, job: Job) => Promise<void>> =
  {
    verify_artifact: handleVerifyArtifact,
    publish_artifact: handlePublishArtifact,
    extract_vocabulary: handleExtractVocabulary,
    generate_vocabulary_pdf: handleGenerateVocabularyPdf,
  };
