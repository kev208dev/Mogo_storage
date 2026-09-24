import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { absoluteUrl } from "@/lib/site";
import { JsonLd } from "./JsonLd";

export interface BreadcrumbItem {
  label: string;
  href: string;
}

/** 시각적 breadcrumb + Schema.org BreadcrumbList JSON-LD */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: absoluteUrl(item.href),
    })),
  };
  return (
    <>
      <nav aria-label="현재 위치" className="text-muted-foreground text-[13px]">
        <ol className="flex flex-wrap items-center gap-0.5">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <li key={item.href} className="flex items-center gap-0.5">
                {isLast ? (
                  <span aria-current="page" className="text-foreground py-1 font-medium">
                    {item.label}
                  </span>
                ) : (
                  <>
                    <Link
                      href={item.href}
                      className="hover:text-foreground rounded py-1 hover:underline"
                    >
                      {item.label}
                    </Link>
                    <ChevronRightIcon className="size-3.5" aria-hidden />
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <JsonLd data={jsonLd} />
    </>
  );
}
