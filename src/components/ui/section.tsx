import * as React from "react";
import { cn } from "@/lib/utils";

/** 페이지 안의 기능 영역. 제목(h2)과 선택적 보조 설명/액션을 가진다. */
function Section({
  id,
  title,
  description,
  action,
  className,
  children,
}: {
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn("border-border scroll-mt-20 border-t py-6", className)}
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={headingId} className="text-lg font-bold">
            {title}
          </h2>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export { Section };
