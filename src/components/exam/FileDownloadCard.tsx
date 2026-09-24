import { DownloadIcon, EyeIcon, FileTextIcon, MusicIcon, PlayIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FILE_TYPE_LABELS, type FileType, type Subject } from "@/lib/constants";
import type { ExamFile } from "@/lib/data/types";
import { formatFileSize } from "@/lib/utils";
import { ReportDialog } from "./ReportDialog";

export function fileDownloadHref(fileId: string) {
  return `/api/files/${encodeURIComponent(fileId)}/download`;
}

export function fileViewHref(fileId: string) {
  return `/api/files/${encodeURIComponent(fileId)}/view`;
}

function formatLabel(file: ExamFile) {
  const ext =
    file.mimeType === "application/pdf"
      ? "PDF"
      : file.mimeType.startsWith("audio/")
        ? "MP3"
        : "파일";
  return `${ext} · ${formatFileSize(file.fileSize)}`;
}

/**
 * 시험자료 1건. 파일이 없으면 버튼을 없애지 않고 "자료 준비 중" 상태를 보여준다.
 */
export function FileDownloadCard({
  type,
  file,
  examId,
  subject,
  title,
}: {
  type: FileType;
  file: ExamFile | undefined;
  examId: string;
  subject: Subject;
  title: string;
}) {
  const isAudio = type === "listening_audio";
  const Icon = isAudio ? MusicIcon : FileTextIcon;
  const label = `${title} ${FILE_TYPE_LABELS[type]}`;

  return (
    <li className="flex flex-col gap-2.5 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Icon
          className={
            file ? "text-primary size-6 shrink-0" : "text-muted-foreground size-6 shrink-0"
          }
          aria-hidden
        />
        <div className="min-w-0">
          <p className="font-bold">
            {FILE_TYPE_LABELS[type]}
            {isAudio ? "" : " PDF"}
          </p>
          <p className="text-muted-foreground text-[13px]">
            {file ? formatLabel(file) : <Badge variant="neutral">자료 준비 중</Badge>}
          </p>
        </div>
        <div className="ml-auto shrink-0">
          <ReportDialog
            examId={examId}
            subject={subject}
            fileId={file?.id ?? null}
            targetLabel={label}
            defaultCategory={defaultCategoryFor(type)}
          />
        </div>
      </div>

      {file ? (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          {isAudio ? (
            <Button variant="outline" asChild>
              <a href="#listening" aria-label={`${label} 재생 (듣기 플레이어로 이동)`}>
                <PlayIcon aria-hidden />
                재생
              </a>
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <a
                href={fileViewHref(file.id)}
                target="_blank"
                rel="noopener"
                aria-label={`${label} 미리보기 (새 창)`}
              >
                <EyeIcon aria-hidden />
                미리보기
              </a>
            </Button>
          )}
          <Button asChild>
            <a href={fileDownloadHref(file.id)} aria-label={`${label} 다운로드`}>
              <DownloadIcon aria-hidden />
              다운로드
            </a>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <Button variant="outline" disabled aria-label={`${label} 미리보기 (자료 준비 중)`}>
            <EyeIcon aria-hidden />
            미리보기
          </Button>
          <Button disabled aria-label={`${label} 다운로드 (자료 준비 중)`}>
            <DownloadIcon aria-hidden />
            준비 중
          </Button>
        </div>
      )}
    </li>
  );
}

function defaultCategoryFor(type: FileType) {
  switch (type) {
    case "question":
      return "wrong_question_paper" as const;
    case "solution":
      return "wrong_solution" as const;
    case "listening_audio":
    case "listening_script":
      return "audio_error" as const;
    case "vocabulary_pdf":
      return "vocabulary_error" as const;
  }
}
