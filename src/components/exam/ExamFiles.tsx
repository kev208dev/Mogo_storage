import type { FileType, Subject } from "@/lib/constants";
import type { ExamFile } from "@/lib/data/types";
import { FileDownloadCard } from "./FileDownloadCard";

const PRIMARY_TYPES: FileType[] = ["question", "solution"];
const ENGLISH_TYPES: FileType[] = ["listening_audio", "listening_script", "vocabulary_pdf"];

/** 시험자료 영역: 과목 선택 바로 아래, 페이지에서 가장 먼저 보이는 기능 */
export function ExamFiles({
  files,
  examId,
  subject,
  title,
  processingTypes = [],
}: {
  files: ExamFile[];
  examId: string;
  subject: Subject;
  title: string;
  /** 공식 자료가 발견되어 검증 중인 종류 */
  processingTypes?: FileType[];
}) {
  const types = subject === "english" ? [...PRIMARY_TYPES, ...ENGLISH_TYPES] : PRIMARY_TYPES;
  return (
    <section aria-labelledby="files-heading" className="pt-4">
      <h2 id="files-heading" className="sr-only">
        시험자료
      </h2>
      <ul className="divide-border border-border divide-y rounded-md border px-3">
        {types.map((type) => (
          <FileDownloadCard
            key={type}
            type={type}
            file={files.find((f) => f.type === type)}
            examId={examId}
            subject={subject}
            title={title}
            processing={processingTypes.includes(type)}
          />
        ))}
      </ul>
      {files.some((f) => f.deliveryType === "redirect") ? (
        <p className="text-muted-foreground mt-1.5 text-xs" data-testid="redirect-hint">
          공식 자료는 시행 기관 · EBSi 등 원본 사이트 파일로 바로 연결됩니다. 열리지 않으면 잠시 후
          다시 시도하거나 [오류 신고]로 알려주세요.
        </p>
      ) : null}
    </section>
  );
}
