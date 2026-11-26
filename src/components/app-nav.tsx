"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { DEMO_MONTH } from "@/lib/config";

const LINKS = [
  { href: `/roster/${DEMO_MONTH}`, match: "/roster", label: "Roster" },
  { href: `/setup`, match: "/setup", label: "Setup" },
];

export function AppNav() {
  const path = usePathname();
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-12 max-w-[1800px] items-center gap-6 px-4">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          RosterWise
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          {LINKS.map((l) => {
            const active = path === l.match || path.startsWith(`${l.match}/`);
            return (
              <Link
                key={l.label}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  active && "bg-accent font-medium text-foreground",
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
