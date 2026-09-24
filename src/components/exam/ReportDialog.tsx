"use client";

import { FlagIcon, LoaderCircleIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABELS,
  type ReportCategory,
  type Subject,
} from "@/lib/constants";
import { REPORT_MESSAGE_MAX } from "@/lib/report-schema";

type State =
  { kind: "idle" } | { kind: "sending" } | { kind: "done" } | { kind: "error"; message: string };

export function ReportDialog({
  examId,
  subject,
  fileId,
  targetLabel,
  defaultCategory = "other",
}: {
  examId: string;
  subject: Subject;
  fileId: string | null;
  targetLabel: string;
  defaultCategory?: ReportCategory;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          examId,
          subject,
          fileId,
          category: form.get("category"),
          message: form.get("message"),
          website: form.get("website"),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setState({ kind: "error", message: data?.error ?? "신고를 접수하지 못했습니다." });
        return;
      }
      setState({ kind: "done" });
    } catch {
      setState({ kind: "error", message: "네트워크 오류로 신고를 접수하지 못했습니다." });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setState({ kind: "idle" });
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/60 inline-flex min-h-9 items-center gap-1 rounded px-1.5 text-xs whitespace-nowrap focus-visible:ring-[3px] focus-visible:outline-none"
          aria-label={`${targetLabel} 오류 신고`}
        >
          <FlagIcon className="size-3.5" aria-hidden />
          오류 신고
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>오류 신고</DialogTitle>
          <DialogDescription>{targetLabel} · 로그인 없이 신고할 수 있습니다.</DialogDescription>
        </DialogHeader>

        {state.kind === "done" ? (
          <div role="status" className="space-y-4">
            <p className="font-semibold">신고가 접수되었습니다. 확인 후 수정하겠습니다.</p>
            <Button className="w-full" onClick={() => setOpen(false)}>
              닫기
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">어떤 문제가 있나요?</legend>
              <div className="grid gap-1">
                {REPORT_CATEGORIES.map((category) => (
                  <label
                    key={category}
                    className="border-border has-[:checked]:border-primary has-[:checked]:bg-primary-soft flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3"
                  >
                    <input
                      type="radio"
                      name="category"
                      value={category}
                      defaultChecked={category === defaultCategory}
                      className="size-4 accent-[var(--primary)]"
                      required
                    />
                    <span className="text-sm">{REPORT_CATEGORY_LABELS[category]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-message`} className="text-sm font-semibold">
                추가 설명 <span className="text-muted-foreground font-normal">(선택)</span>
              </label>
              <Textarea
                id={`${id}-message`}
                name="message"
                maxLength={REPORT_MESSAGE_MAX}
                placeholder="예: 3페이지가 비어 있어요"
              />
            </div>
            {/* honeypot: 화면·스크린리더에서 숨긴 필드. 봇만 채운다. */}
            <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                웹사이트
                <input type="text" name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            {state.kind === "error" ? (
              <p role="alert" className="text-danger-strong text-sm font-semibold">
                {state.message}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={state.kind === "sending"}>
              {state.kind === "sending" ? (
                <LoaderCircleIcon className="animate-spin" aria-hidden />
              ) : null}
              신고하기
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
