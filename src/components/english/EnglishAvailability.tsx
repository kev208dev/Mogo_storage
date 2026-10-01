import { Badge } from "@/components/ui/badge";
import type { AvailabilityState, EnglishAvailabilityItem } from "@/lib/study";

const STATE: Record<
  AvailabilityState,
  { text: string; variant: "success" | "warning" | "neutral" }
> = {
  available: { text: "있음", variant: "success" },
  processing: { text: "확인 중", variant: "warning" },
  none: { text: "없음", variant: "neutral" },
};

/** 영어 학습 자료 현황: 실제 있는 것 / 확인·검토 중 / 없음 */
export function EnglishAvailability({ items }: { items: EnglishAvailabilityItem[] }) {
  return (
    <ul
      className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-5"
      data-testid="english-availability"
    >
      {items.map((item) => {
        const state = STATE[item.state];
        const body = (
          <>
            <span className="block text-sm font-semibold">{item.label}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1">
              <Badge variant={state.variant}>{state.text}</Badge>
              {item.detail ? (
                <span className="text-muted-foreground text-[11px]">{item.detail}</span>
              ) : null}
            </span>
          </>
        );
        return (
          <li key={item.key} data-item={item.key} data-state={item.state}>
            {item.href && item.state !== "none" ? (
              <a
                href={item.href}
                className="border-border hover:border-primary focus-visible:ring-ring/60 block min-h-14 rounded-md border px-2.5 py-2 focus-visible:ring-[3px] focus-visible:outline-none"
              >
                {body}
              </a>
            ) : (
              <div className="border-border bg-muted/40 min-h-14 rounded-md border px-2.5 py-2">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
