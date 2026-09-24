import { ChevronDownIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** 네이티브 select (모바일 OS picker 사용, JS 불필요) */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          "border-border bg-background focus-visible:border-primary focus-visible:ring-ring/40 h-12 w-full appearance-none rounded-md border pr-9 pl-3 text-base font-semibold outline-none focus-visible:ring-[3px]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
        aria-hidden
      />
    </div>
  );
}

export { NativeSelect };
