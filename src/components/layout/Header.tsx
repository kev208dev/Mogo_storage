import Link from "next/link";
import { GRADES, SITE_NAME } from "@/lib/constants";

export function Header() {
  return (
    <header className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/90 sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 rounded-md text-base font-extrabold tracking-tight"
        >
          <span
            aria-hidden
            className="bg-primary text-primary-foreground grid size-7 place-items-center rounded text-xs font-black"
          >
            모
          </span>
          {SITE_NAME}
        </Link>
        <nav aria-label="학년별 모의고사" className="ml-auto">
          <ul className="flex items-center gap-1">
            {GRADES.map((grade) => (
              <li key={grade}>
                <Link
                  href={`/grade/high${grade}`}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-sm font-semibold"
                >
                  고{grade}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
