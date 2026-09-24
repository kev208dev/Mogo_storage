import { InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** 샘플 데이터임을 알리는 작은 안내 (다운로드 영역을 밀어내지 않도록 한 줄로) */
export function SampleNotice({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "bg-warning-soft text-warning-strong flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
        className,
      )}
    >
      <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{children ?? "개발용 샘플 데이터입니다. 실제 시험 자료가 아닙니다."}</span>
    </p>
  );
}
