import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function formatKst(value: Date | string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

const HEALTH: Record<string, { label: string; className: string }> = {
  healthy: { label: "정상", className: "bg-success-soft text-success-strong" },
  degraded: { label: "주의", className: "bg-warning-soft text-warning-strong" },
  broken: { label: "고장", className: "bg-danger-soft text-danger-strong" },
  disabled: { label: "꺼짐", className: "bg-muted text-muted-foreground" },
};

export function HealthBadge({ status }: { status: string }) {
  const h = HEALTH[status] ?? HEALTH.disabled!;
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs font-bold", h.className)}>{h.label}</span>
  );
}

const MARKS: Record<string, { symbol: string; label: string; className: string }> = {
  published: { symbol: "✓", label: "게시됨", className: "text-success-strong" },
  pending: { symbol: "…", label: "처리 중", className: "text-warning-strong" },
  failed: { symbol: "✗", label: "실패", className: "text-danger-strong" },
  none: { symbol: "–", label: "없음", className: "text-muted-foreground" },
};

export function Mark({ value, name }: { value: string; name: string }) {
  const m = MARKS[value] ?? MARKS.none!;
  return (
    <span className={cn("font-bold", m.className)} title={`${name} ${m.label}`}>
      {name} {m.symbol}
      <span className="sr-only"> {m.label}</span>
    </span>
  );
}

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-border rounded-md border" aria-label={title}>
      <div className="border-border bg-muted flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-bold">{title}</h2>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function SmallButton({
  children,
  variant = "outline",
}: {
  children: ReactNode;
  variant?: "outline" | "primary" | "danger";
}) {
  return (
    <button
      type="submit"
      className={cn(
        "inline-flex min-h-9 items-center rounded-md px-2.5 text-xs font-semibold",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary-hover",
        variant === "outline" && "border-border hover:bg-muted border",
        variant === "danger" &&
          "border-danger-strong/40 text-danger-strong hover:bg-danger-soft border",
      )}
    >
      {children}
    </button>
  );
}
