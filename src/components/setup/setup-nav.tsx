"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SetupNav({ items }: { items: Array<{ slug: string; title: string }> }) {
  const path = usePathname();
  return (
    <nav aria-label="Setup sections" className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map((i) => {
        const active = path === `/setup/${i.slug}`;
        return (
          <Link
            key={i.slug}
            href={`/setup/${i.slug}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              active && "bg-accent font-medium text-foreground",
            )}
          >
            {i.title}
          </Link>
        );
      })}
    </nav>
  );
}
