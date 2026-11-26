"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { DEMO_MONTH } from "@/lib/config";

const LINKS = [
  { href: "/", match: "/", label: "Overview", exact: true },
  { href: `/roster/${DEMO_MONTH}`, match: "/roster", label: "Roster", exact: false },
  { href: "/setup", match: "/setup", label: "Setup", exact: false },
];

export function AppNav() {
  const path = usePathname();
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-11 max-w-[2360px] items-center gap-6 px-3 lg:px-5">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="text-primary"
            aria-hidden="true"
          >
            <rect
              x="1.25"
              y="1.25"
              width="13.5"
              height="13.5"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M1.5 5.75H14.5M5.75 5.75V14.5M10.25 5.75V14.5"
              stroke="currentColor"
              strokeWidth="1.25"
            />
          </svg>
          <span>RosterWise</span>
        </Link>
        <nav aria-label="Main" className="flex h-full items-stretch gap-5 text-sm">
          {LINKS.map((l) => {
            const active = l.exact
              ? path === l.match
              : path === l.match || path.startsWith(`${l.match}/`);
            return (
              <Link
                key={l.label}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center border-b-2 border-transparent px-0.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground",
                  active && "border-primary text-foreground",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
