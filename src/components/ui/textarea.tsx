import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "border-border bg-background placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-ring/40 min-h-24 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px] sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
